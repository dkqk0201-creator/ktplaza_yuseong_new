import { AppsScriptError, authCheckInAppsScript, authLogoutInAppsScript } from "@/lib/server/apps-script";
import {
  SESSION_COOKIE,
  clearedSessionCookie,
  isSameOrigin,
  readAuthConfig,
  readCookie,
  readSessionToken,
  sessionIdHash,
} from "@/lib/server/auth";

/*
 * 로그아웃 API. POST { all?: true }
 * - 서버 측 무효화: Apps Script 에 등록된 이 세션(all 이면 모든 기기 세션)을 지운다
 *   → 쿠키를 누가 복사해 두었더라도 그 즉시 모든 API 에서 거부된다.
 * - 브라우저 쿠키도 지운다. 서버 측 무효화에 실패하면 그렇게 알려 준다 (쿠키만 지우고 성공이라 하지 않음).
 * - 이 기기 로그아웃은 미사용·최대 시간이 지난 세션이어도 서명이 맞으면 Apps Script 에서 지운다 (자동 로그아웃도 이 경로).
 * - 모든 기기 로그아웃(all)은 지금 쓸 수 있는 세션 + Apps Script 에서 살아 있는 세션만 할 수 있다
 *   (오래된 쿠키를 주운 사람이 다른 기기를 모두 끊는 일을 막음).
 */
function reply(body: Record<string, unknown>, status: number) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store", "Set-Cookie": clearedSessionCookie() },
  });
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) {
    return Response.json({ ok: false, code: "bad_origin", message: "허용되지 않은 요청입니다." }, { status: 403 });
  }
  const config = readAuthConfig();
  const session = config
    ? readSessionToken(config.sessionKey, readCookie(request, SESSION_COOKIE), Math.floor(Date.now() / 1000))
    : null;
  if (!session) return reply({ ok: true }, 200); // 이미 로그인 상태가 아님
  let all = false;
  try {
    all = ((await request.json()) as { all?: unknown })?.all === true;
  } catch {
    all = false;
  }
  try {
    if (all) {
      const alive = session.state === "ok" && (await authCheckInAppsScript(sessionIdHash(session.sid)));
      if (!alive) {
        return Response.json(
          { ok: false, code: "unauthenticated", message: "로그인 상태에서만 모든 기기 로그아웃을 할 수 있습니다." },
          { status: 401, headers: { "Cache-Control": "no-store" } },
        );
      }
    }
    await authLogoutInAppsScript(sessionIdHash(session.sid), all);
  } catch (error) {
    console.error(`[로그아웃] 서버 세션 삭제 실패 (${error instanceof AppsScriptError ? error.code : "error"})`);
    return reply({ ok: false, message: "서버의 로그인 상태를 지우지 못했습니다. 다시 시도해 주세요." }, 503);
  }
  return reply({ ok: true }, 200);
}
