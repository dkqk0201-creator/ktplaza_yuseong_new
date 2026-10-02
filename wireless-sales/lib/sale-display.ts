import { formatCtn, formatDate, formatNumber } from "@/lib/format";

/* 장표 판매내역을 화면에 보여줄 때 함께 쓰는 표시 규칙 (검수관리·카드실적·상세 공용) */

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
