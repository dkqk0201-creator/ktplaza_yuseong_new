/**
 * 무선 판매 관리 웹앱 — 판매내역 조회 (A~AL 38칸, 기존 list-handler.gs 전체를 이 내용으로 교체)
 *
 * 요청: { secret, action: "list", sheet?: "10월" }
 *   - sheet 를 주면 그 월 시트, 없으면 이번 달 시트를 읽는다.
 *   - 9행부터 개통일·고객·CTN 중 하나라도 값이 있는 행만 돌려준다 (빈 행·양식 행 제외).
 *   - 읽기만 하며 장표의 어떤 칸도 수정하지 않는다.
 * 응답: { ok, sheet, rows: [{ row, no, values[38], notes?, review?, spotNote? }], sheets: ["9월", "10월", ...] }
 *   notes: notes.gs 보조 시트의 판매보고 참고내용 (키가 정확히 한 판매에 맞을 때만)
 *   review: inspection-review.gs 보조 시트의 검수 보완 요청 { active, history } (키가 정확히 한 판매에 맞을 때만)
 *   spotNote: O열(SPOT정책) 셀 메모 원문 (스팟관리용). O열 범위의 메모를 getNotes() 로 한 번에 읽는다.
 *     메모를 못 읽어도 판매내역 조회는 그대로 (spotNote 없이 응답).
 *   saleId: B열 메모의 웹앱 판매 ID (있을 때). saleIdProblem: "duplicate"(같은 ID 가 2행 이상) |
 *     "missing"(마스킹된 판매인데 ID 가 없음) — 이런 판매는 수정·삭제·참고내용 연결을 하지 않는다.
 * 개인정보: 응답에는 원본 고객명·CTN 이 나가지 않는다. 기존 판매(원본 그대로)도 여기서 마스킹해서 보낸다
 *   (D 고객명·E CTN·글 칸 속 전화번호·O열 메모·참고내용·보완 요청 글 속 전화번호). 장표 값은 바꾸지 않는다.
 */
var WS_LIST_PRIVACY = 1; // 개인정보 마스킹·판매 ID 지원 표시 (common.gs 의 privacy-status 가 확인)
var WS_SPOT_COLUMN = 15; // O열 (SPOT정책)

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
    var values = wsAttachSaleIds_(
      sheet,
      sheet.getRange(WS_FIRST_ROW, 1, lastRow - WS_FIRST_ROW + 1, WS_COLUMN_COUNT).getValues(),
    );
    var idCount = {};
    for (var ic = 0; ic < values.length; ic++) {
      if (values[ic].saleId) idCount[values[ic].saleId] = (idCount[values[ic].saleId] || 0) + 1;
    }
    // O열 메모 전체를 한 번에 (행마다 getNote() 를 부르지 않는다)
    var spotNotes = null;
    try {
      spotNotes = sheet
        .getRange(WS_FIRST_ROW, WS_SPOT_COLUMN, values.length, 1)
        .getNotes();
    } catch (err) {
      spotNotes = null;
    }
    for (var i = 0; i < values.length; i++) {
      var r = values[i];
      if (wsIsEmptySale_(r)) continue; // 판매 데이터가 없는 행
      // 참고내용·보완 기록 연결 키는 원본 값(+판매 ID)으로 계산해야 하므로 마스킹은 붙인 뒤에 한다
      var keyValues = r.slice();
      keyValues.saleId = r.saleId;
      var item = {
        row: WS_FIRST_ROW + i,
        no: wsText_(r[WS_B_INDEX], tz),
        values: keyValues,
      };
      if (r.saleId) {
        item.saleId = r.saleId;
        if (idCount[r.saleId] !== 1) item.saleIdProblem = "duplicate";
      } else if (wsLooksMasked_(r)) {
        item.saleIdProblem = "missing";
      }
      var spotNote = spotNotes && spotNotes[i] ? String(spotNotes[i][0] || "").trim() : "";
      if (spotNote) item.spotNote = wsMaskFreeText_(spotNote);
      rows.push(item);
    }
  }
  try {
    wsAttachNotes_(ss, sheetName, rows, tz);
  } catch (err) {
    // 참고내용을 못 읽어도 판매내역 조회는 그대로
  }
  try {
    if (typeof wsAttachReviews_ === "function") wsAttachReviews_(ss, sheetName, rows, tz);
  } catch (err) {
    // 검수 보완 기록을 못 읽어도 판매내역 조회는 그대로
  }
  // 개인정보 마스킹 (응답에만, 장표는 그대로)
  for (var m = 0; m < rows.length; m++) {
    rows[m].values = wsMaskRowForView_(rows[m].values).map(function (v) {
      return v instanceof Date ? Utilities.formatDate(v, tz, "yyyy-MM-dd") : v;
    });
    if (rows[m].notes) {
      var masked = {};
      for (var nk in rows[m].notes) {
        if (Object.prototype.hasOwnProperty.call(rows[m].notes, nk)) masked[nk] = wsMaskFreeText_(rows[m].notes[nk]);
      }
      rows[m].notes = masked;
    }
    if (rows[m].review) wsMaskReviewView_(rows[m].review);
  }
  return wsJson_({ ok: true, sheet: sheetName, rows: rows, sheets: sheets, privacy: WS_PRIVACY_VERSION });
}
