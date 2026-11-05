import "server-only";
import {
  createHash,
  createHmac,
  pbkdf2,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import {
  AppsScriptError,
  authCheckInAppsScript,
} from "@/lib/server/apps-script";

/*
 * 단일 관리자 로그인 (점장 1명). 외부 서비스·DB 없이 동작한다.
 *
 * 비밀값은 모두 Vercel 환경변수(Sensitive)에만 둔다. 코드·GitHub·브라우저 저장소에는 두지 않는다.
 *   AUTH_PASSWORD_HASH   비밀번호의 PBKDF2-SHA256 해시 "pbkdf2-sha256$반복횟수$소금$해시" (원래 비밀번호로 되돌릴 수 없음)
 *   AUTH_TOTP_SECRET     OTP 앱(Google Authenticator 등)에 등록한 비밀키 (Base32, 160비트 권장)
 *   AUTH_SESSION_SECRET  세션 쿠키 서명용 무작위 값 (32바이트 이상)
 * 세 값은 tools/auth-setup.html (인터넷 없이 내 PC 브라우저에서 여는 파일)로 만든다.
 * 하나라도 없거나 형식이 틀리면 모든 화면·API 를 막는다 (설정 실수로 열리지 않게).
 *
 * 세션:
 *   - 쿠키 "__Host-ws_session" = v1.<세션ID>.<만료시각>.<HMAC 서명>  (HttpOnly · Secure · SameSite=Strict · Path=/)
 *   - 서명·만료는 웹 서버가 확인하고, "아직 살아 있는 세션인지"는 매 요청 Apps Script 스크립트 속성에서 확인한다
 *     → 로그아웃하면 어느 서버 인스턴스에서도 그 즉시 거부된다 (서버 측 무효화).
 *   - Apps Script 에는 세션ID 의 SHA-256 값만 보낸다 (세션ID 자체는 쿠키에만).
 * 로그인 시도 제한·OTP 재사용 방지도 Apps Script 스크립트 속성 한 곳에서 잠금(LockService)으로 처리한다
 *   → Vercel 서버가 여러 개여도 같은 횟수·같은 잠금 (auth-handler.gs).
 */

export const SESSION_COOKIE = "__Host-ws_session";
export const SESSION_TTL_SEC = 12 * 60 * 60;
const MIN_PBKDF2_ITERATIONS = 100_000;
export const TOTP_PERIOD_SEC = 30;
/** 서버·휴대폰 시계 오차 허용: 앞뒤 1칸(±30초) */
export const TOTP_WINDOW = 1;

export interface AuthConfig {
  passwordHash: { iterations: number; salt: Buffer; hash: Buffer };
  totpKey: Buffer;
  sessionKey: Buffer;
}

const pbkdf2Async = promisify(pbkdf2);

function b64url(buf: Buffer): string {
  return buf.toString("base64url");
}
function fromB64url(text: string): Buffer | null {
  if (!/^[A-Za-z0-9_-]+$/.test(text)) return null;
  return Buffer.from(text, "base64url");
}

export function parsePasswordHash(value: string | undefined): AuthConfig["passwordHash"] | null {
  const parts = (value ?? "").trim().split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2-sha256") return null;
  const iterations = Number(parts[1]);
  const salt = fromB64url(parts[2]);
  const hash = fromB64url(parts[3]);
  if (!Number.isInteger(iterations) || iterations < MIN_PBKDF2_ITERATIONS || iterations > 10_000_000) return null;
  if (!salt || salt.length < 16 || !hash || hash.length !== 32) return null;
  return { iterations, salt, hash };
}

export function base32Decode(text: string): Buffer | null {
  const clean = text.replace(/[\s=-]/g, "").toUpperCase();
  if (!/^[A-Z2-7]+$/.test(clean)) return null;
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    value = (value << 5) | alphabet.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** 환경변수에서 인증 설정을 읽는다. 하나라도 틀리면 null (→ 모두 거부) */
export function readAuthConfig(): AuthConfig | null {
  const passwordHash = parsePasswordHash(process.env.AUTH_PASSWORD_HASH);
  const totpKey = base32Decode(process.env.AUTH_TOTP_SECRET?.trim() ?? "");
  const sessionSecret = process.env.AUTH_SESSION_SECRET?.trim() ?? "";
  if (!passwordHash || !totpKey || totpKey.length < 16 || sessionSecret.length < 32) return null;
  return { passwordHash, totpKey, sessionKey: Buffer.from(sessionSecret, "utf8") };
}

export async function verifyPassword(password: string, stored: AuthConfig["passwordHash"]): Promise<boolean> {
  const derived = await pbkdf2Async(password, stored.salt, stored.iterations, 32, "sha256");
  return timingSafeEqual(derived, stored.hash);
}

/** RFC 6238 TOTP (HMAC-SHA1, 6자리) — 한 칸(step)의 코드 */
export function totpCode(key: Buffer, step: number, digits = 6): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = createHmac("sha1", key).update(counter).digest();
  const offset = mac[mac.length - 1] & 0x0f;
  const binary =
    ((mac[offset] & 0x7f) << 24) | (mac[offset + 1] << 16) | (mac[offset + 2] << 8) | mac[offset + 3];
  return String(binary % 10 ** digits).padStart(digits, "0");
}

/** 입력 코드가 맞으면 맞은 칸(step) 번호, 아니면 null. 앞뒤 TOTP_WINDOW 칸까지 허용 (모든 칸을 끝까지 비교) */
export function verifyTotp(key: Buffer, code: string, nowMs: number): number | null {
  const ok = /^\d{6}$/.test(code);
  const input = Buffer.from(ok ? code : "000000");
  const current = Math.floor(nowMs / 1000 / TOTP_PERIOD_SEC);
  let matched: number | null = null;
  for (let d = -TOTP_WINDOW; d <= TOTP_WINDOW; d++) {
    const expected = Buffer.from(totpCode(key, current + d));
    if (timingSafeEqual(expected, input) && ok && matched === null) matched = current + d;
  }
  return matched;
}

export function newSessionId(): string {
  return b64url(randomBytes(24));
}
/** Apps Script 에는 이 값만 보낸다 */
export function sessionIdHash(sid: string): string {
  return createHash("sha256").update(sid).digest("hex");
}

function sign(key: Buffer, data: string): string {
  return b64url(createHmac("sha256", key).update(data).digest());
}
export function signSession(key: Buffer, sid: string, exp: number): string {
  const data = `v1.${sid}.${exp}`;
  return `${data}.${sign(key, data)}`;
}
/** 서명·만료 확인. 맞으면 { sid, exp } */
export function verifySessionToken(
  key: Buffer,
  token: string | null,
  nowSec: number,
): { sid: string; exp: number } | null {
  if (!token || token.length > 200) return null;
  const parts = token.split(".");
  if (parts.length !== 4 || parts[0] !== "v1") return null;
  const [, sid, expText, sig] = parts;
  if (!/^[A-Za-z0-9_-]{32}$/.test(sid) || !/^\d{10}$/.test(expText)) return null;
  const expected = Buffer.from(sign(key, `v1.${sid}.${expText}`));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  const exp = Number(expText);
  if (exp <= nowSec || exp > nowSec + SESSION_TTL_SEC + 60) return null;
  return { sid, exp };
}

export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i === -1) continue;
    if (part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

export function sessionCookie(value: string, maxAgeSec: number): string {
  return `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAgeSec}`;
}
export function clearedSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}

