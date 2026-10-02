/**
 * 무선 판매 관리 웹앱 — 공통 설정·도우미 (Apps Script 에 새 파일 common.gs 로 추가)
 *
 * 다른 웹앱용 파일(list-handler.gs, delete-handler.gs, save-handler.gs, goal-handler.gs)이
 * 모두 이 파일을 함께 사용한다. 웹앱의 lib/sheet-columns.ts 와 열 구조가 같아야 한다.
 *
 * 장표 열 구조 (A~AL, 38칸) — E열 오른쪽에 "실력지표제외" F열이 삽입된 구조
 */
var WS_FIRST_ROW = 9; // 판매 데이터 시작 행
var WS_COLUMN_COUNT = 38; // A~AL
var WS_B_INDEX = 1; // B열(No.) — 웹앱은 절대 쓰지 않는다
var WS_TEMPLATE_SHEET = "무선장표 양식";

/** 열 구조 확인: 이 제목들이 맞지 않으면 저장·삭제·조회를 하지 않는다 */
var WS_LAYOUT_CHECKS = [
  { row: 6, col: 6, text: "실력지표제외" }, // F
  { row: 7, col: 7, text: "검수" }, // G
  { row: 7, col: 8, text: "수납" }, // H
  { row: 6, col: 13, text: "직원명" }, // M
  { row: 6, col: 20, text: "고객혜택" }, // T
  { row: 7, col: 31, text: "제카" }, // AE
  { row: 7, col: 38, text: "가능일" }, // AL
];

function wsJson_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON,
  );
}

/** 요청 본문 읽기. JSON 이 아니면 null */
function wsBody_(e) {
  try {
    return JSON.parse((e && e.postData && e.postData.contents) || "{}");
  } catch (err) {
    return null;
  }
}

/** 스크립트 속성 API_SECRET 과 같은지 */
function wsAuthorized_(body) {
  var secret = PropertiesService.getScriptProperties().getProperty("API_SECRET");
  return !!secret && body && body.secret === secret;
}

function wsSpreadsheet_() {
  return (
    SpreadsheetApp.getActiveSpreadsheet() ||
    SpreadsheetApp.openById(
      PropertiesService.getScriptProperties().getProperty("SPREADSHEET_ID"),
    )
  );
}

/** 이번 달 시트 이름 (예: "10월") */
function wsCurrentMonthSheetName_(ss) {
  var tz = ss.getSpreadsheetTimeZone();
  return Number(Utilities.formatDate(new Date(), tz, "M")) + "월";
}

/** "1월"~"12월" 형식인지 */
function wsIsMonthSheetName_(name) {
  return /^(1[0-2]|[1-9])월$/.test(String(name || ""));
}

/** 스프레드시트에 있는 월 시트 이름 목록 (예: ["9월", "10월"]) */
function wsMonthSheetNames_(ss) {
  return ss
    .getSheets()
    .map(function (s) {
      return s.getName();
    })
    .filter(wsIsMonthSheetName_);
}

/** 6·7행 제목으로 열 구조를 확인한다. 맞으면 "", 다르면 문제 설명 */
function wsLayoutProblem_(sheet) {
  if (sheet.getMaxColumns() < WS_COLUMN_COUNT) {
    return "열 개수가 " + WS_COLUMN_COUNT + "개(A~AL)보다 적습니다.";
  }
  var headers = sheet.getRange(6, 1, 2, WS_COLUMN_COUNT).getValues();
  for (var i = 0; i < WS_LAYOUT_CHECKS.length; i++) {
    var check = WS_LAYOUT_CHECKS[i];
    var cell = String(headers[check.row - 6][check.col - 1]).replace(/\s/g, "");
    if (cell.indexOf(check.text) === -1) {
      return (
        check.row +
        "행 " +
        wsColumnLetter_(check.col) +
        "열 제목이 '" +
        check.text +
        "'가 아닙니다."
      );
    }
  }
  return "";
}

function wsLayoutError_(sheet) {
  var problem = wsLayoutProblem_(sheet);
  if (!problem) return null;
  return wsJson_({
    ok: false,
    message:
      sheet.getName() +
      " 시트의 열 구조가 웹앱과 다릅니다 (" +
      problem +
      ") 잘못된 칸에 저장되지 않도록 작업을 멈췄습니다.",
  });
}

function wsColumnLetter_(col) {
  var s = "";
  while (col > 0) {
    var m = (col - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    col = Math.floor((col - 1) / 26);
  }
  return s;
}

/** 판매 데이터가 없는 행인지 (개통일·고객·CTN 이 모두 비어 있음) */
function wsIsEmptySale_(r) {
  return r[2] === "" && r[3] === "" && r[4] === "";
}

function wsText_(v, tz) {
  if (v instanceof Date) return Utilities.formatDate(v, tz, "yyyy-MM-dd");
  return String(v === null || v === undefined ? "" : v).trim();
}
