import { maskPhone } from "@/lib/privacy-mask";
import { formatDate, formatNumber } from "@/lib/format";

/* 장표 판매내역을 화면에 보여줄 때 함께 쓰는 표시 규칙 (검수관리·카드실적·상세 공용) */

/** 금액이 비어 있으면 "-" */
export function amountText(value: number | null): string {
  return value === null ? "-" : `${formatNumber(value)}원`;
}

/** "2026-10-02" → "2026.10.02", 그 외 값은 그대로 */
export function dateText(value: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? formatDate(value) : value || "-";
}

/** 개통일 화면 표시: "2026-10-05" → "10.05" (값은 연도 포함 날짜 그대로, 표시만 월.일) */
export function monthDayText(value: string): string {
  const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(value);
  return m ? `${m[1]}.${m[2]}` : value || "-";
}

/** 목록 표시: 개인정보 마스킹 규칙과 같은 모양 (010-12**-*678). 이미 마스킹된 값은 그대로 */
export function maskedCtn(ctn: string): string {
  return maskPhone(ctn);
}
