/**
 * 무선 판매 관리 웹앱 — 검수 보완 요청 (Apps Script 에 새 파일 inspection-review.gs 로 추가)
 *
 * 검수관리 판매 상세에서 점장이 적은 "미비내용"과 보완 요청 상태·이력을
 * 같은 스프레드시트의 숨김 보조 시트 "검수보완" 에 보관한다.
 *   - 무선장표 월 시트·양식 시트의 열 구조·금액·수식·메모·No. 는 바꾸지 않는다 (이 파일은 월 시트에 쓰지 않음).
 *   - 판매 건 연결 키 = notes.gs 의 wsNoteKey_ (월 시트 | 개통일 | CTN 숫자 | 고객명).
 *     행 번호·No. 를 쓰지 않으므로 날짜순 정렬·No. 다시 매기기에도 다른 고객에 붙지 않는다.
 *   - 같은 키 판매가 월 시트에 2건 이상이면 붙이지도, 저장하지도 않는다 (다른 판매에 붙는 것 방지).
 *   - 상태: 요청중 → 검수완료(G열 O 저장 시 자동) / 취소. 끝난 기록은 지우지 않고 이력으로 남긴다.
 *   - 판매 수정으로 고객명·CTN 이 바뀌면 키를 옮기고, 판매 삭제 시에는 키를 "삭제|…" 로 바꿔
 *     같은 고객·날짜·CTN 으로 다시 등록한 판매에 예전 기록이 붙지 않게 한다 (기록 자체는 보관).
 *
 * 요청 (update-handler.gs 의 wsHandleSaleUpdate_ 가 이 action 을 넘겨준다 → doPost 수정 불필요):
 *   { secret, action: "inspection-review", op: "save" | "cancel",
 *     target: { sheet, row, no, activatedAt, customer, ctn },
 *     before: "화면에서 본 진행 중 미비내용 (없으면 \"\")", content: "새 미비내용" (save) }
 * 응답: { ok, handler: "ws-inspection-review", review: { active, history }, message }
 * 보조 시트는 처음 저장할 때 자동으로 만들고 숨긴다. 직접 고치지 마세요.
 */
var WS_REVIEW_HANDLER = "ws-inspection-review";
var WS_REVIEW_SHEET = "검수보완";
var WS_REVIEW_HEADER = [
  "ID",
  "키",
  "상태",
  "월 시트",
  "개통일",
  "고객",
  "CTN",
  "판매자",
  "미비내용",
  "요청 시각",
  "수정 시각",
  "종료 시각",
  "이력(JSON)",
];
var WS_REVIEW_COLS = WS_REVIEW_HEADER.length;
var WS_REVIEW_ACTIVE = "요청중";
var WS_REVIEW_MAX = 1000; // 미비내용 글자 수
var WS_REVIEW_HISTORY_MAX = 50; // 기록 1건의 이력 수

function wsReviewSheet_(ss, create) {
  var sheet = ss.getSheetByName(WS_REVIEW_SHEET);
  if (!sheet && create) {
    sheet = ss.insertSheet(WS_REVIEW_SHEET);
    sheet.getRange(1, 1, 1, WS_REVIEW_COLS).setValues([WS_REVIEW_HEADER]);
    sheet.hideSheet();
  }
  return sheet;
}

/** 보조 시트 전체 기록 [{ row, id, key, status, ... }] */
function wsReadReviews_(sheet) {
  var out = [];
  if (!sheet) return out;
  var last = sheet.getLastRow();
  if (last < 2) return out;
  var rows = sheet.getRange(2, 1, last - 1, WS_REVIEW_COLS).getValues();
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    if (!String(r[1] || "")) continue;
    var history = [];
    try {
      history = JSON.parse(String(r[12] || "[]"));
      if (!Array.isArray(history)) history = [];
    } catch (err) {
      history = [];
    }
    out.push({
      row: i + 2,
      id: String(r[0] || ""),
      key: String(r[1] || ""),
      status: String(r[2] || ""),
      sheet: String(r[3] || ""),
      date: String(r[4] || ""),
      customer: String(r[5] || ""),
      ctn: String(r[6] || ""),
      staff: String(r[7] || ""),
      content: String(r[8] || ""),
      requestedAt: String(r[9] || ""),
      updatedAt: String(r[10] || ""),
      closedAt: String(r[11] || ""),
      history: history,
    });
  }
  return out;
}

