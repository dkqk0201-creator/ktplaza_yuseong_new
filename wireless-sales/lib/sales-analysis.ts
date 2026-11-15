import { BENEFIT_SECURED_KEYS, BENEFIT_USED_KEYS } from "@/lib/budget";
import { PRODUCT_METRIC_KEYS, countMetrics, metricHit, saleMetrics, type MetricCounts, type ProductMetricKey } from "@/lib/product-metrics";
import { inflowOf } from "@/lib/sale-link";
import { DEFAULT_INFLOW_OPTIONS, INFLOW_MISSING, INFLOW_UNKNOWN, inflowGroupOrder, type InflowOption } from "@/lib/inflow-options";
import { campaignOfLink, type Campaign } from "@/lib/campaigns";
import { ribbonOf } from "@/lib/ribbon";
import type { SheetSale } from "@/lib/sheet-record";

/*
 * 판매 분석 (조회 전용 — 장표·예산 계산을 바꾸지 않는다). 날짜 기준: C열 개통일.
 *  - 기간: 일(그날) · 주(월요일~일요일) · 월(월 시트 전체)
 *  - 유입경로: 판매 1건에 대표 1개. 값이 없으면 "미입력" (직접 고른 "미확인"과 구분), 원문만 있으면 "확인 필요",
 *    예전 14개 항목 값은 새 5개로 묶거나 "기존값 · 이름" 그대로 (lib/inflow-options.ts inflowGroup).
 *    options = 유입경로 항목 목록 (없으면 기본 5개)
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

/** 기본 표시 순서 (항목 5개 + 미확인 + 확인 필요 + 미입력). 실제 화면은 inflowOrderFor 사용 */
export const INFLOW_ROWS: readonly string[] = inflowGroupOrder(DEFAULT_INFLOW_OPTIONS);

/** 이 판매들에 맞는 표시 순서 (비활성 항목·기존값은 판매가 있을 때만) */
export function inflowOrderFor(sales: readonly SheetSale[], options: readonly InflowOption[] = DEFAULT_INFLOW_OPTIONS): string[] {
  return inflowGroupOrder(options, new Set(sales.map((s) => inflowOf(s, options))));
}

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

export function inflowRows(sales: readonly SheetSale[], options: readonly InflowOption[] = DEFAULT_INFLOW_OPTIONS): InflowRow[] {
  const groups = groupBy(sales, (s) => inflowOf(s, options));
  return inflowOrderFor(sales, options).map((inflow) => {
    const list = groups.get(inflow) ?? [];
    return { inflow, sales: list.length, share: pct(list.length, sales.length), metrics: countMetrics(list), budget: budgetTotals(list) };
  });
}

export interface InputRate {
  total: number;
  /** 유입경로가 저장된 판매 ("미확인" 포함, 원문만 있는 확인 필요 제외) */
  entered: number;
  missing: number;
  /** 입력률(%) */
  rate: number;
  unknown: number;
  /** 원문만 있고 항목을 못 찾은 판매 */
  check: number;
}
export function inflowInputRate(sales: readonly SheetSale[], options: readonly InflowOption[] = DEFAULT_INFLOW_OPTIONS): InputRate {
  const group = sales.map((s) => inflowOf(s, options));
  const missing = group.filter((g) => g === INFLOW_MISSING).length;
  const check = group.filter((g) => g === "확인 필요").length;
  const unknown = group.filter((g) => g === INFLOW_UNKNOWN).length;
  const entered = sales.length - missing - check;
  return { total: sales.length, entered, missing, rate: pct(entered, sales.length), unknown, check };
}

/** 행(예: 직원) × 유입경로 판매 건수 */
export function crossCount(
  sales: readonly SheetSale[],
  rowOf: (s: SheetSale) => string,
  options: readonly InflowOption[] = DEFAULT_INFLOW_OPTIONS,
): { rows: string[]; cells: Map<string, Map<string, number>> } {
  const cells = new Map<string, Map<string, number>>();
  for (const s of sales) {
    const r = rowOf(s);
    const i = inflowOf(s, options);
    if (!cells.has(r)) cells.set(r, new Map());
    const row = cells.get(r)!;
    row.set(i, (row.get(i) ?? 0) + 1);
  }
  return { rows: [...cells.keys()].sort((a, b) => a.localeCompare(b, "ko")), cells };
}

/** 지표 × 유입경로: 그 지표에 해당하는 판매만 유입경로별로 셈 (지표끼리 더하지 않음) */
export function metricByInflow(sales: readonly SheetSale[], options: readonly InflowOption[] = DEFAULT_INFLOW_OPTIONS): Map<ProductMetricKey, Map<string, number>> {
  const out = new Map<ProductMetricKey, Map<string, number>>();
  for (const key of PRODUCT_METRIC_KEYS) out.set(key, new Map());
  for (const s of sales) {
    const m = saleMetrics(s);
    const i = inflowOf(s, options);
    for (const key of PRODUCT_METRIC_KEYS) {
      if (!metricHit(m, key)) continue;
      const row = out.get(key)!;
      row.set(i, (row.get(i) ?? 0) + 1);
    }
  }
  return out;
}

export interface CampaignRow {
  /** 묶음 키: 캠페인ID 또는 "원문:<원문>" */
  key: string;
  /** 캠페인명 (연결됨) 또는 보고 원문 (확인 필요) */
  campaign: string;
  state: "linked" | "check";
  sales: number;
  inflows: Map<string, number>;
}

