/**
 * 무선 판매 관리 웹앱 — 월별 목표 (Apps Script 에 새 파일 goal-handler.gs 로 추가)
 *
 * 1) 매장 후불 목표 (기존): 장표가 아니라 Apps Script "스크립트 속성"에 월별로 저장한다.
 *      키 예: WIRELESS_GOAL_2026-10 = 85
 *    예산관리 화면(goal-get / goal-set)과 목표관리 화면(goal-board-*)이 이 값 하나를 함께 쓴다 (단일 기준값).
 *
 * 2) 그 밖의 목표 (매장 상품별 · 직원별 · 직원 상품별): 같은 스프레드시트의 숨김 보조 시트 "웹앱목표"
 *      연월 | 대상(매장/직원) | 직원ID | 직원명(저장 당시) | 지표 | 목표 | 수정 시각
 *    (연월·대상·직원ID·지표) 하나에 한 줄만 둔다 (중복 방지). 목표를 지우면(미설정) 그 줄을 지운다.
 *    0 은 "목표 0건"으로 저장하고, 미설정과 구분한다.
 *
 * 3) 변경 이력: 숨김 보조 시트 "웹앱목표이력" — 바뀔 때마다 한 줄 추가 (지우지 않음)
 *      변경 시각 | 연월 | 대상 | 직원ID | 지표 | 변경 전 | 변경 후 | 변경자
 *    기존 goal-set(예산관리 화면)으로 바꾼 매장 후불 목표도 기록한다.
 *
 * 요청:
 *   { secret, action: "goal-get", month: "2026-10" }               → { ok, month, goal }  (기존, 목표가 없으면 goal: null)
 *   { secret, action: "goal-set", month: "2026-10", goal: 85 }     → { ok, month, goal }  (기존)
 *   { secret, action: "goal-board-get", month }                     → { ok, handler, month, goals: [{ scope, staffId, staffName, metric, value }] }
 *   { secret, action: "goal-board-set", month, by, items: [{ scope, staffId, staffName, metric, before, value }] }
 *       before/value: 숫자(0 포함) 또는 null(미설정). 화면에서 본 값(before)과 지금 값이 하나라도 다르면 아무것도 바꾸지 않는다.
 *   { secret, action: "goal-history-get", month }                   → { ok, handler, month, history: [최근 200건] }
 * 보조 시트는 처음 저장할 때 자동으로 만들고 숨긴다. 직접 고치지 마세요.
 */
var WS_GOAL_HANDLER = "ws-goal";
var WS_GOAL_SHEET = "웹앱목표";
var WS_GOAL_HEADER = ["연월", "대상", "직원ID", "직원명", "지표", "목표", "수정 시각"];
var WS_GOAL_HISTORY_SHEET = "웹앱목표이력";
var WS_GOAL_HISTORY_HEADER = ["변경 시각", "연월", "대상", "직원ID", "지표", "변경 전", "변경 후", "변경자"];
/** 웹앱 lib/product-metrics.ts PRODUCT_METRIC_KEYS 와 같게 */
var WS_GOAL_METRICS = ["postpaid", "portIn", "scho", "dicho", "second", "card", "dongpan", "goodbye"];
var WS_GOAL_MAX = 100000;

function handleGoalRequest_(e) {
  var body = wsBody_(e);
  var action = body && body.action;
  if (
    action !== "goal-get" &&
    action !== "goal-set" &&
    action !== "goal-board-get" &&
    action !== "goal-board-set" &&
    action !== "goal-history-get"
  ) {
    return null;
  }
  if (!wsAuthorized_(body)) {
    return wsJson_({ ok: false, message: "인증에 실패했습니다." });
  }

  var month = String(body.month || "");
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    return wsJson_({ ok: false, message: "월 형식이 올바르지 않습니다." });
  }
  if (action === "goal-board-get") return wsGoalBoardGet_(month);
  if (action === "goal-board-set") return wsGoalBoardSet_(month, body);
  if (action === "goal-history-get") return wsGoalHistoryGet_(month);

  var props = PropertiesService.getScriptProperties();
  var key = "WIRELESS_GOAL_" + month;

  if (action === "goal-get") {
    var saved = props.getProperty(key);
    return wsJson_({ ok: true, month: month, goal: saved === null ? null : Number(saved) });
  }

  var goal = Number(body.goal);
  if (!(goal >= 0 && goal <= WS_GOAL_MAX) || Math.floor(goal) !== goal) {
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
    var before = props.getProperty(key);
    props.setProperty(key, String(goal));
    try {
      if (before === null || Number(before) !== goal) {
        wsGoalHistoryAppend_(wsSpreadsheet_(), [
          [new Date(), "'" + month, "매장", "", "postpaid", before === null ? "" : Number(before), goal, "점장(예산관리)"],
        ]);
      }
    } catch (err) {
      // 이력 기록 실패는 목표 저장 결과에 영향 없음
    }
    return wsJson_({ ok: true, month: month, goal: goal });
  } finally {
    lock.releaseLock();
  }
}

