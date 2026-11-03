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

/* ── 개인정보 마스킹 · 판매 ID (웹앱 lib/privacy-mask.ts 와 같은 규칙) ─────────────────────────
 * 고객명: 마지막 글자 * (김수현 → 김수*, 이훈 → 이*, 한 글자 → *), 영문 이름은 앞 2글자만 (John Smith → Jo********)
 * 전화:   010-1234-5678 → 010-12**-*678 · 10자리 011-123-4567 → 011-12*-*567 · 그 밖의 번호는 앞 3·끝 2자리만
 * 이미 * 가 들어 있는 값은 그대로 (몇 번을 거쳐도 같은 결과).
 * 판매 ID: 신규 판매마다 B열(No.) 셀 메모에 "웹앱 판매ID: S-…" 로 저장. 열·값·수식은 바꾸지 않는다.
 */
var WS_PRIVACY_VERSION = 1;
var WS_PRIVACY_HANDLER = "ws-privacy";
var WS_SALE_ID_LABEL = "웹앱 판매ID: ";
var WS_SALE_ID_RE = /웹앱 판매ID:\s*(S-[A-Za-z0-9]{12,40})/;

function wsMaskName_(value) {
  var s = String(value === null || value === undefined ? "" : value).replace(/^'/, "").trim();
  if (!s || s.indexOf("*") !== -1) return s;
  if (/[A-Za-z]/.test(s)) {
    var chars = Array.from ? Array.from(s) : s.split("");
    return chars.slice(0, 2).join("") + new Array(Math.max(chars.length - 2, 1) + 1).join("*");
  }
  var arr = Array.from ? Array.from(s) : s.split("");
  if (arr.length === 1) return "*";
  return arr.slice(0, arr.length - 1).join("") + "*";
}

/** 휴대폰·전화번호 마스킹. 숫자가 아닌 글자만 있으면 그대로 */
function wsMaskPhone_(value) {
  var s = String(value === null || value === undefined ? "" : value).replace(/^'/, "").trim();
  if (!s || s.indexOf("*") !== -1) return s;
  var d = s.replace(/\D/g, "");
  if (!d) return s;
  if (d.length === 11 && /^01/.test(d)) return d.slice(0, 3) + "-" + d.slice(3, 5) + "**-*" + d.slice(8);
  if (d.length === 10 && /^01/.test(d)) return d.slice(0, 3) + "-" + d.slice(3, 5) + "*-*" + d.slice(7);
  if (d.length <= 5) return new Array(d.length + 1).join("*");
  return d.slice(0, 3) + new Array(d.length - 4).join("*") + d.slice(-2);
}

/** 자유 입력 글 속 전화번호(01X 로 시작 10~11자리, 하이픈·공백·점 허용)를 마스킹 */
function wsMaskFreeText_(value) {
  var s = String(value === null || value === undefined ? "" : value);
  return s.replace(/(^|[^\d*])(01[016789])[\s.-]?(\d{3,4})[\s.-]?(\d{4})(?![\d*])/g, function (m, pre, a, b, c) {
    return pre + wsMaskPhone_(a + b + c);
  });
}

/** 이미 마스킹된 값처럼 보이는지 (신규 방식 판매: D 또는 E 에 * ) */
function wsLooksMasked_(rowValues) {
  return String(rowValues[3] || "").indexOf("*") !== -1 || String(rowValues[4] || "").indexOf("*") !== -1;
}

function wsSaleIdOfNote_(note) {
  var m = WS_SALE_ID_RE.exec(String(note || ""));
  return m ? m[1] : "";
}
function wsSaleIdNote_(id) {
  return WS_SALE_ID_LABEL + id + "\n(웹앱 연결용 — 지우거나 다른 행에 복사하지 마세요)";
}
function wsNewSaleId_() {
  return "S-" + String(Utilities.getUuid()).replace(/[^A-Za-z0-9]/g, "").slice(0, 20);
}

/** rows(9행부터 n행 값 배열)에 B열 메모의 판매 ID 를 rows[i].saleId 로 붙인다 (배열 칸은 그대로) */
function wsAttachSaleIds_(sheet, rows) {
  if (!rows || rows.length === 0) return rows;
  var notes = sheet.getRange(WS_FIRST_ROW, 2, rows.length, 1).getNotes();
  for (var i = 0; i < rows.length; i++) rows[i].saleId = wsSaleIdOfNote_(notes[i] && notes[i][0]);
  return rows;
}
/** 한 행 값에 판매 ID 붙이기 */
function wsWithSaleId_(sheet, rowNumber, values) {
  values.saleId = wsSaleIdOfNote_(sheet.getRange(rowNumber, 2).getNotes()[0][0]);
  return values;
}
/** 월 시트에서 같은 판매 ID 를 가진 행 수 */
function wsCountSaleId_(sheet, id) {
  if (!id) return 0;
  var last = sheet.getLastRow();
  if (last < WS_FIRST_ROW) return 0;
  var notes = sheet.getRange(WS_FIRST_ROW, 2, last - WS_FIRST_ROW + 1, 1).getNotes();
  var n = 0;
  for (var i = 0; i < notes.length; i++) if (wsSaleIdOfNote_(notes[i][0]) === id) n++;
  return n;
}

/**
 * 판매 확인 (수정·삭제·검수/수납/카드 완료·보완 요청 공통). 문제 항목 목록을 돌려준다 (빈 배열 = 같은 판매).
 *  - 판매 ID 가 있는 행: 화면에서 받은 saleId 와 같고, 시트에 그 ID 가 정확히 1행, No.·개통일·마스킹 고객명·마스킹 CTN 같음
 *  - 마스킹된 신규 판매인데 ID 가 없음(분실): 거부
 *  - 기존 판매(원본 그대로, ID 없음): 행·No.·개통일 정확히 + 고객명·CTN 은 마스킹 값끼리 비교,
 *    시트 안에 같은 개통일·마스킹 고객명·마스킹 CTN 을 가진 ID 없는 판매가 2건 이상이면 거부
 */
function wsSaleTargetMismatches_(sheet, rowNumber, current, target, tz) {
  var text = function (v) {
    return wsText_(v, tz);
  };
  if (current.saleId === undefined) wsWithSaleId_(sheet, rowNumber, current);
  var out = [];
  var wanted = String(target.saleId || "");
  if (current.saleId) {
    if (wanted !== current.saleId) out.push("판매 ID");
    else if (wsCountSaleId_(sheet, current.saleId) !== 1) out.push("판매 ID 중복");
    if (text(current[2]) !== text(target.activatedAt)) out.push("개통일");
    if (text(current[WS_B_INDEX]) !== text(target.no)) out.push("No.");
    if (wsMaskName_(current[3]) !== wsMaskName_(target.customer)) out.push("고객");
    if (wsMaskPhone_(text(current[4])) !== wsMaskPhone_(text(target.ctn))) out.push("CTN");
    return out;
  }
  if (wanted) return ["판매 ID 없음"];
  if (wsLooksMasked_(current)) return ["판매 ID 없음"];
  if (text(current[WS_B_INDEX]) !== text(target.no)) out.push("No.");
  if (text(current[2]) !== text(target.activatedAt)) out.push("개통일");
  if (wsMaskName_(current[3]) !== wsMaskName_(target.customer)) out.push("고객");
  if (wsMaskPhone_(text(current[4])) !== wsMaskPhone_(text(target.ctn))) out.push("CTN");
  if (out.length === 0 && wsLegacyCandidates_(sheet, current, tz) !== 1) out.push("같은 고객으로 보이는 판매 2건 이상");
  return out;
}

/** 기존 판매(ID 없음) 중 개통일·마스킹 고객명·마스킹 CTN 이 같은 행 수 */
function wsLegacyCandidates_(sheet, current, tz) {
  var last = sheet.getLastRow();
  if (last < WS_FIRST_ROW) return 0;
  var rows = wsAttachSaleIds_(sheet, sheet.getRange(WS_FIRST_ROW, 1, last - WS_FIRST_ROW + 1, WS_COLUMN_COUNT).getValues());
  var key = wsText_(current[2], tz) + "|" + wsMaskName_(current[3]) + "|" + wsMaskPhone_(wsText_(current[4], tz));
  var n = 0;
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].saleId || wsIsEmptySale_(rows[i])) continue;
    if (wsText_(rows[i][2], tz) + "|" + wsMaskName_(rows[i][3]) + "|" + wsMaskPhone_(wsText_(rows[i][4], tz)) === key) n++;
  }
  return n;
}

