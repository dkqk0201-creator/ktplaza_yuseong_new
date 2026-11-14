import { NextResponse, type NextRequest } from "next/server";

/*
 * 화면·API 공통 관문 (Next.js 16 proxy — 예전 이름 middleware).
 * 세션 쿠키의 서명·미사용 만료(30분)·최대 만료(8시간)만 확인한다 (Apps Script 는 부르지 않음).
 *   - 쿠키가 없거나 틀리거나 만료됐으면: 화면 → /login 으로 보냄, API → 401 (+ 만료 종류 code)
 *   - 로그인이 필요한 화면은 모두 Cache-Control: no-store (뒤로 가기·페이지 복원으로 예전 화면이 나오지 않게)
 *   - 쿠키가 맞아도 최종 판단은 각 API 의 requireAuth (로그아웃된 세션인지 Apps Script 에서 확인)
 * 관문만 믿지 않는다: 모든 업무 API 가 같은 확인을 다시 한다 (lib/server/auth.ts).
 * 예외: /login 화면, /api/auth/login·logout, Next.js 정적 파일.
 */

const COOKIE = "__Host-ws_session";
/** 로그인 없이 열 수 있는 주소 (정확히 이 주소만) */
const PUBLIC_PATHS = new Set(["/login", "/api/auth/login", "/api/auth/logout"]);
/* lib/server/auth.ts 와 같은 값 (proxy 는 server-only 모듈을 불러오지 않으므로 따로 적음 — 테스트에서 같은지 확인) */
const SESSION_TTL_SEC = 8 * 60 * 60;
const IDLE_TIMEOUT_SEC = 30 * 60;
const NO_STORE = "no-store, no-cache, must-revalidate, max-age=0";

function fromB64url(text: string): Uint8Array<ArrayBuffer> {
  const b64 = text.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((text.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

type TokenState = "ok" | "idle" | "absolute" | "invalid";

async function tokenState(token: string | undefined): Promise<TokenState> {
  const secret = process.env.AUTH_SESSION_SECRET?.trim() ?? "";
  if (!token || secret.length < 32 || token.length > 200) return "invalid";
  const parts = token.split(".");
  if (parts.length !== 5 || parts[0] !== "v2") return "invalid";
  const [, sid, expText, idleText, sig] = parts;
  if (!/^[A-Za-z0-9_-]{32}$/.test(sid) || !/^\d{10}$/.test(expText) || !/^\d{10}$/.test(idleText) || !/^[A-Za-z0-9_-]{43}$/.test(sig)) {
    return "invalid";
  }
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const ok = await crypto.subtle.verify("HMAC", key, fromB64url(sig), new TextEncoder().encode(`v2.${sid}.${expText}.${idleText}`));
  if (!ok) return "invalid";
  const now = Math.floor(Date.now() / 1000);
  const exp = Number(expText);
  const idleExp = Number(idleText);
  if (exp > now + SESSION_TTL_SEC + 60 || idleExp > now + IDLE_TIMEOUT_SEC + 60) return "invalid";
  if (idleExp <= now) return "idle";
  if (exp <= now) return "absolute";
  return "ok";
}

const API_DENIED: Record<Exclude<TokenState, "ok">, { code: string; message: string }> = {
  invalid: { code: "unauthenticated", message: "로그인이 필요합니다." },
  idle: { code: "idle_expired", message: "30분 동안 사용하지 않아 로그아웃되었습니다. 다시 로그인해 주세요." },
  absolute: { code: "reauth_required", message: "보안을 위해 비밀번호와 OTP를 다시 확인해 주세요." },
};

function noStore(response: NextResponse): NextResponse {
  response.headers.set("Cache-Control", NO_STORE);
  return response;
}

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (PUBLIC_PATHS.has(pathname)) return noStore(NextResponse.next());
  const state = await tokenState(request.cookies.get(COOKIE)?.value);
  if (state === "ok") return noStore(NextResponse.next());
  if (pathname.startsWith("/api/")) {
    return NextResponse.json(
      { ok: false, ...API_DENIED[state] },
      { status: 401, headers: { "Cache-Control": NO_STORE } },
    );
  }
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  if (pathname !== "/") url.searchParams.set("next", pathname + search);
  if (state === "idle") url.searchParams.set("reason", "idle");
  return noStore(NextResponse.redirect(url));
}

export const config = {
  matcher: [
    // Next.js 정적 파일만 빼고 모든 주소 (로그인 화면 등 예외는 위 PUBLIC_PATHS 에서)
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