function wsWriteReview_(sheet, rec) {
  var record = [
    "'" + rec.id,
    "'" + rec.key,
    "'" + rec.status,
    "'" + rec.sheet,
    "'" + rec.date,
    "'" + rec.customer,
    "'" + rec.ctn,
    "'" + rec.staff,
    "'" + rec.content,
    "'" + rec.requestedAt,
    "'" + rec.updatedAt,
    "'" + rec.closedAt,
    "'" + JSON.stringify(rec.history.slice(-WS_REVIEW_HISTORY_MAX)),
  ];
  var row = rec.row || sheet.getLastRow() + 1;
  sheet.getRange(row, 1, 1, WS_REVIEW_COLS).setValues([record]);
  rec.row = row;
}

function wsReviewNow_(tz) {
  return Utilities.formatDate(new Date(), tz, "yyyy-MM-dd HH:mm");
}

/** 화면에 보낼 모양: 진행 중 요청 1건 + 끝난 기록(최근 것 먼저, 최대 10건) */
function wsReviewView_(records) {
  var active = null;
  var history = [];
  for (var i = 0; i < records.length; i++) {
    var r = records[i];
    if (r.status === WS_REVIEW_ACTIVE) {
      active = {
        content: r.content,
        staff: r.staff,
        requestedAt: r.requestedAt,
        updatedAt: r.updatedAt,
      };
    } else {
      history.push({
        status: r.status,
        content: r.content,
        staff: r.staff,
        requestedAt: r.requestedAt,
        closedAt: r.closedAt,
      });
    }
  }
  history.reverse();
  return { active: active, history: history.slice(0, 10) };
}

function wsReviewsForKey_(records, key) {
  var out = [];
  for (var i = 0; i < records.length; i++) if (records[i].key === key) out.push(records[i]);
  return out;
}

/** 조회용: 월 시트 판매 행들에 검수 보완 기록 붙이기 (같은 키가 정확히 1건인 판매에만) */
function wsAttachReviews_(ss, sheetName, rows, tz) {
  var sheet = wsReviewSheet_(ss, false);
  if (!sheet) return;
  var records = wsReadReviews_(sheet);
  if (records.length === 0) return;
  var byKey = {};
  for (var i = 0; i < records.length; i++) {
    (byKey[records[i].key] = byKey[records[i].key] || []).push(records[i]);
  }
  var keys = [];
  var count = {};
  for (var j = 0; j < rows.length; j++) {
    var key = wsNoteKey_(sheetName, rows[j].values, tz);
    keys.push(key);
    if (key) count[key] = (count[key] || 0) + 1;
  }
  for (var k = 0; k < rows.length; k++) {
    var kk = keys[k];
    if (kk && count[kk] === 1 && byKey[kk]) rows[k].review = wsReviewView_(byKey[kk]);
  }
}

/**
 * G열(검수)이 O 로 바뀐 판매의 진행 중 요청을 "검수완료" 로 닫는다 (기록은 이력으로 보관).
 * update-handler.gs 가 판매 수정·검수완료 저장 뒤 부른다. 닫은 기록이 있으면 true
 */
function wsCloseReviewForRow_(ss, sheetName, rowValues, tz) {
  var key = wsNoteKey_(sheetName, rowValues, tz);
  if (!key) return false;
  var sheet = wsReviewSheet_(ss, false);
  if (!sheet) return false;
  var records = wsReviewsForKey_(wsReadReviews_(sheet), key);
  var closed = false;
  var now = wsReviewNow_(tz);
  for (var i = 0; i < records.length; i++) {
    if (records[i].status !== WS_REVIEW_ACTIVE) continue;
    records[i].status = "검수완료";
    records[i].closedAt = now;
    records[i].history.push({ at: now, action: "검수완료" });
    wsWriteReview_(sheet, records[i]);
    closed = true;
  }
  return closed;
}

