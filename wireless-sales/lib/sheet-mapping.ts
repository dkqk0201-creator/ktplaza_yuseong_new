import { formatCtn } from "@/lib/format";
import {
  calculateTotals,
  toAmount,
  type SaleFormValues,
} from "@/lib/sale-form";

/*
 * 판매 등록 입력값 → Google 스프레드시트 "무선장표 양식" 한 행 변환.
 * 아직 실제 시트에 쓰지는 않는다. 연결 단계에서 buildSheetRow()의 결과를 그대로 사용한다.
 */

export const SHEET_NAME = "무선장표 양식";

/** 웹앱이 값을 채우는 열. B열(No.)은 시트의 기존 순번 구조를 사용하므로 제외한다. */
export const SHEET_COLUMNS = [
  { column: "A", header: "고객약속" },
  { column: "C", header: "개통일" },
  { column: "D", header: "고객" },
  { column: "E", header: "CTN" },
  { column: "F", header: "검수" },
  { column: "G", header: "수납" },
  { column: "H", header: "기변/번이/신규" },
  { column: "I", header: "모델명" },
  { column: "J", header: "요금제" },
  { column: "K", header: "요금제 유지/변경" },
  { column: "L", header: "직원명" },
  { column: "M", header: "총 확보금액" },
  { column: "N", header: "SPOT정책" },
  { column: "O", header: "디초/삼초" },
  { column: "P", header: "애플매니아" },
  { column: "Q", header: "2ND" },
  { column: "R", header: "모델인센" },
  { column: "S", header: "고객혜택" },
  { column: "T", header: "총 사용금액" },
  { column: "U", header: "모델/요금" },
  { column: "V", header: "디초/삼초" },
  { column: "W", header: "2ND" },
  { column: "X", header: "민원건" },
  { column: "Y", header: "중고판매 판매금액" },
  { column: "Z", header: "중고판매 사용금액" },
  { column: "AA", header: "중고판매 잔여금액" },
  { column: "AB", header: "합계" },
  { column: "AC", header: "2ND 실적 여부" },
  { column: "AD", header: "제카 실적 여부" },
  { column: "AE", header: "판매무기 종류" },
  { column: "AF", header: "판매무기 등록 여부" },
  { column: "AG", header: "제카확보예산" },
  { column: "AH", header: "필S" },
  { column: "AI", header: "필L" },
  { column: "AJ", header: "동판" },
  { column: "AK", header: "유선 가능일" },
] as const;

export type SheetColumn = (typeof SHEET_COLUMNS)[number]["column"];
export type SheetRow = Record<SheetColumn, string | number>;

export function buildSheetRow(values: SaleFormValues): SheetRow {
  const totals = calculateTotals(values);

  return {
    A: values.customerPromise.trim(),
    C: values.activatedAt,
    D: values.customer.trim(),
    E: formatCtn(values.ctn),
    F: values.inspected,
    G: values.paid,
    H: values.category,
    I: values.model.trim(),
    J: values.plan.trim(),
    K: values.planChange,
    L: values.staff,
    M: totals.securedTotal,
    N: toAmount(values.secured.spot),
    O: toAmount(values.secured.dicho),
    P: toAmount(values.secured.appleMania),
    Q: toAmount(values.secured.second),
    R: toAmount(values.secured.modelIncentive),
    S: toAmount(values.customerBenefitTotal),
    T: totals.usedTotal,
    U: toAmount(values.used.modelPlan),
    V: toAmount(values.used.dicho),
    W: toAmount(values.used.second),
    X: toAmount(values.used.complaint),
    Y: toAmount(values.usedPhoneSale),
    Z: toAmount(values.usedPhoneUsed),
    AA: totals.usedPhoneRemaining,
    AB: totals.finalTotal,
    AC: values.secondPerformance,
    AD: values.jecaPerformance,
    AE: values.weaponType.trim(),
    AF: values.weaponRegistered,
    AG: toAmount(values.jecaBudget),
    AH: values.pilS,
    AI: values.pilL,
    AJ: values.dongpan,
    AK: values.wiredAvailableDate,
  };
}
