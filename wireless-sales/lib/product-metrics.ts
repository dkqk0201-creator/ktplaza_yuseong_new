import { normalizeCategory } from "@/lib/quick-report";
import { isO, type SheetSale } from "@/lib/sheet-record";

/*
 * 무선 상품 지표 — 직원 실적관리·목표관리·유입경로 분석이 함께 쓰는 단 하나의 집계 기준 (조회 전용, 장표를 바꾸지 않음).
 * 판매 1건 = 장표 1행. 한 판매가 여러 지표에 동시에 들어갈 수 있다 (예: 번호이동 + 스초 + 2ND).
 * → 지표 건수끼리 더해서 "총 개통"으로 쓰지 않는다. 총 개통은 판매 행 수(후불 + UMNP 따로)로만 센다.
 *
 * 확정 기준 (2026-11-13):
 *   후불      개통구분(I) 기기변경·번호이동·신규 (UMNP 제외 — UMNP 는 따로 셈)
 *   번호이동  개통구분 번호이동
 *   UMNP      개통구분 UMNP
 *   초스/스초 요금제(K)에 "스초" 또는 "초스" 가 들어 있음 (둘 다 있어도 1건)
 *   디초/삼초 판매보고 "디초/삼초 : O" (웹앱참고의 디초/삼초 보고내용이 정확히 O). P·X열 금액만으로는 세지 않음
 *   2ND       AD열 O
 *   제휴카드  제카 AE열 O
 *   동판      AK열이 "순동"·"신동"·"약동" 으로 시작 (뒤에 금액·메모가 붙어도 그 유형). 세부: 순동·신동·약동
 *             "약돈" 처럼 첫 두 글자가 비슷한 오타는 세지 않고 "확인 필요"로 따로 표시 (장표 값은 고치지 않음)
 *   굿바이    판매연결의 굿바이 표시가 O — ※ 인정 기준 미확정 (제안 기준). 중고폰 금액으로는 세지 않음
 * 실력지표제외(F열) O 인 판매도 포함한다 (F열 값·다른 기능의 의미는 그대로).
 */

export const DONGPAN_TYPES = ["순동", "신동", "약동"] as const;
export type DongpanType = (typeof DONGPAN_TYPES)[number];

/** 목표·분석에 쓰는 지표 (순서 = 화면 순서) */
export const PRODUCT_METRICS = [
  { key: "postpaid", label: "후불" },
  { key: "portIn", label: "번호이동" },
  { key: "scho", label: "초스/스초" },
  { key: "dicho", label: "디초/삼초" },
  { key: "second", label: "2ND" },
  { key: "card", label: "제휴카드" },
  { key: "dongpan", label: "동판" },
  { key: "goodbye", label: "굿바이" },
] as const;
export type ProductMetricKey = (typeof PRODUCT_METRICS)[number]["key"];
export const PRODUCT_METRIC_KEYS: readonly ProductMetricKey[] = PRODUCT_METRICS.map((m) => m.key);
export const PRODUCT_METRIC_LABEL = Object.fromEntries(
  PRODUCT_METRICS.map((m) => [m.key, m.label]),
) as Record<ProductMetricKey, string>;
/** 인정 기준이 아직 확정되지 않은 지표 (화면에 "기준 미확정" 표시) */
export const UNCONFIRMED_METRICS: ReadonlySet<ProductMetricKey> = new Set(["goodbye"]);

export function isProductMetricKey(value: unknown): value is ProductMetricKey {
  return typeof value === "string" && (PRODUCT_METRIC_KEYS as readonly string[]).includes(value);
}

const POSTPAID = new Set(["기기변경", "번호이동", "신규"]);

/** 동판 유형 (AK열). 순동·신동·약동으로 시작하지 않으면 null */
export function dongpanType(value: string): DongpanType | null {
  const v = (value ?? "").trim();
  return DONGPAN_TYPES.find((t) => v.startsWith(t)) ?? null;
}

/** 동판 오타 의심 (예: "약돈-…"): 순·신·약 + 동과 비슷한 글자로 시작. 집계하지 않고 확인 필요로만 표시 */
export function dongpanNeedsCheck(value: string): boolean {
  const v = (value ?? "").trim();
  return dongpanType(v) === null && /^[순신약]\s*[돈똥둥덩]/.test(v);
}

export function isScho(plan: string): boolean {
  return plan.includes("스초") || plan.includes("초스");
}

/** 판매 1건의 지표 판정 */
export interface SaleMetrics {
  postpaid: boolean;
  portIn: boolean;
  umnp: boolean;
  scho: boolean;
  dicho: boolean;
  second: boolean;
  card: boolean;
  dongpan: DongpanType | null;
  dongpanCheck: boolean;
  goodbye: boolean;
}

export function saleMetrics(sale: SheetSale): SaleMetrics {
  const category = normalizeCategory(sale.category);
  return {
    postpaid: category !== null && POSTPAID.has(category),
    portIn: category === "번호이동",
    umnp: category === "UMNP",
    scho: isScho(sale.plan),
    dicho: isO(sale.notes?.dicho ?? ""),
    second: isO(sale.secondPerformance),
    card: isO(sale.jeca),
    dongpan: dongpanType(sale.dongpan),
    dongpanCheck: dongpanNeedsCheck(sale.dongpan),
    goodbye: isO(sale.link?.goodbye ?? ""),
  };
}

export function metricHit(m: SaleMetrics, key: ProductMetricKey): boolean {
  return key === "dongpan" ? m.dongpan !== null : m[key];
}

/** 여러 판매의 지표 건수 */
export interface MetricCounts extends Record<ProductMetricKey, number> {
  /** 판매 행 수 (= 개통 건수, 후불 + UMNP + 개통구분 미확인) */
  sales: number;
  umnp: number;
  dongpanByType: Record<DongpanType, number>;
  /** 동판 오타 의심 (집계 제외, 확인 필요) */
  dongpanCheck: number;
}

export function emptyCounts(): MetricCounts {
  return {
    sales: 0,
    postpaid: 0,
    portIn: 0,
    scho: 0,
    dicho: 0,
    second: 0,
    card: 0,
    dongpan: 0,
    goodbye: 0,
    umnp: 0,
    dongpanByType: { 순동: 0, 신동: 0, 약동: 0 },
    dongpanCheck: 0,
  };
}

export function addSale(counts: MetricCounts, sale: SheetSale): void {
  const m = saleMetrics(sale);
  counts.sales += 1;
  for (const key of PRODUCT_METRIC_KEYS) if (metricHit(m, key)) counts[key] += 1;
  if (m.umnp) counts.umnp += 1;
  if (m.dongpan) counts.dongpanByType[m.dongpan] += 1;
  if (m.dongpanCheck) counts.dongpanCheck += 1;
}

export function countMetrics(sales: readonly SheetSale[]): MetricCounts {
  const counts = emptyCounts();
  for (const sale of sales) addSale(counts, sale);
  return counts;
}
