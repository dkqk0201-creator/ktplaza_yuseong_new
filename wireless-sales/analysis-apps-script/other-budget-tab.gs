/**
 * 유성점_AI운영_분석데이터 — "기타예산" 탭 (분석데이터 Apps Script 프로젝트에 새 파일 other-budget-tab.gs 로 추가)
 *
 * 목적: 웹앱 예산관리에 추가된 "기타 예산"(고객혜택과 별도인 확보·차감)을 AI 아침 브리핑이 잘못 해석하지 않도록
 *       기존 "직원별예산" 탭은 그대로 두고, 매장 단위 예산 계산 근거를 별도 탭으로 나눠 보여준다.
 *
 * 기존 직원별예산 탭과의 관계 (그 탭은 바꾸지 않는다):
 *   직원별예산 "매장 전체" 행의 총매장예산 = 장표기준총매장예산 (= 고객혜택잔여 + 스팟 + 현금, 고불비·기타 예산 미반영)
 *   이 탭:
 *     장표기준총매장예산 → 고불비사용 차감 → 기존매장총예산(웹앱) → + 기타예산순증감 → 최종매장총예산(웹앱 큰 카드)
 *
 * 읽는 원본 (무선장표, 읽기 전용 — 아무것도 쓰지 않음):
 *   월 시트("11월" 등) 9행부터: O(스팟)·P~T(확보)·V~Y(사용)·AB(현금)
 *   "고불비사용내역"  (gobulbi.gs)      : 지급일 기준, 상태 "사용"만
 *   "기타예산내역"    (other-budget.gs) : 적용 월 기준, 상태 "사용"만
 * 쓰는 곳: 분석 스프레드시트의 "기타예산" 탭만 (전체 다시 씀).
 * 개인정보: 고객 이름·전화번호·판매 ID 는 읽지도 쓰지도 않는다. 기타 예산 메모는 넣지 않고,
 *           항목명은 넣되 전화번호처럼 보이는 숫자는 가린다.
 *
 * 연결 (기존 갱신 함수 맨 끝에 한 줄. 기존 트리거·자동화는 그대로):
 *   wsAiWriteOtherBudgetTab_(분석 스프레드시트, 무선장표 스프레드시트, ["2026-09","2026-10","2026-11"]);
 * 실패해도 다른 탭 갱신에는 영향이 없도록 try/catch 안에서 부른다. 결과 { ok, rows, message } 를 데이터갱신현황에 적을 수 있다.
 */
var WS_AI_OTHER_TAB = "기타예산";
var WS_AI_OTHER_HEADER = [
  "연월",
  "장표기준총매장예산",
  "고불비사용",
  "기존매장총예산",
  "기타예산확보",
  "기타예산차감",
  "기타예산순증감",
  "최종매장총예산",
  "기타예산항목수",
  "기타예산항목",
  "상태",
  "갱신시각",
];
var WS_AI_OTHER_NOTE =
  "읽는법: 장표기준총매장예산 = 직원별예산 탭 매장 전체 행의 총매장예산과 같음(고불비·기타 예산 미반영). " +
  "기존매장총예산 = 장표기준 − 고불비사용 (웹앱 '기존 매장 총예산'). 최종매장총예산 = 기존매장총예산 + 기타예산순증감 (웹앱 예산관리 큰 카드). " +
  "기타 예산은 고객혜택·스팟·현금예산·직원별 예산에 포함되지 않는 매장 단위 별도 확보/차감이므로 직원별로 나누지 말 것. " +
  "상태가 '확인 필요'인 달은 원본 시트 형식 문제로 일부 값이 빠졌을 수 있음.";

function wsAiNum_(v) {
  if (typeof v === "number") return isFinite(v) ? v : 0;
  var t = String(v === null || v === undefined ? "" : v).replace(/[\s,]/g, "").replace(/원$/, "");
  return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : 0;
}

function wsAiText_(v, tz) {
  if (v instanceof Date) return Utilities.formatDate(v, tz, "yyyy-MM-dd");
  return String(v === null || v === undefined ? "" : v).trim().replace(/^'/, "");
}

/** 월 시트 → 장표기준총매장예산 (웹앱 lib/budget.ts calculateBudget().total 과 같은 계산). 시트가 없으면 null */
function wsAiSheetTotal_(wss, ym, tz) {
  var sheet = wss.getSheetByName(Number(ym.slice(5, 7)) + "월");
  if (!sheet) return null;
  var last = sheet.getLastRow();
  if (last < 9) return 0;
  var rows = sheet.getRange(9, 1, last - 8, 38).getValues();
  var total = 0;
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    if (wsAiText_(r[2], tz) === "" && wsAiText_(r[3], tz) === "" && wsAiText_(r[4], tz) === "") continue; // 빈 행
    var secured = wsAiNum_(r[15]) + wsAiNum_(r[16]) + wsAiNum_(r[17]) + wsAiNum_(r[18]) + wsAiNum_(r[19]); // P~T
    var used = wsAiNum_(r[21]) + wsAiNum_(r[22]) + wsAiNum_(r[23]) + wsAiNum_(r[24]); // V~Y
    total += secured - used + wsAiNum_(r[14]) + wsAiNum_(r[27]); // + O + AB
  }
  return total;
}

