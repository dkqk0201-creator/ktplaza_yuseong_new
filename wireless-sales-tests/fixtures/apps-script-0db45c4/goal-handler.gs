/**
 * 무선 판매 관리 웹앱 — 월별 무선 목표 (Apps Script 에 새 파일 goal-handler.gs 로 추가)
 *
 * 목표 숫자는 장표가 아니라 Apps Script 의 "스크립트 속성"에 월별로 저장한다.
 * (장표 구조를 건드리지 않고, 여러 기기에서 같은 값을 본다)
 *   키 예: WIRELESS_GOAL_2026-10 = 85
 *
 * 요청: { secret, action: "goal-get", month: "2026-10" }
 *       { secret, action: "goal-set", month: "2026-10", goal: 85 }
 * 응답: { ok, month, goal }  (목표가 없으면 goal: null)
 */
function handleGoalRequest_(e) {
  var body = wsBody_(e);
  if (!body || (body.action !== "goal-get" && body.action !== "goal-set")) {
    return null;
  }
  if (!wsAuthorized_(body)) {
    return wsJson_({ ok: false, message: "인증에 실패했습니다." });
  }

  var month = String(body.month || "");
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    return wsJson_({ ok: false, message: "월 형식이 올바르지 않습니다." });
  }
  var props = PropertiesService.getScriptProperties();
  var key = "WIRELESS_GOAL_" + month;

  if (body.action === "goal-get") {
    var saved = props.getProperty(key);
    return wsJson_({ ok: true, month: month, goal: saved === null ? null : Number(saved) });
  }

  var goal = Number(body.goal);
  if (!(goal >= 0 && goal <= 100000) || Math.floor(goal) !== goal) {
    return wsJson_({ ok: false, message: "목표는 0 이상의 정수여야 합니다." });
  }
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) {
    return wsJson_({
      ok: false,
      message: "다른 작업이 진행 중입니다. 잠시 후 다시 시도해 주세요.",
    });
  }
  try {
    props.setProperty(key, String(goal));
    return wsJson_({ ok: true, month: month, goal: goal });
  } finally {
    lock.releaseLock();
  }
}
