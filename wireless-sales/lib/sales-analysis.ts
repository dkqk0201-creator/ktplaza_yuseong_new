import { BENEFIT_SECURED_KEYS, BENEFIT_USED_KEYS } from "@/lib/budget";
import { PRODUCT_METRIC_KEYS, countMetrics, metricHit, saleMetrics, type MetricCounts, type ProductMetricKey } from "@/lib/product-metrics";
import { INFLOW_MISSING, INFLOW_SOURCES, inflowOf } from "@/lib/sale-link";
import type { SheetSale } from "@/lib/sheet-record";

/*
 * 판매 분석 (조회 전용 — 장표·예산 계산을 바꾸지 않는다). 날짜 기준: C열 개통일.
 *  - 기간: 일(그날) · 주(월요일~일요일) · 월(월 시트 전체)
 *  - 유입경로: 판매 1건에 대표 1개. 값이 없으면 "미입력" (직접 고른 "미확인"과 구분)
 *    ※ 상담 후 구매하지 않은 고객 데이터가 없으므로 전환율은 계산하지 않는다 — 판매 건수·판매 비중만.
 *  - 예산: 직원 실적관리와 같은 정의 (예산 계산 방식 그대로)
 *      확보 = 고혜확보 P+Q+R+S+T, 사용 = 고혜사용 V+W+X+Y, 현금잔여 = AB, 최종 잔여 = 확보 − 사용 + 현금잔여
 */

export interface BudgetTotals {
  secured: number;
  used: number;
  cash: number;
  remaining: number;
}

export function budgetTotals(sales: readonly SheetSale[]): BudgetTotals {
  let secured = 0;
  let used = 0;
  let cash = 0;
  for (const s of sales) {
    for (const k of BENEFIT_SECURED_KEYS) secured += s[k] ?? 0;
    for (const k of BENEFIT_USED_KEYS) used += s[k] ?? 0;
    cash += s.usedPhoneRemaining ?? 0;
  }
  return { secured, used, cash, remaining: secured - used + cash };
}

/* ---------- 기간 ---------- */

const DAY_MS = 86_400_000;
function toUtc(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}
function fromUtc(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}
/** 그 날짜가 속한 주의 월요일 */
export function weekStart(date: string): string {
  const ms = toUtc(date);
  const dow = new Date(ms).getUTCDay(); // 0=일
  return fromUtc(ms - ((dow + 6) % 7) * DAY_MS);
}
export function addDays(date: string, days: number): string {
  return fromUtc(toUtc(date) + days * DAY_MS);
}
/** start~end(포함) 개통일 판매 */
export function inRange(sales: readonly SheetSale[], start: string, end: string): SheetSale[] {
  return sales.filter((s) => /^\d{4}-\d{2}-\d{2}$/.test(s.activatedAt) && s.activatedAt >= start && s.activatedAt <= end);
}

export interface Period {
  kind: "day" | "week" | "month";
  start: string;
  end: string;
  label: string;
}
export function dayPeriod(date: string): Period {
  return { kind: "day", start: date, end: date, label: date };
}
export function weekPeriod(date: string): Period {
  const start = weekStart(date);
  return { kind: "week", start, end: addDays(start, 6), label: `${start} ~ ${addDays(start, 6)}` };
}
export function monthPeriod(yearMonth: string): Period {
  const [y, m] = yearMonth.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { kind: "month", start: `${yearMonth}-01`, end: `${yearMonth}-${String(last).padStart(2, "0")}`, label: yearMonth };
}

/* ---------- 유입경로 ---------- */

/** 표시 순서: 선택값 14개 + 미입력 */
export const INFLOW_ROWS: readonly string[] = [...INFLOW_SOURCES, INFLOW_MISSING];

export interface InflowRow {
  inflow: string;
  sales: number;
  /** 판매 비중(%) — 전체 판매 대비 (전환율 아님) */
  share: number;
  metrics: MetricCounts;
  budget: BudgetTotals;
}

export function groupBy<T>(items: readonly T[], keyOf: (t: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const k = keyOf(item);
    const list = map.get(k);
    if (list) list.push(item);
    else map.set(k, [item]);
  }
  return map;
}