function wsGoalReply_(obj) {
  obj.handler = WS_GOAL_HANDLER;
  return wsJson_(obj);
}

function wsGoalSheet_(ss, name, header, create) {
  var sheet = ss.getSheetByName(name);
  if (!sheet && create) {
    sheet = ss.insertSheet(name);
    sheet.getRange(1, 1, 1, header.length).setValues([header]);
    sheet.hideSheet();
  }
  return sheet;
}

function wsGoalText_(v) {
  return String(v === null || v === undefined ? "" : v).replace(/^'/, "").trim();
}

/** 보조 시트의 그 달 목표 { "scope|staffId|metric": { row, value, staffName } } */
function wsGoalRows_(sheet, month) {
  var map = {};
  if (!sheet) return map;
  var last = sheet.getLastRow();
  if (last < 2) return map;
  var rows = sheet.getRange(2, 1, last - 1, WS_GOAL_HEADER.length).getValues();
  for (var i = 0; i < rows.length; i++) {
    if (wsGoalText_(rows[i][0]) !== month) continue;
    var scope = wsGoalText_(rows[i][1]) === "직원" ? "staff" : "store";
    var key = scope + "|" + wsGoalText_(rows[i][2]) + "|" + wsGoalText_(rows[i][4]);
    var value = rows[i][5] === "" || rows[i][5] === null ? null : Number(rows[i][5]);
    map[key] = { row: i + 2, value: value, staffName: wsGoalText_(rows[i][3]) };
  }
  return map;
}

function wsGoalBoardGet_(month) {
  var ss = wsSpreadsheet_();
  var map = wsGoalRows_(wsGoalSheet_(ss, WS_GOAL_SHEET, WS_GOAL_HEADER, false), month);
  var goals = [];
  for (var key in map) {
    if (!Object.prototype.hasOwnProperty.call(map, key)) continue;
    var parts = key.split("|");
    if (map[key].value === null || !isFinite(map[key].value)) continue;
    goals.push({ scope: parts[0], staffId: parts[1], staffName: map[key].staffName, metric: parts[2], value: map[key].value });
  }
  // 매장 후불 목표는 스크립트 속성 (예산관리 화면과 같은 값)
  var saved = PropertiesService.getScriptProperties().getProperty("WIRELESS_GOAL_" + month);
  if (saved !== null) goals.push({ scope: "store", staffId: "", staffName: "", metric: "postpaid", value: Number(saved) });
  return wsGoalReply_({ ok: true, month: month, goals: goals });
}

/** 항목 검사. 문제가 있으면 안내 문구 */
function wsGoalItemError_(item) {
  if (!item || typeof item !== "object") return "목표 형식이 올바르지 않습니다.";
  if (item.scope !== "store" && item.scope !== "staff") return "목표 대상이 올바르지 않습니다.";
  if (item.scope === "staff" && !/^st-\d{3}$/.test(String(item.staffId || ""))) return "직원 ID 가 올바르지 않습니다.";
  if (item.scope === "store" && item.staffId) return "매장 목표에는 직원 ID 를 넣지 않습니다.";
  if (WS_GOAL_METRICS.indexOf(item.metric) < 0) return "목표 지표가 올바르지 않습니다.";
  var check = function (v) {
    return v === null || (typeof v === "number" && v >= 0 && v <= WS_GOAL_MAX && Math.floor(v) === v);
  };
  if (!check(item.before) || !check(item.value)) return "목표는 0 이상의 정수이거나 미설정이어야 합니다.";
  if (typeof item.staffName !== "string" || item.staffName.length > 20) return "직원명이 올바르지 않습니다.";
  return "";
}

function wsGoalBoardSet_(month, body) {
  var items = body.items;
  if (!Array.isArray(items) || items.length === 0 || items.length > 200) {
    return wsGoalReply_({ ok: false, message: "저장할 목표가 없습니다." });
  }
  var by = String(body.by || "점장").slice(0, 20);
  var seen = {};
  for (var i = 0; i < items.length; i++) {
    var problem = wsGoalItemError_(items[i]);
    if (problem) return wsGoalReply_({ ok: false, message: problem });
    var k = items[i].scope + "|" + (items[i].staffId || "") + "|" + items[i].metric;
    if (seen[k]) return wsGoalReply_({ ok: false, message: "같은 목표가 두 번 들어 있습니다." });
    seen[k] = true;
  }
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) {
    return wsGoalReply_({ ok: false, message: "다른 작업이 진행 중입니다. 잠시 후 다시 시도해 주세요." });
  }
  try {
    var ss = wsSpreadsheet_();
    var props = PropertiesService.getScriptProperties();
    var propKey = "WIRELESS_GOAL_" + month;
    var sheet = wsGoalSheet_(ss, WS_GOAL_SHEET, WS_GOAL_HEADER, false);
    var map = wsGoalRows_(sheet, month);
    var currentOf = function (item) {
      if (item.scope === "store" && item.metric === "postpaid") {
        var p = props.getProperty(propKey);
        return p === null ? null : Number(p);
      }
      var rec = map[item.scope + "|" + (item.staffId || "") + "|" + item.metric];
      return rec ? rec.value : null;
    };
    // 1) 모두 확인 (하나라도 화면과 다르면 아무것도 바꾸지 않음)
    var stale = [];
    for (var a = 0; a < items.length; a++) {
      if (currentOf(items[a]) !== items[a].before) stale.push(items[a].metric);
    }
    if (stale.length) {
      return wsGoalReply_({ ok: false, message: "다른 곳에서 목표가 바뀌었습니다. 화면을 새로고침한 뒤 다시 입력해 주세요." });
    }
    // 2) 쓰기 + 이력
    var history = [];
    var now = new Date();
    var deleteRows = [];
    for (var b = 0; b < items.length; b++) {
      var item = items[b];
      if (item.before === item.value) continue;
      var scopeLabel = item.scope === "staff" ? "직원" : "매장";
      history.push([now, "'" + month, scopeLabel, item.staffId || "", item.metric, item.before === null ? "" : item.before, item.value === null ? "" : item.value, by]);
      if (item.scope === "store" && item.metric === "postpaid") {
        if (item.value === null) props.deleteProperty(propKey);
        else props.setProperty(propKey, String(item.value));
        continue;
      }
      var key = item.scope + "|" + (item.staffId || "") + "|" + item.metric;
      var rec = map[key];
      if (item.value === null) {
        if (rec) deleteRows.push(rec.row);
        continue;
      }
      sheet = sheet || wsGoalSheet_(ss, WS_GOAL_SHEET, WS_GOAL_HEADER, true);
      var values = ["'" + month, scopeLabel, item.staffId ? "'" + item.staffId : "", item.staffName ? "'" + item.staffName : "", item.metric, item.value, now];
      if (rec) {
        sheet.getRange(rec.row, 1, 1, WS_GOAL_HEADER.length).setValues([values]);
      } else {
        var row = sheet.getLastRow() + 1;
        sheet.getRange(row, 1, 1, WS_GOAL_HEADER.length).setValues([values]);
        map[key] = { row: row, value: item.value, staffName: item.staffName };
      }
    }
    // 아래 줄부터 지워야 위 줄 번호가 밀리지 않는다
    deleteRows.sort(function (x, y) {
      return y - x;
    });
    for (var d = 0; d < deleteRows.length; d++) sheet.deleteRow(deleteRows[d]);
    if (history.length) wsGoalHistoryAppend_(ss, history);
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }
  return wsGoalBoardGet_(month);
}

