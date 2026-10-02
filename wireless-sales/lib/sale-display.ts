import { formatCtn, formatDate, formatNumber } from "@/lib/format";
import type { SheetSale } from "@/lib/sheet-record";

/* 장표 판매내역을 화면에 보여줄 때 함께 쓰는 표시 규칙 (대시보드·판매 현황 공용) */

/** 금액이 비어 있으면 "-" */
export function amountText(value: number | null): string {
  return value === null ? "-" : `${formatNumber(value)}원`;
}

/** "2026-10-02" → "2026.10.02", 그 외 값은 그대로 */
export function dateText(value: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? formatDate(value) : value || "-";
}

/** 목록에서는 가운데 4자리를 가린다: 010-****-5678 */
export function maskedCtn(ctn: string): string {
  const formatted = formatCtn(ctn);
  const parts = formatted.split("-");
  return parts.length === 3
    ? `${parts[0]}-${"*".repeat(parts[1].length)}-${parts[2]}`
    : formatted;
}

/** 개통구분 배지 색 (장표의 "기변/번이/신규", 웹앱의 "기기변경/번호이동/신규" 모두) */
export function categoryStyle(category: string): string {
  if (category.startsWith("신규"))
    return "bg-sky-50 text-sky-700 ring-sky-600/20";
  if (category.startsWith("번"))
    return "bg-rose-50 text-rose-700 ring-rose-600/20";
  if (category.startsWith("기"))
    return "bg-amber-50 text-amber-700 ring-amber-600/20";
  return "bg-zinc-100 text-ink-sub ring-zinc-400/20";
}

/** 금액 합계 (빈 칸은 0으로) */
export function sumAmount(
  sales: readonly SheetSale[],
  pick: (sale: SheetSale) => number | null,
): number {
  return sales.reduce((total, sale) => total + (pick(sale) ?? 0), 0);
}
