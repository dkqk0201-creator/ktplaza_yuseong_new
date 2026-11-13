import { PRODUCT_METRIC_KEYS, isProductMetricKey, type ProductMetricKey } from "@/lib/product-metrics";

/*
 * 월 목표 (매장 · 직원, 지표별). 저장은 Apps Script goal-handler.gs:
 *   - 매장 후불: 스크립트 속성 WIRELESS_GOAL_YYYY-MM (예산관리 화면과 같은 값 하나)
 *   - 그 밖: 숨김 보조 시트 "웹앱목표" (연월·대상·직원ID·지표 하나에 한 줄), 변경 이력 "웹앱목표이력"
 * 목표 값: 숫자(0 포함) 또는 null(미설정). 0 과 미설정은 다르다 (미설정은 달성률을 계산하지 않음).
 * 매장 목표와 직원 목표 합계는 다를 수 있다 — 각각 따로 보관하고 따로 비교한다.
 */

export type GoalScope = "store" | "staff";

export interface GoalItem {
  scope: GoalScope;
  /** 직원 ID (매장이면 "") */
  staffId: string;
  /** 저장 당시 직원명 (참고) */
  staffName: string;
  metric: ProductMetricKey;
  value: number;
}

export interface GoalHistoryItem {
  at: string;
  scope: GoalScope;
  staffId: string;
  metric: string;
  before: number | null;
  after: number | null;
  by: string;
}

/** 저장 요청 1건: before 는 화면에서 본 값 (다른 곳에서 바뀌었으면 저장 거부) */
export interface GoalChange {
  scope: GoalScope;
  staffId: string;
  staffName: string;
  metric: ProductMetricKey;
  before: number | null;
  value: number | null;
}

export const GOAL_MAX = 100000;

export function goalKey(scope: GoalScope, staffId: string, metric: ProductMetricKey): string {
  return `${scope}|${scope === "store" ? "" : staffId}|${metric}`;
}

/** 목표 목록 → 키별 값 */
export function goalMap(items: readonly GoalItem[]): Map<string, number> {
  return new Map(items.map((g) => [goalKey(g.scope, g.staffId, g.metric), g.value]));
}

/** 입력칸 글자 → 목표 (빈칸 = 미설정 null, 0 이상 정수만). 잘못된 값은 undefined */
export function parseGoalInput(text: string): number | null | undefined {
  const t = text.replace(/[,\s]/g, "");
  if (t === "") return null;
  if (!/^\d+$/.test(t)) return undefined;
  const n = Number(t);
  return n <= GOAL_MAX ? n : undefined;
}

export interface Achievement {
  goal: number | null;
  actual: number;
  /** 달성률(%) — 목표 미설정이면 null, 목표 0 이면 실적 0 → 100 / 실적 있음 → null(계산 불가, "목표 0") */
  rate: number | null;
  /** 남은 목표 (0 미만이면 0) — 미설정이면 null */
  remaining: number | null;
}

export function achievement(goal: number | null, actual: number): Achievement {
  if (goal === null) return { goal, actual, rate: null, remaining: null };
  const remaining = Math.max(0, goal - actual);
  if (goal === 0) return { goal, actual, rate: actual === 0 ? 100 : null, remaining };
  return { goal, actual, rate: Math.round((actual / goal) * 1000) / 10, remaining };
}

/** 서버 응답 목표 1건 검사 */
export function parseGoalItem(raw: unknown): GoalItem | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const scope = r.scope === "store" || r.scope === "staff" ? r.scope : null;
  const value = Number(r.value);
  if (!scope || !isProductMetricKey(r.metric) || !Number.isInteger(value) || value < 0 || value > GOAL_MAX) return null;
  const staffId = typeof r.staffId === "string" ? r.staffId : "";
  if (scope === "staff" && !/^st-\d{3}$/.test(staffId)) return null;
  return {
    scope,
    staffId: scope === "staff" ? staffId : "",
    staffName: typeof r.staffName === "string" ? r.staffName.slice(0, 20) : "",
    metric: r.metric,
    value,
  };
}

/** 저장 요청 1건 검사 */
export function parseGoalChange(raw: unknown): GoalChange | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const scope = r.scope === "store" || r.scope === "staff" ? r.scope : null;
  const num = (v: unknown): number | null | undefined =>
    v === null ? null : typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= GOAL_MAX ? v : undefined;
  const before = num(r.before);
  const value = num(r.value);
  const staffId = typeof r.staffId === "string" ? r.staffId : "";
  const staffName = typeof r.staffName === "string" ? r.staffName.trim().slice(0, 20) : "";
  if (!scope || !isProductMetricKey(r.metric) || before === undefined || value === undefined) return null;
  if (scope === "staff" ? !/^st-\d{3}$/.test(staffId) : staffId !== "") return null;
  return { scope, staffId, staffName: scope === "staff" ? staffName : "", metric: r.metric, before, value };
}

export { PRODUCT_METRIC_KEYS };