/** 웹앱이 신규 등록 전에 확인: 이 Apps Script 가 마스킹·판매 ID 를 지원하는지 */
function wsHandlePrivacyStatus_(body) {
  if (!wsAuthorized_(body)) return wsJson_({ ok: false, handler: WS_PRIVACY_HANDLER, message: "인증에 실패했습니다." });
  // 파일마다 표시가 있어야 OK (일부 파일만 새 버전으로 바꾼 상태에서 신규 등록이 되지 않게)
  var missing = [];
  var marks = {
    "save-handler.gs": typeof WS_SAVE_PRIVACY !== "undefined",
    "update-handler.gs": typeof WS_UPDATE_PRIVACY !== "undefined",
    "delete-handler.gs": typeof WS_DELETE_PRIVACY !== "undefined",
    "list-handler.gs": typeof WS_LIST_PRIVACY !== "undefined",
    "notes.gs": typeof WS_NOTES_PRIVACY !== "undefined",
    "inspection-review.gs": typeof WS_REVIEW_PRIVACY !== "undefined",
    "gobulbi.gs": typeof WS_GOBULBI_PRIVACY !== "undefined",
  };
  for (var f in marks) if (!marks[f]) missing.push(f);
  if (missing.length > 0) {
    return wsJson_({
      ok: false,
      handler: WS_PRIVACY_HANDLER,
      message: "개인정보 마스킹 최신 코드가 아닌 파일이 있습니다: " + missing.join(", "),
    });
  }
  return wsJson_({ ok: true, handler: WS_PRIVACY_HANDLER, version: WS_PRIVACY_VERSION });
}

