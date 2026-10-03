/**
 * 무선 판매 관리 웹앱 — 기존 판매 수정 (Apps Script 에 새 파일 update-handler.gs 로 추가)
 *
 * 요청: {
 *   secret, action: "update",
 *   target: { sheet, row, no, activatedAt, customer, ctn },   ← 화면에서 본 판매 건
 *   changes: [{ col, before, value }, ...]                     ← 바꿀 칸만 (col: 0=A … 37=AL)
 * }
 * - 새 행을 찾지 않는다. target 의 "같은 월 시트 / 같은 행"만 고친다.
 * - B열(No.)·C열(개통일)은 절대 고치지 않는다 (요청에 있으면 거부).
 * - 행 번호만 믿지 않고 No.(B)·개통일(C)·고객(D)·CTN(E) 이 화면에서 본 값과 모두 같을 때만 고친다.
 * - 바꿀 칸마다 지금 장표 값이 화면에서 본 값(before)과 같은지 확인한다
 *   (그사이 다른 사람이 고쳤으면 덮어쓰지 않고 거부).
 * - 수식이 들어 있는 칸은 고치지 않는다 (요청에 있으면 거부).
 * - 열 구조(6·7행 제목)가 웹앱과 다르면 아무것도 하지 않는다.
 * - LockService 로 저장·삭제·수정이 한 번에 하나만 처리되게 한다.
 * 응답: { ok, sheet, row, no, values: [38칸] } (수정 후 그 행의 값)
 */
function handleUpdateRequest_(e) {
  var body = wsBody_(e);
  if (!body || body.action !== "update") return null;
  if (!wsAuthorized_(body)) {
    return wsJson_({ ok: false, message: "인증에 실패했습니다." });
  }

  var target = body.target || {};
  var sheetName = String(target.sheet || "");
  var rowNumber = Number(target.row);
  if (!wsIsMonthSheetName_(sheetName)) {
    return wsJson_({ ok: false, message: "시트 이름이 올바르지 않습니다." });
  }
  if (!(rowNumber >= WS_FIRST_ROW) || Math.floor(rowNumber) !== rowNumber) {
    return wsJson_({ ok: false, message: "행 번호가 올바르지 않습니다." });
  }

  // 바꿀 칸 검사: A, D~AL 만 (B No.·C 개통일 금지), 같은 칸 두 번 금지
  var changes = body.changes;
  if (!Array.isArray(changes) || changes.length === 0 || changes.length > WS_COLUMN_COUNT) {
    return wsJson_({ ok: false, message: "수정할 항목이 없습니다." });
  }
  var seen = {};
  for (var i = 0; i < changes.length; i++) {
    var ch = changes[i] || {};
    var col = Number(ch.col);
    if (
      Math.floor(col) !== col ||
      col < 0 ||
      col >= WS_COLUMN_COUNT ||
      col === WS_B_INDEX ||
      col === 2 ||
      seen[col] ||
      (typeof ch.value !== "string" && typeof ch.value !== "number") ||
      typeof ch.before !== "string"
    ) {
      return wsJson_({ ok: false, message: "수정할 항목 형식이 올바르지 않습니다." });
    }
    seen[col] = true;
  }

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) {
    return wsJson_({
      ok: false,
      message: "다른 작업이 진행 중입니다. 잠시 후 다시 시도해 주세요.",
    });
  }

  try {
    var ss = wsSpreadsheet_();
    var tz = ss.getSpreadsheetTimeZone();
    var sheet = ss.getSheetByName(sheetName);
    if (!sheet) {
      return wsJson_({ ok: false, message: sheetName + " 시트를 찾을 수 없습니다." });
    }
    var layoutError = wsLayoutError_(sheet);
    if (layoutError) return layoutError;
    if (rowNumber > sheet.getLastRow()) {
      return wsJson_({ ok: false, message: "해당 행이 장표에 없습니다." });
    }

    var range = sheet.getRange(rowNumber, 1, 1, WS_COLUMN_COUNT);
    var current = range.getValues()[0];
    var formulas = range.getFormulas()[0];
    var text = function (v) {
      return wsText_(v, tz);
    };
    var digits = function (v) {
      return text(v).replace(/\D/g, "");
    };

    if (wsIsEmptySale_(current)) {
      return wsJson_({
        ok: false,
        message: "판매 내용이 없는 행입니다. 화면을 새로고침해 주세요.",
      });
    }
    var mismatches = [];
    if (text(current[WS_B_INDEX]) !== text(target.no)) mismatches.push("No.");
    if (text(current[2]) !== text(target.activatedAt)) mismatches.push("개통일");
    if (text(current[3]) !== text(target.customer)) mismatches.push("고객");
    if (digits(current[4]) !== digits(target.ctn)) mismatches.push("CTN");
    for (var k = 0; k < changes.length; k++) {
      var c = Number(changes[k].col);
      if (formulas[c] !== "") {
        return wsJson_({
          ok: false,
          message: wsColumnLetter_(c + 1) + "열은 수식 칸이라 수정할 수 없습니다.",
        });
      }
      if (wsComparable_(current[c], tz) !== wsComparable_(changes[k].before, tz)) {
        mismatches.push(wsColumnLetter_(c + 1) + "열");
      }
    }
    if (mismatches.length > 0) {
      return wsJson_({
        ok: false,
        message:
          "장표 내용이 화면과 달라 수정하지 않았습니다 (" +
          mismatches.join(", ") +
          "). 화면을 새로고침한 뒤 다시 확인해 주세요.",
      });
    }

    // 바뀐 칸만 그 칸에 쓴다 (B·C 열과 다른 칸은 그대로)
    for (var w = 0; w < changes.length; w++) {
      sheet.getRange(rowNumber, Number(changes[w].col) + 1).setValue(changes[w].value);
    }
    SpreadsheetApp.flush();

    var after = sheet.getRange(rowNumber, 1, 1, WS_COLUMN_COUNT).getValues()[0];
    return wsJson_({
      ok: true,
      sheet: sheetName,
      row: rowNumber,
      no: text(after[WS_B_INDEX]),
      values: after.map(function (v) {
        return v instanceof Date ? Utilities.formatDate(v, tz, "yyyy-MM-dd") : v;
      }),
      message: "판매내역이 수정되었습니다.",
    });
  } finally {
    lock.releaseLock();
  }
}

/** 비교용 값: 앞뒤 공백·"-"·쉼표·"원" 차이는 같은 값으로 본다 */
function wsComparable_(v, tz) {
  var t = wsText_(v, tz);
  if (t === "-") return "";
  var n = t.replace(/,/g, "").replace(/원$/, "");
  if (/^-?\d+(\.\d+)?$/.test(n)) return String(Number(n));
  return t;
}
