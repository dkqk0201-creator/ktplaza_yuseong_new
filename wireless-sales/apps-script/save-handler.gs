/**
 * 무선 판매 관리 웹앱 — 판매 저장 (A~AL 38칸, Apps Script 에 새 파일 save-handler.gs 로 추가)
 *
 * 요청: { secret, action: "save", row: [38칸] }
 *   - row[i] 가 null 이면 그 칸은 건드리지 않는다 (간편등록에서 직원이 보내지 않은 칸 = 빈칸 유지).
 *   - B열(No.)은 어떤 값이 와도 절대 쓰지 않는다.
 *   - 수식이 들어 있는 칸은 건너뛴다.
 * 위치: 이번 달 시트("10월" 등)의 9행부터 개통일·고객·CTN 이 모두 비어 있고 No. 가 있는 첫 행.
 * LockService 로 한 번에 하나의 저장·삭제만 처리한다.
 */
function handleSaveRequest_(e) {
  var body = wsBody_(e);
  if (!body || body.action !== "save") return null;
  if (!wsAuthorized_(body)) {
    return wsJson_({ ok: false, message: "인증에 실패했습니다." });
  }

  var row = body.row;
  if (!Array.isArray(row) || row.length !== WS_COLUMN_COUNT) {
    return wsJson_({
      ok: false,
      message: "저장할 행이 " + WS_COLUMN_COUNT + "칸(A~AL)이 아닙니다.",
    });
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
    var sheetName = wsCurrentMonthSheetName_(ss);
    var sheet = ss.getSheetByName(sheetName);
    if (!sheet) {
      return wsJson_({ ok: false, message: sheetName + " 시트를 찾을 수 없습니다." });
    }
    var layoutError = wsLayoutError_(sheet);
    if (layoutError) return layoutError;

    var lastRow = sheet.getLastRow();
    if (lastRow < WS_FIRST_ROW) {
      return wsJson_({ ok: false, message: "장표에 빈 판매 행이 없습니다." });
    }
    var all = sheet
      .getRange(WS_FIRST_ROW, 1, lastRow - WS_FIRST_ROW + 1, WS_COLUMN_COUNT)
      .getValues();

    // 9행부터: No. 가 있고 판매 데이터가 비어 있는 첫 행
    var index = -1;
    for (var i = 0; i < all.length; i++) {
      if (wsText_(all[i][WS_B_INDEX], tz) !== "" && wsIsEmptySale_(all[i])) {
        index = i;
        break;
      }
    }
    if (index < 0) {
      return wsJson_({
        ok: false,
        message: "장표에 빈 판매 행이 없습니다. 관리자에게 문의해 주세요.",
      });
    }
    var rowNumber = WS_FIRST_ROW + index;
    var formulas = sheet.getRange(rowNumber, 1, 1, WS_COLUMN_COUNT).getFormulas()[0];

    // 값이 있는 칸만, 이어진 칸끼리 묶어서 쓴다 (B열·수식 칸·null 은 건너뜀)
    var c = 0;
    while (c < WS_COLUMN_COUNT) {
      if (c === WS_B_INDEX || formulas[c] !== "" || row[c] === null) {
        c++;
        continue;
      }
      var start = c;
      var segment = [];
      while (
        c < WS_COLUMN_COUNT &&
        c !== WS_B_INDEX &&
        formulas[c] === "" &&
        row[c] !== null
      ) {
        segment.push(row[c]);
        c++;
      }
      sheet.getRange(rowNumber, start + 1, 1, segment.length).setValues([segment]);
    }
    SpreadsheetApp.flush();

    return wsJson_({
      ok: true,
      sheet: sheetName,
      row: rowNumber,
      no: wsText_(all[index][WS_B_INDEX], tz),
      message: "saved",
    });
  } finally {
    lock.releaseLock();
  }
}
