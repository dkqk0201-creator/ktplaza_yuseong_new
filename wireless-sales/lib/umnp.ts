import type { SheetSale } from "@/lib/sheet-record";

/*
 * UMNP 판매: 실제 후불 개통이 아니라 UMNP 예산 확인용으로 장표에 등록하는 행.
 *   - 후불 실적 건수(예산관리 현재 실적·직원 실적관리 후불)에서 제외
 *   - 판매 No.(B열) 없음 (Apps Script 가 빈칸으로 두고 다음 일반 판매가 번호를 이어받음)
 *   - 예산(O~T·N·V~Y·U·Z·AA·AB·AC·SPOT)은 일반 판매와 똑같이 포함
 */
export function isUmnpCategory(category: string): boolean {
  return category.replace(/\s/g, "").toUpperCase() === "UMNP";
}

export function isUmnpSale(sale: Pick<SheetSale, "category">): boolean {
  return isUmnpCategory(sale.category);
}

/** 후불 실적 건수 (예산관리 "현재 실적"): UMNP 를 뺀 판매 행 수 */
export function postpaidCount(sales: readonly SheetSale[]): number {
  return sales.filter((s) => !isUmnpSale(s)).length;
}
