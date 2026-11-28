/*
 * '스팟' → '충청' 명칭 기준 (2026-11-28 점장 결정, 화면·메모 공용).
 *   2026년 10월까지: "스팟" (스팟1, 스팟예산)
 *   2026년 11월부터: "충청" (충청1, 충청예산)
 * 기간별로 이름만 다를 뿐 같은 예산 항목이다 (장표 O열 SPOT정책). 금액·계산·O열·수식은 그대로이고,
 * 메모의 "스팟1" 과 "충청1" 은 같은 1번으로 함께 읽는다 (중복 집계하지 않음).
 * 기존 메모는 고치지 않는다. 새 일괄등록 메모만 판매 개통일의 월 기준으로 "충청1 3만" / "스팟1 3만" 으로 쓴다
 * (Apps Script spot-bulk.gs 의 wsSpotBulkTerm_ 과 같은 규칙).
 */

export type SpotTerm = "스팟" | "충청";

/** 이 연월(YYYY-MM)부터 '충청' */
export const CHUNGCHEONG_FROM = "2026-11";

/** 연월(YYYY-MM) 또는 날짜(YYYY-MM-DD) → 그 시기의 명칭. 알 수 없으면 현재 명칭('충청') */
export function spotTerm(monthOrDate: string | undefined | null): SpotTerm {
  const ym = String(monthOrDate ?? "").slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(ym)) return "충청";
  return ym >= CHUNGCHEONG_FROM ? "충청" : "스팟";
}

/** 메뉴·화면 제목처럼 기간과 무관한 곳에 쓰는 현재 명칭 */
export const CURRENT_SPOT_TERM: SpotTerm = "충청";

/** 기간이 두 명칭에 걸칠 때 쓰는 이름 (예: "충청(스팟)") */
export function spotTermForRange(from: string, to: string): string {
  const a = spotTerm(from);
  const b = spotTerm(to);
  return a === b ? a : `${b}(${a})`;
}