/** 캠페인별 판매 건수 (캠페인 없는 판매 제외). 연결된 판매는 캠페인ID 로, 목록에 없는 원문은 원문별로 (확인 필요) */
export function campaignRows(
  sales: readonly SheetSale[],
  campaigns: readonly Campaign[] = [],
  options: readonly InflowOption[] = DEFAULT_INFLOW_OPTIONS,
): CampaignRow[] {
  const out = new Map<string, CampaignRow & { list: SheetSale[] }>();
  for (const s of sales) {
    const c = campaignOfLink(s.link, campaigns);
    if (c.state === "none") continue;
    const key = c.state === "linked" ? c.id : `원문:${c.raw}`;
    if (!out.has(key)) out.set(key, { key, campaign: c.state === "linked" ? c.name : c.raw, state: c.state, sales: 0, inflows: new Map(), list: [] });
    out.get(key)!.list.push(s);
  }
  return [...out.values()]
    .map(({ list, ...row }) => ({ ...row, sales: list.length, inflows: groupCount(list, (x) => inflowOf(x, options)) }))
    .sort((a, b) => (a.state === b.state ? 0 : a.state === "linked" ? -1 : 1) || b.sales - a.sales || a.campaign.localeCompare(b.campaign, "ko"));
}

/* ---------- 캠페인 ---------- */

export interface CampaignFilter {
  /** 캠페인ID, 또는 "원문:<원문>" (확인 필요 묶음) */
  campaign: string;
  start?: string;
  end?: string;
  staff?: string;
  inflow?: string;
  category?: string;
  model?: string;
}

/** 판매 1건의 캠페인 묶음 키 (캠페인 없음이면 "") */
export function campaignKeyOf(sale: SheetSale, campaigns: readonly Campaign[]): string {
  const c = campaignOfLink(sale.link, campaigns);
  return c.state === "linked" ? c.id : c.state === "check" ? `원문:${c.raw}` : "";
}

/** 캠페인 고객 조회 필터 (모든 조건 AND, 빈 조건은 무시) */
export function filterCampaignSales(
  sales: readonly SheetSale[],
  f: CampaignFilter,
  campaigns: readonly Campaign[],
  options: readonly InflowOption[] = DEFAULT_INFLOW_OPTIONS,
): SheetSale[] {
  return sales.filter((s) => {
    if (!f.campaign || campaignKeyOf(s, campaigns) !== f.campaign) return false;
    if (f.start && !(s.activatedAt >= f.start)) return false;
    if (f.end && !(s.activatedAt <= f.end)) return false;
    if (f.staff && (s.staff || "(직원명 없음)") !== f.staff) return false;
    if (f.inflow && inflowOf(s, options) !== f.inflow) return false;
    if (f.category && (s.category || "").trim() !== f.category) return false;
    if (f.model && !(s.model || "").toLowerCase().includes(f.model.trim().toLowerCase())) return false;
    return true;
  });
}

export interface CampaignSummary {
  sales: number;
  metrics: MetricCounts;
  budget: BudgetTotals;
  byStaff: { staff: string; sales: number; postpaid: number }[];
  byInflow: { inflow: string; sales: number }[];
  /** 리본 판정 불가(원본 없음) 판매 수 */
  ribbonUnknown: number;
}

/** 캠페인 판매 집계 (지표는 공용 기준, 예산은 직원 실적관리와 같은 합계) */
export function campaignSummary(sales: readonly SheetSale[], options: readonly InflowOption[] = DEFAULT_INFLOW_OPTIONS): CampaignSummary {
  const staffGroups = groupBy(sales, (s) => s.staff || "(직원명 없음)");
  const inflowCounts = groupCount(sales, (s) => inflowOf(s, options));
  return {
    sales: sales.length,
    metrics: countMetrics(sales),
    budget: budgetTotals(sales),
    byStaff: [...staffGroups.entries()]
      .map(([staff, list]) => ({ staff, sales: list.length, postpaid: countMetrics(list).postpaid }))
      .sort((a, b) => b.sales - a.sales || a.staff.localeCompare(b.staff, "ko")),
    byInflow: inflowOrderFor(sales, options)
      .filter((i) => (inflowCounts.get(i) ?? 0) > 0)
      .map((inflow) => ({ inflow, sales: inflowCounts.get(inflow) ?? 0 })),
    ribbonUnknown: sales.filter((s) => ribbonOf(s).value === "판정불가").length,
  };
}

export function groupCount<T>(items: readonly T[], keyOf: (t: T) => string): Map<string, number> {
  const m = new Map<string, number>();
  for (const t of items) m.set(keyOf(t), (m.get(keyOf(t)) ?? 0) + 1);
  return m;
}

/** 주별 추이: 월요일 시작 주마다 유입경로별 판매 건수 */
export function weeklyInflowTrend(
  sales: readonly SheetSale[],
  options: readonly InflowOption[] = DEFAULT_INFLOW_OPTIONS,
): { week: string; total: number; inflows: Map<string, number> }[] {
  const dated = sales.filter((s) => /^\d{4}-\d{2}-\d{2}$/.test(s.activatedAt));
  const groups = groupBy(dated, (s) => weekStart(s.activatedAt));
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([week, list]) => ({ week, total: list.length, inflows: groupCount(list, (x) => inflowOf(x, options)) }));
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