function pct(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part / whole) * 1000) / 10;
}

export function inflowRows(sales: readonly SheetSale[]): InflowRow[] {
  const groups = groupBy(sales, inflowOf);
  return INFLOW_ROWS.map((inflow) => {
    const list = groups.get(inflow) ?? [];
    return { inflow, sales: list.length, share: pct(list.length, sales.length), metrics: countMetrics(list), budget: budgetTotals(list) };
  });
}

export interface InputRate {
  total: number;
  /** 유입경로가 저장된 판매 ("미확인" 포함) */
  entered: number;
  missing: number;
  /** 입력률(%) */
  rate: number;
  unknown: number;
}
export function inflowInputRate(sales: readonly SheetSale[]): InputRate {
  const missing = sales.filter((s) => inflowOf(s) === INFLOW_MISSING).length;
  const unknown = sales.filter((s) => inflowOf(s) === "미확인").length;
  return { total: sales.length, entered: sales.length - missing, missing, rate: pct(sales.length - missing, sales.length), unknown };
}

/** 행(예: 직원) × 유입경로 판매 건수 */
export function crossCount(
  sales: readonly SheetSale[],
  rowOf: (s: SheetSale) => string,
): { rows: string[]; cells: Map<string, Map<string, number>> } {
  const cells = new Map<string, Map<string, number>>();
  for (const s of sales) {
    const r = rowOf(s);
    const i = inflowOf(s);
    if (!cells.has(r)) cells.set(r, new Map());
    const row = cells.get(r)!;
    row.set(i, (row.get(i) ?? 0) + 1);
  }
  return { rows: [...cells.keys()].sort((a, b) => a.localeCompare(b, "ko")), cells };
}

/** 지표 × 유입경로: 그 지표에 해당하는 판매만 유입경로별로 셈 (지표끼리 더하지 않음) */
export function metricByInflow(sales: readonly SheetSale[]): Map<ProductMetricKey, Map<string, number>> {
  const out = new Map<ProductMetricKey, Map<string, number>>();
  for (const key of PRODUCT_METRIC_KEYS) out.set(key, new Map());
  for (const s of sales) {
    const m = saleMetrics(s);
    const i = inflowOf(s);
    for (const key of PRODUCT_METRIC_KEYS) {
      if (!metricHit(m, key)) continue;
      const row = out.get(key)!;
      row.set(i, (row.get(i) ?? 0) + 1);
    }
  }
  return out;
}

/** 캠페인별 판매 건수 (캠페인 없는 판매 제외) */
export function campaignRows(sales: readonly SheetSale[]): { campaign: string; sales: number; inflows: Map<string, number> }[] {
  const groups = groupBy(
    sales.filter((s) => s.link?.campaign?.trim()),
    (s) => s.link!.campaign.trim(),
  );
  return [...groups.entries()]
    .map(([campaign, list]) => ({ campaign, sales: list.length, inflows: groupCount(list, inflowOf) }))
    .sort((a, b) => b.sales - a.sales || a.campaign.localeCompare(b.campaign, "ko"));
}

export function groupCount<T>(items: readonly T[], keyOf: (t: T) => string): Map<string, number> {
  const m = new Map<string, number>();
  for (const t of items) m.set(keyOf(t), (m.get(keyOf(t)) ?? 0) + 1);
  return m;
}

/** 주별 추이: 월요일 시작 주마다 유입경로별 판매 건수 */
export function weeklyInflowTrend(sales: readonly SheetSale[]): { week: string; total: number; inflows: Map<string, number> }[] {
  const dated = sales.filter((s) => /^\d{4}-\d{2}-\d{2}$/.test(s.activatedAt));
  const groups = groupBy(dated, (s) => weekStart(s.activatedAt));
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([week, list]) => ({ week, total: list.length, inflows: groupCount(list, inflowOf) }));
}

/* ---------- 비교 ---------- */

export interface Change {
  current: number;
  previous: number;
  diff: number;
}
export function change(current: number, previous: number): Change {
  return { current, previous, diff: current - previous };
}