/** 판매 수정으로 고객명·CTN 이 바뀌었을 때 보완 기록 키를 새 값으로 옮기기 */
function wsMoveReviewsForRow_(ss, sheetName, beforeValues, afterValues, tz) {
  var from = wsNoteKey_(sheetName, beforeValues, tz);
  var info = wsNoteInfo_(sheetName, afterValues, tz);
  if (!from || !info.key || from === info.key) return;
  var sheet = wsReviewSheet_(ss, false);
  if (!sheet) return;
  var records = wsReviewsForKey_(wsReadReviews_(sheet), from);
  for (var i = 0; i < records.length; i++) {
    records[i].key = info.key;
    records[i].customer = info.customer;
    records[i].ctn = info.ctn;
    wsWriteReview_(sheet, records[i]);
  }
}

/**
 * 판매 삭제 전 값으로: 그 판매의 보완 기록을 보관 상태로 (키를 "삭제|…" 로 바꿔 다시는 붙지 않게).
 * 진행 중 요청은 "판매삭제" 로 닫는다. 기록 자체는 지우지 않는다.
 */
function wsArchiveReviewsForRow_(ss, sheetName, rowValues, tz) {
  var key = wsNoteKey_(sheetName, rowValues, tz);
  if (!key) return;
  var sheet = wsReviewSheet_(ss, false);
  if (!sheet) return;
  var records = wsReviewsForKey_(wsReadReviews_(sheet), key);
  var now = wsReviewNow_(tz);
  for (var i = 0; i < records.length; i++) {
    if (records[i].status === WS_REVIEW_ACTIVE) {
      records[i].status = "판매삭제";
      records[i].closedAt = now;
    }
    records[i].history.push({ at: now, action: "판매삭제" });
    records[i].key = "삭제|" + now + "|" + key;
    wsWriteReview_(sheet, records[i]);
  }
}

