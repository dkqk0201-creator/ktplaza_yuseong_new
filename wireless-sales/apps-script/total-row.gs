/**
 * 무선 판매 관리 — 8행 합계(총계) 행 설정 (Apps Script 에 새 파일 total-row.gs 로 추가)
 *
 * 무선장표 8행은 판매 행이 아니라 "각 열의 합계" 행이다. 판매 데이터는 9행부터.
 * 금액 열 8행에 =SUM(열9:열) 수식을 넣어, 판매를 추가·수정·삭제하면(장표에서 직접 고쳐도)
 * 구글 시트가 자동으로 다시 계산하게 한다. SUM 은 "-", X, 빈칸 같은 글자를 0 으로 본다.
 *
 * 합계를 넣는 열 (6·7행 제목 기준):
 *   N 총 확보금액 · O SPOT정책 · P 디초/삼초 · Q 애플매니아 · R 2ND · S 모델정책 · T 고객혜택
 *   U 총 사용금액 · V 모델/요금 · W 추가지원금 · X 디초/삼초 · Y 2nd
 *   Z 중고 판매 · AA 중고 사용 · AB 중고 잔여 · AC 합계 · AH 제카확보예산
 * 그 밖의 8행 칸(A~M, AD~AG, AI~AL)은 건드리지 않는다.
 *
 * 사용법: Apps Script 편집기 위쪽 함수 선택에서 setupWirelessTotalRows 를 고르고 ▶ 실행.
 *   → "무선장표 양식" 과 모든 월 시트("1월"~"12월")의 8행에 합계 수식을 넣는다.
 *   여러 번 실행해도 안전하다 (이미 맞는 수식이 있는 칸은 그대로 둔다).
 *   웹앱 저장·조회와는 별개라 웹앱 재배포는 필요 없다.
 */
var WS_TOTAL_ROW = 8;
// 1부터 센 열 번호: N(14) ~ AC(29), AH(34)
var WS_TOTAL_COLUMNS = [14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 34];

/** 열 번호 → 그 열 8행 합계 수식 (예: 14 → =SUM(N9:N)) */
function wsTotalFormula_(col) {
  var letter = wsColumnLetter_(col);
  return "=SUM(" + letter + WS_FIRST_ROW + ":" + letter + ")";
}

/**
 * 한 시트의 8행 금액 열에 합계 수식을 넣는다. 바꾼 칸 수를 돌려준다.
 * 열 구조(6·7행 제목)가 웹앱과 다르면 아무것도 하지 않고 -1.
 */
function wsEnsureTotalRow_(sheet) {
  if (wsLayoutProblem_(sheet)) return -1;
  var first = WS_TOTAL_COLUMNS[0];
  var last = WS_TOTAL_COLUMNS[WS_TOTAL_COLUMNS.length - 1];
  var current = sheet
    .getRange(WS_TOTAL_ROW, first, 1, last - first + 1)
    .getFormulas()[0];
  var changed = 0;
  for (var i = 0; i < WS_TOTAL_COLUMNS.length; i++) {
    var col = WS_TOTAL_COLUMNS[i];
    var formula = wsTotalFormula_(col);
    if (current[col - first] !== formula) {
      sheet.getRange(WS_TOTAL_ROW, col).setFormula(formula);
      changed++;
    }
  }
  return changed;
}

/** 편집기에서 직접 실행: 양식 시트와 모든 월 시트의 8행 합계 수식 설정 */
function setupWirelessTotalRows() {
  var ss = wsSpreadsheet_();
  var names = [WS_TEMPLATE_SHEET].concat(wsMonthSheetNames_(ss));
  var lines = [];
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) {
    throw new Error("다른 작업이 진행 중입니다. 잠시 후 다시 실행해 주세요.");
  }
  try {
    for (var i = 0; i < names.length; i++) {
      var sheet = ss.getSheetByName(names[i]);
      if (!sheet) continue;
      var changed = wsEnsureTotalRow_(sheet);
      lines.push(
        names[i] +
          ": " +
          (changed < 0
            ? "열 구조가 달라 건너뜀"
            : changed === 0
              ? "이미 설정됨"
              : changed + "칸 합계 수식 설정"),
      );
    }
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }
  Logger.log(lines.join("\n"));
  return lines;
}
