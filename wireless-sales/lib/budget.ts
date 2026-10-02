import { COLUMN_LETTER } from "@/lib/sheet-columns";
import type { SheetSale } from "@/lib/sheet-record";

/*
 * 예산 계산 (선택한 월 시트의 모든 판매 행 기준). 빈 칸·"-" 는 0 으로 더한다.
 *   고객혜택 확보금액 = P + Q + R + S + T (디초/삼초·애플매니아·2ND·모델정책·고객혜택)
 *   고객혜택 사용금액 = V + W + X + Y (모델/요금·추가지원금·디초/삼초·2nd)
 *   고객혜택 잔여금액 = 확보 − 사용
 *   스팟예산          = O (SPOT정책)
 *   현금예산          = AB (중고판매 잔여)
 *   총 매장 예산      = 잔여 + 스팟 + 현금
 */

export const BENEFIT_SECURED_KEYS = [
  "securedDicho",
  "appleMania",
  "securedSecond",
  "modelPolicy",
  "customerBenefit",
] as const;
export const BENEFIT_USED_KEYS = [
  "usedModelPlan",
  "usedExtraSupport",
  "usedDicho",
  "usedSecond",
] as const;

export interface Budget {
  benefitSecured: number;
  benefitUsed: number;
  benefitRemaining: number;
  spot: number;
  cash: number;
  total: number;
}

function sum(sales: SheetSale[], keys: readonly (keyof SheetSale)[]): number {
  return sales.reduce(
    (total, sale) =>
      total +
      keys.reduce((s, key) => s + ((sale[key] as number | null) ?? 0), 0),
    0,
  );
}

export function calculateBudget(sales: SheetSale[]): Budget {
  const benefitSecured = sum(sales, BENEFIT_SECURED_KEYS);
  const benefitUsed = sum(sales, BENEFIT_USED_KEYS);
  const benefitRemaining = benefitSecured - benefitUsed;
  const spot = sum(sales, ["spot"]);
  const cash = sum(sales, ["usedPhoneRemaining"]);
  return {
    benefitSecured,
    benefitUsed,
    benefitRemaining,
    spot,
    cash,
    total: benefitRemaining + spot + cash,
  };
}

/** 화면에 보여줄 "어느 열의 합계인지" 설명 */
export const BUDGET_COLUMNS = {
  benefitSecured: BENEFIT_SECURED_KEYS.map((k) => COLUMN_LETTER[k]).join("+"),
  benefitUsed: BENEFIT_USED_KEYS.map((k) => COLUMN_LETTER[k]).join("+"),
  spot: COLUMN_LETTER.spot,
  cash: COLUMN_LETTER.usedPhoneRemaining,
};