/** 보완 요청 저장·취소 (update-handler.gs 의 wsHandleSaleUpdate_ 가 넘겨준다) */
function wsHandleInspectionReview_(body) {
  var reply = function (obj) {
    obj.handler = WS_REVIEW_HANDLER;
    return wsJson_(obj);
  };
  if (!wsAuthorized_(body)) {
    return reply({ ok: false, message: "인증에 실패했습니다." });
  }
  var op = body.op;
  if (op !== "save" && op !== "cancel") {
    return reply({ ok: false, message: "요청 형식이 올바르지 않습니다." });
  }
  var content = typeof body.content === "string" ? body.content.trim() : "";
  if (op === "save" && (!content || content.length > WS_REVIEW_MAX)) {
    return reply({
      ok: false,
      message: content ? "미비내용이 너무 깁니다 (" + WS_REVIEW_MAX + "자까지)." : "미비내용을 입력해 주세요.",
    });
  }
  if (typeof body.before !== "string") {
    return reply({ ok: false, message: "요청 형식이 올바르지 않습니다." });
  }
  var before = body.before.trim();

  var target = body.target || {};
  var sheetName = String(target.sheet || "").replace(/\s/g, "");
  var rowNumber = Number(target.row);
  if (!wsIsMonthSheetName_(sheetName)) {
    return reply({ ok: false, message: "월 시트 이름이 올바르지 않습니다." });
  }
  if (!(rowNumber >= WS_FIRST_ROW) || Math.floor(rowNumber) !== rowNumber) {
    return reply({ ok: false, message: "행 번호가 올바르지 않습니다." });
  }

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) {
    return reply({ ok: false, message: "다른 작업이 진행 중입니다. 잠시 후 다시 시도해 주세요." });
  }
  try {
    var ss = wsSpreadsheet_();
    var tz = ss.getSpreadsheetTimeZone();
    var sheet = ss.getSheetByName(sheetName);
    if (!sheet) return reply({ ok: false, message: sheetName + " 시트를 찾을 수 없습니다." });
    var problem = wsLayoutProblem_(sheet);
    if (problem) {
      return reply({ ok: false, message: sheetName + " 시트의 열 구조가 웹앱과 다릅니다 (" + problem + ")" });
    }
    if (rowNumber > sheet.getLastRow()) {
      return reply({ ok: false, message: "해당 행이 장표에 없습니다." });
    }
    // 판매 확인: 같은 행 + No.·개통일·고객·CTN 이 화면에서 본 값과 모두 같을 때만 (월 시트는 읽기만)
    var current = sheet.getRange(rowNumber, 1, 1, WS_COLUMN_COUNT).getValues()[0];
    var text = function (v) {
      return wsText_(v, tz);
    };
    if (wsIsEmptySale_(current)) {
      return reply({ ok: false, message: "판매 내용이 없는 행입니다. 화면을 새로고침해 주세요." });
    }
    var mismatches = [];
    if (text(current[WS_B_INDEX]) !== text(target.no)) mismatches.push("No.");
    if (text(current[2]) !== text(target.activatedAt)) mismatches.push("개통일");
    if (text(current[3]) !== text(target.customer)) mismatches.push("고객");
    if (text(current[4]).replace(/\D/g, "") !== text(target.ctn).replace(/\D/g, "")) mismatches.push("CTN");
    if (mismatches.length > 0) {
      return reply({
        ok: false,
        message:
          "장표 내용이 화면과 달라 저장하지 않았습니다 (" +
          mismatches.join(", ") +
          "). 화면을 새로고침한 뒤 다시 확인해 주세요.",
      });
    }
    var info = wsNoteInfo_(sheetName, current, tz);
    if (!info.key) {
      return reply({ ok: false, message: "개통일·CTN 이 없는 판매라 보완 요청을 저장할 수 없습니다." });
    }
    if (wsCountNoteKey_(sheet, tz, info.key) !== 1) {
      return reply({
        ok: false,
        message:
          "같은 개통일·고객·CTN 판매가 장표에 2건 이상 있어 보완 요청이 다른 판매에 붙을 수 있습니다. 저장하지 않았습니다.",
      });
    }
    if (op === "save" && text(current[6]).toUpperCase() === "O") {
      return reply({ ok: false, message: "이미 검수완료(G열 O)된 판매입니다. 화면을 새로고침해 주세요." });
    }

    var reviewSheet = wsReviewSheet_(ss, op === "save");
    var records = reviewSheet ? wsReviewsForKey_(wsReadReviews_(reviewSheet), info.key) : [];
    var active = null;
    for (var i = 0; i < records.length; i++) {
      if (records[i].status === WS_REVIEW_ACTIVE) active = records[i];
    }
    // 그사이 다른 사람이 저장·수정·완료했으면 덮어쓰지 않는다
    if ((active ? active.content.trim() : "") !== before) {
      return reply({
        ok: false,
        message: "저장된 보완 요청이 화면과 달라 저장하지 않았습니다. 화면을 새로고침한 뒤 다시 확인해 주세요.",
      });
    }
    var now = wsReviewNow_(tz);
    var staff = text(current[12]);
    var message;
    if (op === "cancel") {
      if (!active) return reply({ ok: false, message: "진행 중인 보완 요청이 없습니다." });
      active.status = "취소";
      active.closedAt = now;
      active.history.push({ at: now, action: "취소" });
      wsWriteReview_(reviewSheet, active);
      message = "보완 요청을 취소했습니다.";
    } else if (active) {
      if (active.content.trim() !== content) {
        active.content = content;
        active.updatedAt = now;
        active.staff = staff;
        active.history.push({ at: now, action: "수정", content: content.slice(0, 300) });
        wsWriteReview_(reviewSheet, active);
      }
      message = "보완 요청이 저장되었습니다.";
    } else {
      var rec = {
        id: Utilities.getUuid ? Utilities.getUuid() : String(new Date().getTime()),
        key: info.key,
        status: WS_REVIEW_ACTIVE,
        sheet: sheetName,
        date: info.date,
        customer: info.customer,
        ctn: info.ctn,
        staff: staff,
        content: content,
        requestedAt: now,
        updatedAt: now,
        closedAt: "",
        history: [{ at: now, action: "요청", content: content.slice(0, 300) }],
      };
      wsWriteReview_(reviewSheet, rec);
      records.push(rec);
      message = "보완 요청이 저장되었습니다.";
    }
    SpreadsheetApp.flush();
    var saved = wsReviewsForKey_(wsReadReviews_(wsReviewSheet_(ss, false)), info.key);
    return reply({ ok: true, review: wsReviewView_(saved), message: message });
  } finally {
    lock.releaseLock();
  }
}
