/**
 * 무선 판매 관리 웹앱 — 기존 판매 수정 (Apps Script 의 update-handler.gs 전체를 이 내용으로 교체)
 *
 * 다른 수정 코드와 섞이지 않도록 전용 이름을 쓴다:
 *   요청 action = "sale-update", 함수 = wsHandleSaleUpdate_, 응답 handler = "ws-sale-update"
 * doPost 맨 위에 아래 한 줄이 있어야 한다:
 *   var saleUpdateResponse = wsHandleSaleUpdate_(e); if (saleUpdateResponse) return saleUpdateResponse;
 *
 * 요청: {
 *   secret, action: "sale-update",
 *   target: { sheet, row, no, activatedAt, customer, ctn },   ← 화면에서 본 판매 건
 *   changes: [{ col, before, value }, ...]                     ← 바꿀 칸만 (col: 0=A … 37=AL)
 *            + [{ col, before, check: true }, ...]               ← 쓰지 않고 현재 값만 확인하는 칸 (선택)
 * }
 * - check: true 칸은 장표에 쓰지 않는다. 지금 값이 before 와 같은지만 확인한다 (예전 화면 호환).
 * - 새 행을 찾지 않는다. target 의 "같은 월 시트 / 같은 행"만 고친다.
 * - B열(No.)·C열(개통일)은 절대 고치지 않는다 (요청에 있으면 거부).
 * - 행 번호만 믿지 않고 No.(B)·개통일(C)·고객(D)·CTN(E) 이 화면에서 본 값과 모두 같을 때만 고친다.
 * - 바꿀 칸마다 지금 장표 값이 화면에서 본 값(before)과 같은지 확인한다
 *   (그사이 다른 사람이 고쳤으면 덮어쓰지 않고 거부).
 * - 수식이 들어 있는 칸은 고치지 않는다 (요청에 있으면 거부).
 * - N·U·AB·AC열은 같은 행 수식(N = SUM(O:T), U = SUM(V:Y), AB = Z−AA, AC = N+U+AB)을 유지한다.
 *   웹앱은 이 4칸을 보내지 않으며, 수정한 행의 4칸 중 아직 숫자(예전 저장분)인 칸은
 *   수정과 함께 그 행의 수식으로 바꾼다 (수식은 save-handler.gs 의 wsRowFormula_ 와 같다).
 *   단 요청에 keepRowFormulas: true 가 있으면 이 변환도 하지 않고 바꿀 칸만 쓴다
 *   (카드실적 "등록완료": AG열 하나만 O 로).
 * - 열 구조(6·7행 제목)가 웹앱과 다르면 아무것도 하지 않는다.
 * - LockService 로 저장·삭제·수정이 한 번에 하나만 처리되게 한다.
 * - 수정 후 B열 판매 No. 를 다시 매긴다 (개통구분을 UMNP ↔ 일반으로 바꾸면 그 아래 번호가 바뀜, save-handler.gs 의
 *   wsRenumberSaleRows_). UMNP 행은 No. 가 빈칸이라 화면에서 본 No. 도 빈칸이어야 한다.
 *   keepRowFormulas: true(카드 등록완료)면 번호도 다시 매기지 않는다.
 * - 고객명(D)·CTN(E)을 바꾸면 판매보고 참고내용(notes.gs 보조 시트)의 연결 키도 새 값으로 옮긴다.
 * 시트 이름은 실제 월 시트 이름 "1월"~"12월" 형식 (예: "10월"). "2026년 10월" 같은 화면 표시용 글자는 받지 않는다.
 * 응답: { ok, handler, sheet, row, no, values: [38칸] } (수정 후 그 행의 값)
 */
var WS_SALE_UPDATE_HANDLER = "ws-sale-update";

