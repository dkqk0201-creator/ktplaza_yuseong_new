import { NextResponse, type NextRequest } from "next/server";

/*
 * 화면·API 공통 관문 (Next.js 16 proxy — 예전 이름 middleware).
 * 세션 쿠키의 서명·만료만 확인한다 (Apps Script 는 부르지 않음).
 *   - 쿠키가 없거나 틀리면: 화면 → /login 으로 보냄, API → 401
 *   - 쿠키가 맞아도 최종 판단은 각 API 의 requireAuth (로그아웃된 세션인지 Apps Script 에서 확인)
 * 관문만 믿지 않는다: 모든 업무 API 가 같은 확인을 다시 한다 (lib/server/auth.ts).
 * 예외: /login 화면, /api/auth/login·logout, Next.js 정적 파일.
 */

const COOKIE = "__Host-ws_session";
/** 로그인 없이 열 수 있는 주소 (정확히 이 주소만) */
const PUBLIC_PATHS = new Set(["/login", "/api/auth/login", "/api/auth/logout"]);
const TTL_MAX_SEC = 12 * 60 * 60 + 60;

function fromB64url(text: string): Uint8Array<ArrayBuffer> {
  const b64 = text.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((text.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function validToken(token: string | undefined): Promise<boolean> {
  const secret = process.env.AUTH_SESSION_SECRET?.trim() ?? "";
  if (!token || secret.length < 32 || token.length > 200) return false;
  const parts = token.split(".");
  if (parts.length !== 4 || parts[0] !== "v1") return false;
  const [, sid, expText, sig] = parts;
  if (!/^[A-Za-z0-9_-]{32}$/.test(sid) || !/^\d{10}$/.test(expText) || !/^[A-Za-z0-9_-]{43}$/.test(sig)) return false;
  const now = Math.floor(Date.now() / 1000);
  const exp = Number(expText);
  if (exp <= now || exp > now + TTL_MAX_SEC) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  return crypto.subtle.verify("HMAC", key, fromB64url(sig), new TextEncoder().encode(`v1.${sid}.${expText}`));
}

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (PUBLIC_PATHS.has(pathname)) return NextResponse.next();
  if (await validToken(request.cookies.get(COOKIE)?.value)) return NextResponse.next();
  if (pathname.startsWith("/api/")) {
    return NextResponse.json(
      { ok: false, code: "unauthenticated", message: "로그인이 필요합니다." },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  if (pathname !== "/") url.searchParams.set("next", pathname + search);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: [
    // Next.js 정적 파일만 빼고 모든 주소 (로그인 화면 등 예외는 위 PUBLIC_PATHS 에서)
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