function wsGoalHistoryAppend_(ss, rows) {
  var sheet = wsGoalSheet_(ss, WS_GOAL_HISTORY_SHEET, WS_GOAL_HISTORY_HEADER, true);
  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, WS_GOAL_HISTORY_HEADER.length).setValues(rows);
}

function wsGoalHistoryGet_(month) {
  var ss = wsSpreadsheet_();
  var sheet = wsGoalSheet_(ss, WS_GOAL_HISTORY_SHEET, WS_GOAL_HISTORY_HEADER, false);
  var out = [];
  if (sheet && sheet.getLastRow() >= 2) {
    var tz = ss.getSpreadsheetTimeZone();
    var rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, WS_GOAL_HISTORY_HEADER.length).getValues();
    for (var i = rows.length - 1; i >= 0 && out.length < 200; i--) {
      if (wsGoalText_(rows[i][1]) !== month) continue;
      var num = function (v) {
        return v === "" || v === null ? null : Number(v);
      };
      out.push({
        at: rows[i][0] instanceof Date ? Utilities.formatDate(rows[i][0], tz, "yyyy-MM-dd HH:mm") : wsGoalText_(rows[i][0]),
        scope: wsGoalText_(rows[i][2]) === "직원" ? "staff" : "store",
        staffId: wsGoalText_(rows[i][3]),
        metric: wsGoalText_(rows[i][4]),
        before: num(rows[i][5]),
        after: num(rows[i][6]),
        by: wsGoalText_(rows[i][7]),
      });
    }
  }
  return wsGoalReply_({ ok: true, month: month, history: out });
}
