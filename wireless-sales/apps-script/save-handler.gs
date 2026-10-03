/**
 * 무선 판매 관리 웹앱 — 판매 저장 (A~AL 38칸, Apps Script 의 save-handler.gs 전체를 이 내용으로 교체)
 *
 * 요청 (둘 중 하나):
 *   { secret, action: "save", row: [38칸] }          ← 1건
 *   { secret, action: "save", rows: [[38칸], ...] }  ← 여러 건을 한 번에 (간편등록, 최대 30건)
 *   - row[i] 가 null 이면 그 칸은 건드리지 않는다 (간편등록에서 직원이 보내지 않은 칸 = 빈칸 유지).
 *   - B열(No.)은 어떤 값이 와도 절대 쓰지 않는다.
 *   - 수식이 들어 있는 칸은 건너뛴다.
 * 위치: 이번 달 시트("10월" 등)의 9행부터 개통일·고객·CTN 이 모두 비어 있고 No. 가 있는 행을 위에서부터 차례로.
 * LockService 로 한 번에 하나의 저장·삭제만 처리한다.
 * 여러 건 저장은 잠금·열 구조 확인·장표 읽기를 한 번만 해서 1건씩 여러 번 부르는 것보다 훨씬 빠르다.
 * 응답: 1건 → { ok, sheet, row, no } / 여러 건 → { ok: true, sheet, results: [{ ok, row, no } | { ok: false, message }] }
 */
var WS_SAVE_BATCH_MAX = 30;

function handleSaveRequest_(e) {
  var body = wsBody_(e);
  if (!body || body.action !== "save") return null;
  if (!wsAuthorized_(body)) {
    return wsJson_({ ok: false, message: "인증에 실패했습니다." });
  }

  var batch = Array.isArray(body.rows);
  var rows = batch ? body.rows : [body.row];
  if (batch && (rows.length === 0 || rows.length > WS_SAVE_BATCH_MAX)) {
    return wsJson_({
      ok: false,
      message: "한 번에 1~" + WS_SAVE_BATCH_MAX + "건까지 저장할 수 있습니다.",
    });
  }
  // 하나라도 형식이 틀리면 아무것도 쓰지 않는다
  for (var r = 0; r < rows.length; r++) {
    if (!Array.isArray(rows[r]) || rows[r].length !== WS_COLUMN_COUNT) {
      return wsJson_({
        ok: false,
        message: "저장할 행이 " + WS_COLUMN_COUNT + "칸(A~AL)이 아닙니다.",
      });
    }
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
    // 장표 값·수식은 처음 한 번만 읽는다
    var range = sheet.getRange(
      WS_FIRST_ROW,
      1,
      lastRow - WS_FIRST_ROW + 1,
      WS_COLUMN_COUNT,
    );
    var all = range.getValues();
    var allFormulas = range.getFormulas();

    var results = [];
    var next = 0;
    for (var k = 0; k < rows.length; k++) {
      // 9행부터: No. 가 있고 판매 데이터가 비어 있는 다음 행
      var index = -1;
      for (var i = next; i < all.length; i++) {
        if (wsText_(all[i][WS_B_INDEX], tz) !== "" && wsIsEmptySale_(all[i])) {
          index = i;
          break;
        }
      }
      if (index < 0) {
        results.push({
          ok: false,
          message: "장표에 빈 판매 행이 없습니다. 관리자에게 문의해 주세요.",
        });
        continue;
      }
      next = index + 1;
      wsWriteSaleRow_(sheet, WS_FIRST_ROW + index, rows[k], allFormulas[index]);
      results.push({
        ok: true,
        row: WS_FIRST_ROW + index,
        no: wsText_(all[index][WS_B_INDEX], tz),
      });
    }
    SpreadsheetApp.flush();

    if (!batch) {
      if (!results[0].ok) return wsJson_(results[0]);
      return wsJson_({
        ok: true,
        sheet: sheetName,
        row: results[0].row,
        no: results[0].no,
        message: "saved",
      });
    }
    return wsJson_({ ok: true, sheet: sheetName, results: results, message: "saved" });
  } finally {
    lock.releaseLock();
  }
}

/** 값이 있는 칸만, 이어진 칸끼리 묶어서 쓴다 (B열·수식 칸·null 은 건너뜀) */
function wsWriteSaleRow_(sheet, rowNumber, row, formulas) {
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
}
