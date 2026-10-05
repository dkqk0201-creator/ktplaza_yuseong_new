/**
 * 무선 판매 관리 웹앱 — 판매내역 조회 (A~AL 38칸, 기존 list-handler.gs 전체를 이 내용으로 교체)
 *
 * 요청: { secret, action: "list", sheet?: "10월" }
 *   - sheet 를 주면 그 월 시트, 없으면 이번 달 시트를 읽는다.
 *   - 9행부터 개통일·고객·CTN 중 하나라도 값이 있는 행만 돌려준다 (빈 행·양식 행 제외).
 *   - 읽기만 하며 장표의 어떤 칸도 수정하지 않는다.
 * 응답: { ok, sheet, rows: [{ row, no, values[38], notes? }], sheets: ["9월", "10월", ...] }
 *   notes: notes.gs 보조 시트의 판매보고 참고내용 (키가 정확히 한 판매에 맞을 때만)
 */
function handleListRequest_(e) {
  var body = wsBody_(e);
  if (!body || body.action !== "list") return null;
  if (!wsAuthorized_(body)) {
    return wsJson_({ ok: false, message: "인증에 실패했습니다." });
  }

  var ss = wsSpreadsheet_();
  var tz = ss.getSpreadsheetTimeZone();
  var sheets = wsMonthSheetNames_(ss);
  var sheetName = body.sheet ? String(body.sheet) : wsCurrentMonthSheetName_(ss);
  if (!wsIsMonthSheetName_(sheetName)) {
    return wsJson_({ ok: false, message: "시트 이름이 올바르지 않습니다.", sheets: sheets });
  }
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    return wsJson_({
      ok: false,
      message: sheetName + " 시트를 찾을 수 없습니다.",
      sheets: sheets,
    });
  }
  var problem = wsLayoutProblem_(sheet);
  if (problem) {
    return wsJson_({
      ok: false,
      message: sheetName + " 시트의 열 구조가 웹앱과 다릅니다 (" + problem + ")",
      sheets: sheets,
    });
  }

  var lastRow = sheet.getLastRow();
  var rows = [];
  if (lastRow >= WS_FIRST_ROW) {
    var values = sheet
      .getRange(WS_FIRST_ROW, 1, lastRow - WS_FIRST_ROW + 1, WS_COLUMN_COUNT)
      .getValues();
    for (var i = 0; i < values.length; i++) {
      var r = values[i];
      if (wsIsEmptySale_(r)) continue; // 판매 데이터가 없는 행
      rows.push({
        row: WS_FIRST_ROW + i,
        no: wsText_(r[WS_B_INDEX], tz),
        values: r.map(function (v) {
          return v instanceof Date ? Utilities.formatDate(v, tz, "yyyy-MM-dd") : v;
        }),
      });
    }
  }
  try {
    wsAttachNotes_(ss, sheetName, rows, tz);
  } catch (err) {
    // 참고내용을 못 읽어도 판매내역 조회는 그대로
  }
  return wsJson_({ ok: true, sheet: sheetName, rows: rows, sheets: sheets });
}