function wsHandleSaleUpdate_(e) {
  var body = wsBody_(e);
  if (!body || body.action !== "sale-update") return null;
  // 이 handler 의 응답에는 항상 handler 표시를 붙인다 (웹앱이 올바른 코드가 배포됐는지 확인)
  var reply = function (obj) {
    obj.handler = WS_SALE_UPDATE_HANDLER;
    return wsJson_(obj);
  };
  if (!wsAuthorized_(body)) {
    return reply({ ok: false, message: "인증에 실패했습니다." });
  }

  var target = body.target || {};
  var sheetName = String(target.sheet || "").replace(/\s/g, "");
  var rowNumber = Number(target.row);
  if (!wsIsMonthSheetName_(sheetName)) {
    return reply({
      ok: false,
      message:
        "월 시트 이름이 올바르지 않습니다. (받은 값: " +
        String(target.sheet || "") +
        " / 필요한 형식: 1월~12월)",
    });
  }
  if (!(rowNumber >= WS_FIRST_ROW) || Math.floor(rowNumber) !== rowNumber) {
    return reply({ ok: false, message: "행 번호가 올바르지 않습니다." });
  }

  // 바꿀 칸 검사: A, D~AL 만 (B No.·C 개통일 금지), 같은 칸 두 번 금지
  var changes = body.changes;
  if (!Array.isArray(changes) || changes.length === 0 || changes.length > WS_COLUMN_COUNT) {
    return reply({ ok: false, message: "수정할 항목이 없습니다." });
  }
  var seen = {};
  var writes = 0;
  for (var i = 0; i < changes.length; i++) {
    var ch = changes[i] || {};
    var col = Number(ch.col);
    var checkOnly = ch.check === true;
    if (
      Math.floor(col) !== col ||
      col < 0 ||
      col >= WS_COLUMN_COUNT ||
      col === WS_B_INDEX ||
      col === 2 ||
      seen[col] ||
      (!checkOnly && typeof ch.value !== "string" && typeof ch.value !== "number") ||
      typeof ch.before !== "string"
    ) {
      return reply({ ok: false, message: "수정할 항목 형식이 올바르지 않습니다." });
    }
    seen[col] = true;
    if (!checkOnly) writes++;
  }
  if (writes === 0) {
    return reply({ ok: false, message: "수정할 항목이 없습니다." });
  }

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) {
    return reply({
      ok: false,
      message: "다른 작업이 진행 중입니다. 잠시 후 다시 시도해 주세요.",
    });
  }

  try {
    var ss = wsSpreadsheet_();
    var tz = ss.getSpreadsheetTimeZone();
    var sheet = ss.getSheetByName(sheetName);
    if (!sheet) {
      return reply({ ok: false, message: sheetName + " 시트를 찾을 수 없습니다." });
    }
    var problem = wsLayoutProblem_(sheet);
    if (problem) {
      return reply({
        ok: false,
        message:
          sheetName +
          " 시트의 열 구조가 웹앱과 다릅니다 (" +
          problem +
          ") 잘못된 칸에 저장되지 않도록 작업을 멈췄습니다.",
      });
    }
    if (rowNumber > sheet.getLastRow()) {
      return reply({ ok: false, message: "해당 행이 장표에 없습니다." });
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
      return reply({
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
      if (changes[k].check !== true && formulas[c] !== "") {
        return reply({
          ok: false,
          message: wsColumnLetter_(c + 1) + "열은 수식 칸이라 수정할 수 없습니다.",
        });
      }
      if (wsComparable_(current[c], tz) !== wsComparable_(changes[k].before, tz)) {
        mismatches.push(wsColumnLetter_(c + 1) + "열");
      }
    }
    if (mismatches.length > 0) {
      return reply({
        ok: false,
        message:
          "장표 내용이 화면과 달라 수정하지 않았습니다 (" +
          mismatches.join(", ") +
          "). 화면을 새로고침한 뒤 다시 확인해 주세요.",
      });
    }

    // 바뀐 칸만 그 칸에 쓴다 (B·C 열과 다른 칸, 확인만 하는 칸은 그대로)
    for (var w = 0; w < changes.length; w++) {
      if (changes[w].check === true) continue;
      sheet.getRange(rowNumber, Number(changes[w].col) + 1).setValue(changes[w].value);
    }
    // N·U·AB·AC 가 숫자로 고정돼 있으면 같은 행 수식으로 (이미 수식이면 그대로)
    // keepRowFormulas: true 면 바꿀 칸 외에는 아무것도 쓰지 않는다
    for (var s = 0; body.keepRowFormulas !== true && s < WS_ROW_FORMULA_COLUMNS.length; s++) {
      var fc = WS_ROW_FORMULA_COLUMNS[s];
      if (formulas[fc] === "") {
        sheet.getRange(rowNumber, fc + 1).setFormula(wsRowFormula_(fc, rowNumber));
      }
    }
    SpreadsheetApp.flush();
    // B열 판매 No. 다시 매기기 (개통구분 UMNP ↔ 일반 변경 반영). 실패해도 수정은 그대로 (다음 저장 때 다시 매김)
    if (body.keepRowFormulas !== true) {
      try {
        wsRenumberSaleRows_(sheet, tz, rowNumber - WS_FIRST_ROW);
        SpreadsheetApp.flush();
      } catch (err) {
        // 번호만의 문제
      }
    }

    var after = sheet.getRange(rowNumber, 1, 1, WS_COLUMN_COUNT).getValues()[0];
    try {
      wsMoveNoteForRow_(ss, sheetName, current, after, tz);
    } catch (err) {
      // 참고내용 키 이동에 실패해도 판매 수정은 그대로
    }
    return reply({
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
