import { DONGPAN_TYPES, dongpanNeedsCheck, dongpanType, type DongpanType } from "@/lib/product-metrics";
import type { SheetSale } from "@/lib/sheet-record";

/*
 * 동판 구분 (조회 전용). 원본 = 무선장표 AK열(동판).
 * 기준은 공용 상품 지표(lib/product-metrics.ts)와 같다 (2026-11-14 통일):
 *   AK열 값이 "순동" · "신동" · "약동" 으로 시작하면 그 구분 (뒤에 금액·메모가 붙어도: "약동-18만원" → 약동).
 *   "약돈-…" 처럼 첫 두 글자가 비슷한 오타는 어느 구분에도 넣지 않고 "동판 확인 필요" 로만 따로 거른다.
 *   ("x 인단독", "당월 재방문(인)", "미사용", "X" 등 다른 글자는 어느 구분에도 넣지 않는다)
 * 판매 1건(장표 1행) 단위, UMNP 포함. 검수·수납 상태·검수 보완 기록은 바꾸지 않는다 (검수관리 필터에만 씀).
 */

export const DONGPAN_KINDS = DONGPAN_TYPES;
export type DongpanKind = DongpanType;

/** 판매의 동판 구분. 셋 중 하나로 시작하지 않으면 null */
export function dongpanKind(sale: Pick<SheetSale, "dongpan">): DongpanKind | null {
  return dongpanType(sale.dongpan ?? "");
}

/** 동판 오타 의심 (확인 필요) */
export function dongpanCheckNeeded(sale: Pick<SheetSale, "dongpan">): boolean {
  return dongpanNeedsCheck(sale.dongpan ?? "");
}

export function isDongpanKind(value: string): value is DongpanKind {
  return (DONGPAN_KINDS as readonly string[]).includes(value);
}
