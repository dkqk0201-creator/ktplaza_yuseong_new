import type { SheetSale } from "@/lib/sheet-record";

/*
 * 고객조회 판정 규칙 (읽기 전용).
 * 기본 모수: 선택한 월 시트의 판매 중 F열 실력지표제외 = X 인 고객만.
 *   그 외(O·빈칸·기타)는 고객조회의 모든 숫자와 결과에서 뺀다.
 * 스초: K열 요금제에 "스초" 포함 여부
 * 필L : AI열 부가에 "필L" 포함 여부 (대소문자 무시)
 * 보험: AJ열 보험이 빈칸·X·"-" 이면 없음(X), 그 외 값이 있으면 있음(O)
 *   (간편등록은 보험을 O/X 로 저장하고 빈칸이면 X 로 저장, 양식 빈 행은 빈칸)
 */

export type Tri = "all" | "O" | "X";

export interface CustomerFilter {
  scho: Tri;
  pilL: Tri;
  insurance: Tri;
}

export function isExcludeX(sale: SheetSale): boolean {
  return sale.excludeIndicator.trim().toUpperCase() === "X";
}

export function hasScho(sale: SheetSale): boolean {
  return sale.plan.includes("스초");
}

export function hasPilL(sale: SheetSale): boolean {
  return sale.addon.toUpperCase().includes("필L");
}

export function hasInsurance(sale: SheetSale): boolean {
  const value = sale.insurance.trim().toUpperCase();
  return value !== "" && value !== "X" && value !== "-";
}

/** 기본 모수: 실력지표제외 = X */
export function customerBase(sales: readonly SheetSale[]): SheetSale[] {
  return sales.filter(isExcludeX);
}

function match(tri: Tri, value: boolean): boolean {
  return tri === "all" || (tri === "O") === value;
}

/** 기본 모수 안에서 스초·필L·보험 조건을 모두 만족하는 고객 */
export function filterCustomers(
  base: readonly SheetSale[],
  filter: CustomerFilter,
): SheetSale[] {
  return base.filter(
    (s) =>
      match(filter.scho, hasScho(s)) &&
      match(filter.pilL, hasPilL(s)) &&
      match(filter.insurance, hasInsurance(s)),
  );
}

export interface CustomerSummary {
  base: number;
  schoO: number;
  schoX: number;
  pilLO: number;
  pilLX: number;
  insuranceO: number;
  insuranceX: number;
}

export function summarizeCustomers(
  base: readonly SheetSale[],
): CustomerSummary {
  const count = (fn: (s: SheetSale) => boolean) => base.filter(fn).length;
  const schoO = count(hasScho);
  const pilLO = count(hasPilL);
  const insuranceO = count(hasInsurance);
  return {
    base: base.length,
    schoO,
    schoX: base.length - schoO,
    pilLO,
    pilLX: base.length - pilLO,
    insuranceO,
    insuranceX: base.length - insuranceO,
  };
}
