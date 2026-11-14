import {
  AppsScriptError,
  authLoginInAppsScript,
  authLogoutInAppsScript,
} from "@/lib/server/apps-script";
import {
  IDLE_TIMEOUT_SEC,
  SESSION_COOKIE,
  SESSION_TTL_SEC,
  isSameOrigin,
  readCookie,
  readSessionToken,
  newSessionId,
  readAuthConfig,
  sessionCookie,
  sessionIdHash,
  signSession,
  verifyPassword,
  verifyTotp,
} from "@/lib/server/auth";

/*
 * 관리자 로그인 API. POST { password, otp }
 * - 비밀번호·OTP 는 항상 둘 다 확인한다 (어느 쪽이 틀렸는지 알려 주지 않음, 걸리는 시간도 같게).
 * - 결과는 Apps Script(auth-handler.gs)에 기록한다: 실패 횟수·잠금·OTP 재사용 방지가 모든 서버 인스턴스에 공통.
 *   잠겨 있으면 맞는 비밀번호·OTP 여도 거부한다. Apps Script 에 기록하지 못하면 로그인시키지 않는다.
 * - 성공하면 HttpOnly·Secure·SameSite=Strict 세션 쿠키를 준다 (브라우저 스크립트·저장소에는 남지 않음).
 *   최대 8시간, 미사용 30분 (lib/server/auth.ts). 브라우저를 닫으면 사라지는 쿠키.
 * - 재확인(8시간이 지나 화면의 재확인 창에서 다시 로그인)도 이 API 를 쓴다. 이때 이 브라우저의 이전 세션은
 *   Apps Script 에서 지운다 → 기기 3대 제한 칸을 차지하지 않고, 예전 쿠키를 복사해 둔 사람도 쓸 수 없다.
 * - 비밀번호·OTP·세션 값은 로그에 남기지 않는다.
 */

const FAIL = "비밀번호 또는 인증 코드가 올바르지 않습니다.";

function reply(body: Record<string, unknown>, status: number, headers: Record<string, string> = {}) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

export async function POST(request: Request) {
  const config = readAuthConfig();
  if (!config) {
    return reply({ ok: false, code: "auth_not_configured", message: "로그인 설정이 완료되지 않았습니다." }, 503);
  }
  if (!isSameOrigin(request)) {
    return reply({ ok: false, code: "bad_origin", message: "허용되지 않은 요청입니다." }, 403);
  }
  let input: unknown;
  try {
    const text = await request.text();
    if (text.length > 1000) throw new Error("too long");
    input = JSON.parse(text);
  } catch {
    return reply({ ok: false, code: "bad_request", message: FAIL }, 400);
  }
  const body = (input ?? {}) as Record<string, unknown>;
  const password = typeof body.password === "string" ? body.password.slice(0, 256) : "";
  const otp = typeof body.otp === "string" ? body.otp.replace(/\s/g, "").slice(0, 10) : "";

  // 항상 둘 다 계산 (한쪽만 틀려도 같은 응답·같은 시간)
  const [passwordOk, step] = await Promise.all([
    verifyPassword(password, config.passwordHash),
    Promise.resolve(verifyTotp(config.totpKey, otp, Date.now())),
  ]);
  const passed = passwordOk && step !== null;

  const sid = newSessionId();
  const exp = Math.floor(Date.now() / 1000) + SESSION_TTL_SEC;
  let outcome;
  try {
    outcome = await authLoginInAppsScript({ passed, sessionHash: sessionIdHash(sid), exp, step: passed ? step : null });
  } catch (error) {
    console.error(`[로그인] 기록 실패 (${error instanceof AppsScriptError ? error.code : "error"})`);
    return reply({ ok: false, code: "auth_unavailable", message: "로그인을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요." }, 503);
  }
  if (outcome.ok && passed) {
    const nowSec = Math.floor(Date.now() / 1000);
    const idleExp = nowSec + IDLE_TIMEOUT_SEC;
    // 이 브라우저의 이전 세션(서명이 맞는 것만)은 지운다. 실패해도 새 로그인은 그대로 (이전 세션은 만료되면 사라짐)
    const previous = readSessionToken(config.sessionKey, readCookie(request, SESSION_COOKIE), nowSec);
    if (previous && previous.sid !== sid) {
      try {
        await authLogoutInAppsScript(sessionIdHash(previous.sid), false);
      } catch (error) {
        console.error(`[로그인] 이전 세션 정리 실패 (${error instanceof AppsScriptError ? error.code : "error"})`);
      }
    }
    return reply({ ok: true, now: nowSec, exp, idleExp }, 200, {
      "Set-Cookie": sessionCookie(signSession(config.sessionKey, sid, exp, idleExp)),
    });
  }
  if (!outcome.ok && outcome.reason === "locked") {
    const minutes = Math.max(1, Math.ceil(outcome.retryAfterSec / 60));
    return reply(
      { ok: false, code: "locked", message: `로그인 실패가 여러 번 있어 약 ${minutes}분 동안 로그인할 수 없습니다.` },
      429,
      { "Retry-After": String(outcome.retryAfterSec) },
    );
  }
  return reply({ ok: false, code: "invalid", message: FAIL }, 401);
}
