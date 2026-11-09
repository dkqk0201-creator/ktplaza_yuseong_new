import {
  ACTIVITY_MIN_INTERVAL_SEC,
  ACTIVITY_REPORT_MAX_SEC,
  IDLE_TIMEOUT_SEC,
  authenticate,
  sessionCookie,
  signSession,
} from "@/lib/server/auth";

/*
 * 활동 갱신 API. POST { inactiveSec } — 화면이 실제 사용자 활동(클릭·키 입력·터치·스크롤)을 감지했을 때만 부른다.
 * - 세션을 늘리는 곳은 이 API 하나뿐이다. 업무 API·자동 조회는 늘리지 않는다.
 * - 업무 API 와 같은 인증 확인(서명·미사용 만료·최대 만료·Apps Script 세션)을 통과해야 한다.
 * - 미사용 만료 = 지금 − (화면이 알려 준 마지막 활동 후 지난 초, 0~120초로 제한) + 30분.
 *   화면이 알려 주는 값은 만료를 앞당기는 쪽으로만 쓰인다 (늘리는 데 쓸 수 없음).
 * - 최대 만료(8시간)는 바꾸지 않는다 → 반복 호출로도 8시간 넘게 늘릴 수 없다.
 * - 30초보다 자주 오면 세션 확인만 하고 쿠키는 그대로 둔다 (불필요한 갱신 방지).
 */
export async function POST(request: Request) {
  const result = await authenticate(request);
  if (result.denied) return result.denied;
  const { session, config } = result;

  let inactiveSec = 0;
  try {
    const text = await request.text();
    const body = text.length <= 200 && text ? (JSON.parse(text) as { inactiveSec?: unknown }) : {};
    const n = Number(body?.inactiveSec);
    inactiveSec = Number.isFinite(n) ? Math.min(ACTIVITY_REPORT_MAX_SEC, Math.max(0, Math.floor(n))) : 0;
  } catch {
    inactiveSec = 0;
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const lastRefresh = session.idleExp - IDLE_TIMEOUT_SEC;
  const candidate = nowSec - inactiveSec + IDLE_TIMEOUT_SEC;
  const headers: Record<string, string> = { "Cache-Control": "no-store" };
  let idleExp = session.idleExp;
  if (nowSec - lastRefresh >= ACTIVITY_MIN_INTERVAL_SEC && candidate > session.idleExp) {
    idleExp = candidate;
    headers["Set-Cookie"] = sessionCookie(signSession(config.sessionKey, session.sid, session.exp, idleExp));
  }
  return Response.json(
    { ok: true, refreshed: idleExp !== session.idleExp, now: nowSec, exp: session.exp, idleExp },
    { status: 200, headers },
  );
}
