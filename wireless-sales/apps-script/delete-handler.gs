/**
 * 무선 판매 관리 웹앱 — 판매내역 삭제 (A~AL 38칸, 기존 delete-handler.gs 전체를 이 내용으로 교체)
 *
 * 요청: { secret, action: "delete", target: { sheet, row, no, activatedAt, customer, ctn } }
 *   - 행 자체는 지우지 않는다. 대상 행의 A열과 C~AL열의 "값"만 비운다 (서식 유지).
 *   - B열(No.)과 수식이 들어 있는 칸은 절대 건드리지 않는다.
 *     단 N·U·AB·AC열의 행별 수식(save-handler.gs 의 판매 행 수식)은 지우고 빈 행 모양으로 되돌린다.
 *   - "무선장표 양식" 시트의 같은 행에서 "-" 인 칸은 "-" 를 다시 넣어 처음 빈 행 모양으로 되돌린다.
 *     (양식 시트가 없으면 가장 가까운 빈 판매 행을 참고한다)
 *   - 행 번호만 믿지 않고 No.(B)·개통일(C)·고객(D)·CTN(E) 이 화면에서 본 값과 모두 같을 때만 지운다.
 *   - 열 구조(6·7행 제목)가 웹앱과 다르면 아무것도 하지 않는다.
 *   - LockService 로 한 번에 하나의 저장·삭제만 처리한다.
 *   - 그 판매의 판매보고 참고내용(notes.gs 보조 시트)도 함께 지운다.
 */
function handleDeleteRequest_(e) {
  var body = wsBody_(e);
  if (!body || body.action !== "delete") return null;
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

    var lastRow = sheet.getLastRow();
    if (rowNumber > lastRow) {
      return wsJson_({ ok: false, message: "해당 행이 장표에 없습니다." });
    }

    var all = sheet
      .getRange(WS_FIRST_ROW, 1, lastRow - WS_FIRST_ROW + 1, WS_COLUMN_COUNT)
      .getValues();
    var index = rowNumber - WS_FIRST_ROW;
    var current = all[index];
    var formulas = sheet.getRange(rowNumber, 1, 1, WS_COLUMN_COUNT).getFormulas()[0];
    var text = function (v) {
      return wsText_(v, tz);
    };
    var digits = function (v) {
      return text(v).replace(/\D/g, "");
    };

    // 1) 이미 비어 있는 행이면 지우지 않는다
    if (wsIsEmptySale_(current)) {
      return wsJson_({
        ok: false,
        message: "이미 비어 있는 행입니다. 화면을 새로고침해 주세요.",
      });
    }

    // 2) 화면에서 본 값과 지금 장표 값이 모두 같을 때만 지운다
    var mismatches = [];
    if (text(current[WS_B_INDEX]) !== text(target.no)) mismatches.push("No.");
    if (text(current[2]) !== text(target.activatedAt)) mismatches.push("개통일");
    if (text(current[3]) !== text(target.customer)) mismatches.push("고객");
    if (digits(current[4]) !== digits(target.ctn)) mismatches.push("CTN");
    if (mismatches.length > 0) {
      return wsJson_({
        ok: false,
        message:
          "장표 내용이 화면과 달라 삭제하지 않았습니다 (" +
          mismatches.join(", ") +
          "). 화면을 새로고침한 뒤 다시 확인해 주세요.",
      });
    }

    // 3) 빈 행 모양 참고: 양식 시트의 같은 행 → 없으면 가장 가까운 빈 판매 행 (아래쪽 먼저)
    var reference = null;
    var template = ss.getSheetByName(WS_TEMPLATE_SHEET);
    if (
      template &&
      template.getLastRow() >= rowNumber &&
      template.getMaxColumns() >= WS_COLUMN_COUNT &&
      !wsLayoutProblem_(template)
    ) {
      reference = template.getRange(rowNumber, 1, 1, WS_COLUMN_COUNT).getValues()[0];
    }
    for (var down = index + 1; down < all.length && !reference; down++) {
      if (text(all[down][WS_B_INDEX]) !== "" && wsIsEmptySale_(all[down])) {
        reference = all[down];
      }
    }
    for (var up = index - 1; up >= 0 && !reference; up--) {
      if (text(all[up][WS_B_INDEX]) !== "" && wsIsEmptySale_(all[up])) {
        reference = all[up];
      }
    }

    // 4) 참고내용(보조 시트) 먼저 지운다 — 같은 키가 나중에 다른 판매에 붙지 않게
    try {
      wsDeleteNoteForRow_(ss, sheetName, current, tz);
    } catch (err) {
      // 참고내용 정리에 실패해도 판매 삭제는 진행 (조회 시 키가 맞는 판매가 없으면 붙지 않음)
    }

    // 5) A열·C~AL열만, 수식 칸은 건너뛰고(N·U·AB·AC 행별 수식은 비움), 이어진 칸끼리 묶어서 값만 바꾼다
    var clearable = function (col) {
      return col !== WS_B_INDEX && (formulas[col] === "" || wsIsRowFormulaColumn_(col));
    };
    var c = 0;
    while (c < WS_COLUMN_COUNT) {
      if (!clearable(c)) {
        c++;
        continue;
      }
      var start = c;
      var segment = [];
      while (c < WS_COLUMN_COUNT && clearable(c)) {
        segment.push(reference && reference[c] === "-" ? "-" : "");
        c++;
      }
      sheet.getRange(rowNumber, start + 1, 1, segment.length).setValues([segment]);
    }
    SpreadsheetApp.flush();

    return wsJson_({
      ok: true,
      sheet: sheetName,
      row: rowNumber,
      no: text(current[WS_B_INDEX]),
      message: "판매내역이 삭제되었습니다.",
    });
  } finally {
    lock.releaseLock();
  }
}
