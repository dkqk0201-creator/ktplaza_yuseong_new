import type { SheetSale } from "@/lib/sheet-record";

/*
 * 실력지표 판정 규칙 (읽기 전용).
 * 기본 모수: 선택한 월 시트의 판매 중 F열 실력지표제외 = X 인 고객만.
 *   그 외(O·빈칸·기타)는 실력지표의 모든 숫자와 결과에서 뺀다.
 * 실력지표 No.: 화면 표시 전용 순번 (장표 B열 No. 와 무관, 저장하지 않음) — numberCustomers 참고.
 * 스초: K열 요금제에 "스초" 포함 여부
 *   스초 모수(스초만 따로): 기본 모수 중 J열 모델명이 S·F·AIP 로 시작하는 고객
 *   (앞뒤 공백 제거, 대소문자 무시. 단 "SM-" 로 시작하는 삼성 정식 모델코드(예: SM-A366)는 제외)
 *   스초 O/X 집계·필터는 스초 모수 안에서만. 필L·보험·기본 모수는 이 조건과 무관.
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

/** 스초 모수 대상 모델: S·F·AIP 로 시작 (SM- 정식 모델코드 제외) */
export function isSchoTargetModel(model: string): boolean {
  const m = model.trim().toUpperCase();
  if (m.startsWith("SM-")) return false;
  return m.startsWith("S") || m.startsWith("F") || m.startsWith("AIP");
}

/** 스초 모수: 실력지표제외 = X 이면서 모델명이 S·F·AIP 로 시작 */
export function isSchoBase(sale: SheetSale): boolean {
  return isExcludeX(sale) && isSchoTargetModel(sale.model);
}

/** 스초 조건: 전체면 제한 없음, O/X 면 스초 모수 안에서만 */
function matchScho(tri: Tri, sale: SheetSale): boolean {
  return tri === "all" || (isSchoBase(sale) && match(tri, hasScho(sale)));
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
      matchScho(filter.scho, s) &&
      match(filter.pilL, hasPilL(s)) &&
      match(filter.insurance, hasInsurance(s)),
  );
}

/** 실력지표 화면 한 줄: 판매 + 화면 전용 순번 */
export interface NumberedCustomer {
  /** 실력지표 No. (1부터, 화면 표시 전용) */
  seq: number;
  sale: SheetSale;
}

/**
 * 실력지표 No. 부여 (장표 B열 No. 는 쓰지 않음):
 *   ① F열 = X 고객 추출 → ② 직원 선택(빈 값 = 직원 전체) 적용
 *   → ③ 기본 정렬(장표 행 순서)대로 1, 2, 3… 확정.
 * 스초·필L·보험 필터는 번호를 매긴 "뒤에" filterNumbered 로 적용하므로 번호가 바뀌지 않는다.
 */
export function numberCustomers(
  sales: readonly SheetSale[],
  staff: string,
): NumberedCustomer[] {
  return customerBase(sales)
    .filter((s) => !staff || s.staff === staff)
    .sort((a, b) => a.row - b.row)
    .map((sale, i) => ({ seq: i + 1, sale }));
}

/** ④ 번호가 확정된 고객에 스초·필L·보험 필터 적용 (번호 유지) */
export function filterNumbered(
  numbered: readonly NumberedCustomer[],
  filter: CustomerFilter,
): NumberedCustomer[] {
  return numbered.filter(
    ({ sale: s }) =>
      matchScho(filter.scho, s) &&
      match(filter.pilL, hasPilL(s)) &&
      match(filter.insurance, hasInsurance(s)),
  );
}

export interface CustomerSummary {
  base: number;
  /** 스초 모수 (스초O + 스초X) */
  schoBase: number;
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
  // 스초만 별도 모수 (필L·보험은 기본 모수 그대로)
  const schoBase = count(isSchoBase);
  const schoO = count((s) => isSchoBase(s) && hasScho(s));
  const pilLO = count(hasPilL);
  const insuranceO = count(hasInsurance);
  return {
    base: base.length,
    schoBase,
    schoO,
    schoX: schoBase - schoO,
    pilLO,
    pilLX: base.length - pilLO,
    insuranceO,
    insuranceX: base.length - insuranceO,
  };
}