/** 시트의 1행 제목이 기대와 같은지 */
function wsAiHeaderOk_(sheet, header) {
  if (!sheet || sheet.getLastRow() < 1) return false;
  var row = sheet.getRange(1, 1, 1, header.length).getValues()[0];
  for (var i = 0; i < header.length; i++) if (String(row[i]).trim() !== header[i]) return false;
  return true;
}

var WS_AI_GOBULBI_HEADER = ["고유 ID", "지급일", "내용", "금액", "판매자", "등록일", "수정일", "상태", "삭제일시"];
var WS_AI_OTHER_SRC_HEADER = ["고유 ID", "적용 월", "항목명", "구분", "금액", "메모", "등록일시", "수정일시", "상태", "삭제일시"];

/** 전화번호처럼 보이는 숫자(9자리 이상) 가리기 */
function wsAiMaskDigits_(t) {
  return String(t).replace(/\d[\d\s-]{7,}\d/g, "***");
}

function wsAiOtherBudgetRows_(wss, months, tz, stamp) {
  var problems = {};
  // 고불비사용 (지급일 기준, 사용만)
  var gob = {};
  var gs = wss.getSheetByName("고불비사용내역");
  if (gs && gs.getLastRow() > 0) {
    if (!wsAiHeaderOk_(gs, WS_AI_GOBULBI_HEADER)) problems.gobulbi = true;
    else if (gs.getLastRow() >= 2) {
      var gr = gs.getRange(2, 1, gs.getLastRow() - 1, 9).getValues();
      for (var i = 0; i < gr.length; i++) {
        var status = String(gr[i][7]).trim() || "사용";
        if (status !== "사용") continue;
        var ym = wsAiText_(gr[i][1], tz).slice(0, 7);
        gob[ym] = (gob[ym] || 0) + wsAiNum_(gr[i][3]);
      }
    }
  }
  // 기타 예산 (적용 월 기준, 사용만)
  var oth = {};
  var os = wss.getSheetByName("기타예산내역");
  if (os && os.getLastRow() > 0) {
    if (!wsAiHeaderOk_(os, WS_AI_OTHER_SRC_HEADER)) problems.other = true;
    else if (os.getLastRow() >= 2) {
      var orows = os.getRange(2, 1, os.getLastRow() - 1, 10).getValues();
      for (var j = 0; j < orows.length; j++) {
        var st = String(orows[j][8]).trim() || "사용";
        if (st !== "사용") continue;
        var m = orows[j][1] instanceof Date ? Utilities.formatDate(orows[j][1], tz, "yyyy-MM") : wsAiText_(orows[j][1], tz);
        var kind = String(orows[j][3]).trim();
        var amount = wsAiNum_(orows[j][4]);
        if (!/^\d{4}-\d{2}$/.test(m) || (kind !== "확보" && kind !== "차감") || amount <= 0) continue;
        var o = oth[m] || (oth[m] = { gain: 0, deduct: 0, names: [] });
        if (kind === "확보") o.gain += amount;
        else o.deduct += amount;
        o.names.push(wsAiMaskDigits_(wsAiText_(orows[j][2], tz)).slice(0, 40) + "(" + (kind === "확보" ? "+" : "-") + amount + ")");
      }
    }
  }
  var out = [];
  for (var k = 0; k < months.length; k++) {
    var ymk = months[k];
    var base = wsAiSheetTotal_(wss, ymk, tz);
    var g = gob[ymk] || 0;
    var ob = oth[ymk] || { gain: 0, deduct: 0, names: [] };
    var existing = base === null ? "" : base - g;
    var net = ob.gain - ob.deduct;
    var state = base === null ? "월 시트 없음" : problems.gobulbi || problems.other ? "확인 필요" : "정상";
    out.push([
      ymk,
      base === null ? "" : base,
      g,
      existing,
      ob.gain,
      ob.deduct,
      net,
      base === null ? "" : existing + net,
      ob.names.length,
      ob.names.join("; "),
      state,
      stamp,
    ]);
  }
  return out;
}

/** 분석 스프레드시트의 "기타예산" 탭을 다시 쓴다 (다른 탭은 건드리지 않음) */
function wsAiWriteOtherBudgetTab_(ass, wss, months) {
  var tz = wss.getSpreadsheetTimeZone();
  var stamp = Utilities.formatDate(new Date(), tz, "yyyy-MM-dd HH:mm:ss");
  var rows = wsAiOtherBudgetRows_(wss, months, tz, stamp);
  var tab = ass.getSheetByName(WS_AI_OTHER_TAB) || ass.insertSheet(WS_AI_OTHER_TAB);
  var width = WS_AI_OTHER_HEADER.length;
  var old = tab.getLastRow();
  if (old > 0) tab.getRange(1, 1, old, width).clearContent();
  tab.getRange(1, 1, 1, width).setValues([WS_AI_OTHER_HEADER]);
  if (rows.length > 0) tab.getRange(2, 1, rows.length, width).setValues(rows);
  tab.getRange(rows.length + 3, 1, 1, 1).setValues([[WS_AI_OTHER_NOTE]]);
  tab.setFrozenRows(1);
  return { ok: true, rows: rows.length, message: "기타예산 " + rows.length + "개월" };
}
