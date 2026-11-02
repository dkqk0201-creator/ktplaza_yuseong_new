import type { SheetSale } from "@/lib/sheet-record";

/*
 * 동판 구분 (조회 전용). 원본 = 무선장표 AK열(동판).
 * 기준은 직원 실적관리(lib/staff-performance.ts)와 같다:
 *   AK열 값의 앞뒤 공백을 뺀 글자가 정확히 "순동" · "신동" · "약동" 인 판매만 그 구분.
 *   ("x 인단독", "당월 재방문(인)", "미사용", "X" 등 다른 글자는 어느 구분에도 넣지 않는다)
 * 판매 1건(장표 1행) 단위, UMNP 포함. 장표·실적 집계·예산 계산에는 쓰지 않고 검수관리 필터에만 쓴다.
 */

export const DONGPAN_KINDS = ["순동", "신동", "약동"] as const;
export type DongpanKind = (typeof DONGPAN_KINDS)[number];

/** 판매의 동판 구분. 셋 중 하나가 아니면 null */
export function dongpanKind(sale: Pick<SheetSale, "dongpan">): DongpanKind | null {
  const value = (sale.dongpan ?? "").trim();
  return (DONGPAN_KINDS as readonly string[]).includes(value) ? (value as DongpanKind) : null;
}

export function isDongpanKind(value: string): value is DongpanKind {
  return (DONGPAN_KINDS as readonly string[]).includes(value);
}