/**
 * 쓰기 요청(GET·HEAD 외)은 같은 사이트에서 온 것만 받는다 (다른 사이트가 몰래 보내는 요청 차단).
 * Origin 이 있으면 요청 주소의 origin 과 같아야 하고, 없으면 Sec-Fetch-Site 가 same-origin 이어야 한다.
 */
export function isSameOrigin(request: Request): boolean {
  if (request.method === "GET" || request.method === "HEAD") return true;
  const origin = request.headers.get("origin");
  if (origin) {
    try {
      return origin === new URL(request.url).origin;
    } catch {
      return false;
    }
  }
  return request.headers.get("sec-fetch-site") === "same-origin";
}

function deny(status: number, code: string, message: string): Response {
  return Response.json(
    { ok: false, code, message },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}
export const UNAUTHENTICATED_MESSAGE = "로그인이 필요합니다.";

/**
 * 모든 업무 API 맨 앞에서 부른다. 통과하면 null, 아니면 바로 돌려줄 응답.
 * 순서: 설정 확인 → 같은 사이트 요청 확인 → 쿠키 서명·만료 (여기까지 Apps Script 호출 없음)
 *       → Apps Script 에서 세션이 살아 있는지 (스크립트 속성만 읽음, 장표에는 접근하지 않음)
 * 이 함수가 null 을 돌려주기 전에는 업무 요청이 Apps Script 로 가지 않는다.
 */
export async function requireAuth(request: Request): Promise<Response | null> {
  const config = readAuthConfig();
  if (!config) return deny(503, "auth_not_configured", "로그인 설정이 완료되지 않아 사용할 수 없습니다.");
  if (!isSameOrigin(request)) return deny(403, "bad_origin", "허용되지 않은 요청입니다.");
  const session = verifySessionToken(config.sessionKey, readCookie(request, SESSION_COOKIE), Math.floor(Date.now() / 1000));
  if (!session) return deny(401, "unauthenticated", UNAUTHENTICATED_MESSAGE);
  try {
    const alive = await authCheckInAppsScript(sessionIdHash(session.sid));
    if (!alive) return deny(401, "unauthenticated", UNAUTHENTICATED_MESSAGE);
  } catch (error) {
    // 확인하지 못하면 막는다 (fail closed)
    console.error(`[로그인] 세션 확인 실패 (${error instanceof AppsScriptError ? error.code : "error"})`);
    return deny(503, "auth_unavailable", "로그인 상태를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.");
  }
  return null;
}
