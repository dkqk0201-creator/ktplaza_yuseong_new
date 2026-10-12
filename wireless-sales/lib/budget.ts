import { COLUMN_LETTER } from "@/lib/sheet-columns";
import type { SheetSale } from "@/lib/sheet-record";

/*
 * 예산 계산 (선택한 월 시트의 모든 판매 행 기준). 빈 칸·"-" 는 0 으로 더한다.
 *   고객혜택 확보금액 = P + Q + R + S + T (디초/삼초·애플매니아·2ND·모델정책·고객혜택)
 *   고객혜택 사용금액 = V + X + Y (모델/요금·디초/삼초·2nd)      — 예산관리 카드
 *   추가지원금 사용금액 = W (추가지원금)                            — 예산관리 카드
 *   (benefitUsed = V + W + X + Y = 위 두 금액의 합, 장표 U열과 같음 — 직원별 실적 등 기존 계산용)
 *   고객혜택 잔여금액 = 확보 − 고객혜택 사용금액 − 추가지원금 사용금액 (= 확보 − (V+W+X+Y), 값은 이전과 같음)
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

/** 예산관리 "고객혜택 사용금액" 카드 = V + X + Y */
export const CUSTOMER_BENEFIT_USED_KEYS = ["usedModelPlan", "usedDicho", "usedSecond"] as const;
/** 예산관리 "추가지원금 사용금액" 카드 = W */
export const EXTRA_SUPPORT_USED_KEYS = ["usedExtraSupport"] as const;

export interface Budget {
  benefitSecured: number;
  /** V + W + X + Y (= customerBenefitUsed + extraSupportUsed) */
  benefitUsed: number;
  /** V + X + Y */
  customerBenefitUsed: number;
  /** W */
  extraSupportUsed: number;
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
  const customerBenefitUsed = sum(sales, CUSTOMER_BENEFIT_USED_KEYS);
  const extraSupportUsed = sum(sales, EXTRA_SUPPORT_USED_KEYS);
  const benefitUsed = sum(sales, BENEFIT_USED_KEYS);
  const benefitRemaining = benefitSecured - customerBenefitUsed - extraSupportUsed;
  const spot = sum(sales, ["spot"]);
  const cash = sum(sales, ["usedPhoneRemaining"]);
  return {
    benefitSecured,
    benefitUsed,
    customerBenefitUsed,
    extraSupportUsed,
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
  customerBenefitUsed: CUSTOMER_BENEFIT_USED_KEYS.map((k) => COLUMN_LETTER[k]).join("+"),
  extraSupportUsed: EXTRA_SUPPORT_USED_KEYS.map((k) => COLUMN_LETTER[k]).join("+"),
  spot: COLUMN_LETTER.spot,
  cash: COLUMN_LETTER.usedPhoneRemaining,
};

/* ── 예산관리 카드 → 고객별 사용내역 ───────────────────────────── */

export type UsageKind = "customerBenefit" | "extraSupport";

export interface UsagePart {
  /** 열 글자 (V, X, Y, W) */
  column: string;
  label: string;
  amount: number;
}

export interface UsageRow {
  sale: SheetSale;
  /** 이 카드에 해당하는 금액 합계 */
  amount: number;
  /** 열별 금액 (고객혜택: V·X·Y / 추가지원금: W) */
  parts: UsagePart[];
}

const USAGE_PARTS: Record<UsageKind, readonly { key: keyof SheetSale; label: string }[]> = {
  customerBenefit: [
    { key: "usedModelPlan", label: "모델/요금" },
    { key: "usedDicho", label: "디초/삼초" },
    { key: "usedSecond", label: "2nd" },
  ],
  extraSupport: [{ key: "usedExtraSupport", label: "추가지원금" }],
};

/**
 * 카드별 고객 목록: 금액이 0원인 판매는 뺀다 (빈 칸·"-" = 0). 개통일 → 행 순서.
 * 목록 합계는 calculateBudget 의 카드 금액과 같다 (같은 열을 같은 방식으로 더함).
 */
export function budgetUsageRows(sales: readonly SheetSale[], kind: UsageKind): UsageRow[] {
  const specs = USAGE_PARTS[kind];
  return sales
    .map((sale) => {
      const parts = specs.map(({ key, label }) => ({
        column: COLUMN_LETTER[key as keyof typeof COLUMN_LETTER],
        label,
        amount: (sale[key] as number | null) ?? 0,
      }));
      return { sale, parts, amount: parts.reduce((t, p) => t + p.amount, 0) };
    })
    .filter((r) => r.amount !== 0)
    .sort((a, b) =>
      a.sale.activatedAt !== b.sale.activatedAt
        ? a.sale.activatedAt < b.sale.activatedAt
          ? -1
          : 1
        : a.sale.row - b.sale.row,
    );
}