/** 저장할 한 칸 마스킹: D 고객명, E CTN, 그 밖의 글 칸은 글 속 전화번호 (B·C 는 그대로) */
function wsMaskCellForSave_(col, value) {
  if (value === null || value === undefined) return value;
  // 웹앱이 붙인 ' (=·+·-·@ 로 시작하는 글이 수식이 되지 않게) 는 마스킹 뒤에도 유지한다
  var quoted = typeof value === "string" && value.charAt(0) === "'";
  if (col === 3 || col === 4) {
    var m = col === 3 ? wsMaskName_(value) : wsMaskPhone_(value);
    return quoted || /^[=+\-@]/.test(m) ? "'" + m : m;
  }
  if (col === WS_B_INDEX || col === 2) return value;
  return typeof value === "string" ? wsMaskFreeText_(value) : value;
}
/** 화면·응답에 보낼 한 행 (원본은 바꾸지 않고 새 배열, saleId 유지) */
function wsMaskRowForView_(values) {
  var out = [];
  for (var i = 0; i < values.length; i++) {
    var v = values[i];
    if (i === 3) out.push(v === "" || v === null || v === undefined ? v : wsMaskName_(v));
    else if (i === 4) out.push(v === "" || v === null || v === undefined ? v : wsMaskPhone_(v));
    else out.push(typeof v === "string" ? wsMaskFreeText_(v) : v);
  }
  if (values.saleId !== undefined) out.saleId = values.saleId;
  return out;
}
/** 수정 전 값 비교: 화면은 마스킹 값만 보므로 같은 규칙으로 마스킹한 뒤 비교 */
function wsMaskedComparable_(col, v, tz) {
  if (col === 3) return wsMaskName_(wsText_(v, tz));
  if (col === 4) return wsMaskPhone_(wsText_(v, tz));
  var t = wsComparable_(v, tz);
  return col === WS_B_INDEX || col === 2 ? t : wsMaskFreeText_(t);
}

/** 보완 요청 화면 모양 { active, history } 의 글 속 전화번호 마스킹 (제자리) */
function wsMaskReviewView_(view) {
  if (!view) return view;
  if (view.active && typeof view.active.content === "string") view.active.content = wsMaskFreeText_(view.active.content);
  for (var i = 0; view.history && i < view.history.length; i++) {
    if (typeof view.history[i].content === "string") view.history[i].content = wsMaskFreeText_(view.history[i].content);
  }
  return view;
}
