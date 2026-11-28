/**
 * other-budget-tab.gs — 유성점 AI 운영 분석데이터 "기타예산" 탭 (분석 Apps Script 프로젝트에 새 파일로 추가, 2026-11-28)
 *
 * 목적: 웹앱 예산관리에 추가된 "기타 예산"(고객혜택과 별도인 매장 단위 확보·차감)을 AI 아침 브리핑이 잘못 해석하지 않도록,
 *       기존 "직원별예산" 탭은 그대로 두고 매장 총예산 계산 근거를 별도 탭으로 보여준다.
 *
 *   장표기준총매장예산 = 직원별예산 탭 "매장 전체" 행 총매장예산과 같은 값 (고객혜택잔여 + 스팟 + 현금, 고불비·기타 미반영)
 *   기존매장총예산     = 장표기준 − 고불비사용 (웹앱 '기존 매장 총예산')
 *   최종매장총예산     = 기존매장총예산 + 기타예산순증감 (웹앱 예산관리 큰 카드)
 *
 * 원본(무선장표)은 읽기만 한다: "고불비사용내역"(지급일 기준, 상태 사용) · "기타예산내역"(적용 월 기준, 상태 사용).
 * 메모는 넣지 않는다. 항목명은 넣되 9자리 이상 숫자(전화번호 등)는 가린다. 쓰기 직전 aiPiiProblem_ 검사는 Code.gs 가 그대로 한다.
 *
 * Code.gs 에 필요한 연결 (4곳, 기존 트리거·자동화 그대로):
 *   1) AI_TABS 의 '데이터갱신현황' 앞에 { name: '기타예산', deps: ['wireless'], text: ['연월'], headers: [아래 AI_OTHER_TAB_HEADERS 와 같은 칸] }
 *   2) aiReadWireless_ 반환값에 extras: (typeof aiReadBudgetExtras_ === 'function' ? aiReadBudgetExtras_(ss) : null)
 *   3) aiRefresh_ builders 에 '기타예산': function () { return aiBuildOtherBudget_(data.wireless, range); }
 *   4) aiGuideRows_ 에 '기타 예산' 설명 한 줄
 */
var AI_OTHER_TAB_HEADERS = ['연월', '장표기준총매장예산', '고불비사용', '기존매장총예산', '기타예산확보', '기타예산차감', '기타예산순증감',
  '최종매장총예산', '기타예산항목수', '기타예산항목', '상태'];
var AI_OTHER_GOBULBI_HEADER = ['고유 ID', '지급일', '내용', '금액', '판매자', '등록일', '수정일', '상태', '삭제일시'];
var AI_OTHER_SRC_HEADER = ['고유 ID', '적용 월', '항목명', '구분', '금액', '메모', '등록일시', '수정일시', '상태', '삭제일시'];

function aiOtherHeaderOk_(sh, header) {
  if (!sh || sh.getLastRow() < 1 || sh.getMaxColumns() < header.length) return false;
  var row = sh.getRange(1, 1, 1, header.length).getValues()[0];
  for (var i = 0; i < header.length; i++) if (String(row[i]).trim() !== header[i]) return false;
  return true;
}
function aiOtherMask_(t) { return String(t).replace(/\d[\d\s.-]{7,}\d/g, '***'); }

/** 무선장표의 고불비사용내역·기타예산내역 (읽기만). 절대 예외를 던지지 않는다 → { gobulbi: {ym: 합계}, other: {ym: {...}}, problems: [] } */
function aiReadBudgetExtras_(ss) {
  var out = { gobulbi: {}, other: {}, problems: [] };
  try {
    var gs = ss.getSheetByName('고불비사용내역');
    if (gs && gs.getLastRow() > 0) {
      if (!aiOtherHeaderOk_(gs, AI_OTHER_GOBULBI_HEADER)) out.problems.push('고불비사용내역 제목 다름');
      else aiSheetRows_(gs, 9).forEach(function (r) {
        var st = aiText_(r[7]) || '사용';
        var d = aiText_(r[1]);
        if (st !== '사용' || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return;
        out.gobulbi[d.substring(0, 7)] = (out.gobulbi[d.substring(0, 7)] || 0) + aiAmount_(r[3]);
      });
    }
  } catch (e) { out.problems.push('고불비사용내역 읽기 실패'); }
  try {
    var os = ss.getSheetByName('기타예산내역');
    if (os && os.getLastRow() > 0) {
      if (!aiOtherHeaderOk_(os, AI_OTHER_SRC_HEADER)) out.problems.push('기타예산내역 제목 다름');
      else aiSheetRows_(os, 10).forEach(function (r) {
        var st = aiText_(r[8]) || '사용';
        if (st !== '사용') return;
        var ym = aiIsDateObj_(r[1]) ? Utilities.formatDate(r[1], AI.TZ, 'yyyy-MM') : aiText_(r[1]);
        var kind = aiText_(r[3]), amount = aiAmount_(r[4]);
        if (!/^\d{4}-\d{2}$/.test(ym) || (kind !== '확보' && kind !== '차감') || !(amount > 0)) return;
        var o = out.other[ym] || (out.other[ym] = { gain: 0, deduct: 0, names: [] });
        if (kind === '확보') o.gain += amount; else o.deduct += amount;
        o.names.push(aiOtherMask_(aiText_(r[2])).substring(0, 40) + '(' + (kind === '확보' ? '+' : '-') + amount + ')');
      });
    }
  } catch (e) { out.problems.push('기타예산내역 읽기 실패'); }
  return out;
}

/** 기타예산 탭 행: 분석 기간 중 월 시트가 있는 달 (매장 단위 1행씩) */
function aiBuildOtherBudget_(W, range) {
  var x = W.extras || { gobulbi: {}, other: {}, problems: ['기타 예산 원본 미확인'] };
  var rows = [];
  range.months.forEach(function (ym) {
    if (!W.months[ym]) return;
    var z = aiGroupSales_(W.sales.filter(function (s) { return s.ym === ym; }), []).store;
    var base = z.secured - z.used - z.extra + z.spot + z.cash;   // 직원별예산 '매장 전체' 총매장예산과 같은 계산
    var g = x.gobulbi[ym] || 0;
    var o = x.other[ym] || { gain: 0, deduct: 0, names: [] };
    var existing = base - g, net = o.gain - o.deduct;
    rows.push([ym, base, g, existing, o.gain, o.deduct, net, existing + net, o.names.length, o.names.join('; '),
      x.problems.length ? '확인 필요: ' + x.problems.join(', ') : '정상']);
  });
  return rows;
}
