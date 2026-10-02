/**
 * 무선 판매 관리 웹앱 — 판매내역 조회 기능 (Apps Script에 추가하는 코드)
 *
 * 붙여넣는 방법
 *   1. 무선장표 스프레드시트 → 확장 프로그램 → Apps Script 를 연다.
 *   2. 이 파일의 handleListRequest_ 함수를 통째로 복사해 기존 코드 맨 아래에 붙여넣는다.
 *   3. 기존 doPost(e) 함수의 "맨 첫 줄"에 아래 두 줄을 넣는다. (기존 코드는 지우지 않는다)
 *
 *        var listResponse = handleListRequest_(e);
 *        if (listResponse) return listResponse;
 *
 *   4. 배포 → 배포 관리 → 기존 웹 앱 배포의 연필(수정) → 버전: "새 버전" → 배포.
 *      (웹 앱 주소는 그대로 유지된다)
 *
 * 동작
 *   - 요청 본문의 action 이 "list" 일 때만 동작한다. 저장 요청은 null 을 돌려주므로
 *     기존 저장 코드가 그대로 처리한다.
 *   - 스크립트 속성 API_SECRET 과 같은 secret 일 때만 응답한다.
 *   - 이번 달 시트("10월" 등)의 9행부터 C(개통일)·D(고객)·E(CTN) 중 하나라도 값이 있는 행만 돌려준다.
 *   - 읽기만 하며 장표의 어떤 칸도 수정하지 않는다.
 */
function handleListRequest_(e) {
  var body;
  try {
    body = JSON.parse((e && e.postData && e.postData.contents) || "{}");
  } catch (err) {
    return null;
  }
  if (!body || body.action !== "list") return null;

  function json(obj) {
    return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
      ContentService.MimeType.JSON,
    );
  }

  var props = PropertiesService.getScriptProperties();
  var secret = props.getProperty("API_SECRET");
  if (!secret || body.secret !== secret) {
    return json({ ok: false, message: "인증에 실패했습니다." });
  }

  var ss =
    SpreadsheetApp.getActiveSpreadsheet() ||
    SpreadsheetApp.openById(props.getProperty("SPREADSHEET_ID"));
  var tz = ss.getSpreadsheetTimeZone();
  var sheetName = Number(Utilities.formatDate(new Date(), tz, "M")) + "월";
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    return json({ ok: false, message: sheetName + " 시트를 찾을 수 없습니다." });
  }

  var FIRST_ROW = 9;
  var COLUMN_COUNT = 37; // A~AK
  var lastRow = sheet.getLastRow();
  if (lastRow < FIRST_ROW) {
    return json({ ok: true, sheet: sheetName, rows: [] });
  }

  var values = sheet
    .getRange(FIRST_ROW, 1, lastRow - FIRST_ROW + 1, COLUMN_COUNT)
    .getValues();
  var rows = [];
  for (var i = 0; i < values.length; i++) {
    var r = values[i];
    if (r[2] === "" && r[3] === "" && r[4] === "") continue; // 판매 데이터가 없는 행
    rows.push({
      row: FIRST_ROW + i,
      no: String(r[1]),
      values: r.map(function (v) {
        return v instanceof Date ? Utilities.formatDate(v, tz, "yyyy-MM-dd") : v;
      }),
    });
  }
  return json({ ok: true, sheet: sheetName, rows: rows });
}
