/*
 * 예산관리 "기타 예산" (화면·서버 공용, 비밀값 없음).
 * 고객혜택과 별도로 점장이 직접 등록하는 확보(+)·차감(-) 예산.
 * 기록은 같은 스프레드시트의 별도 시트 "기타예산내역"(+ "기타예산변경이력")에만 저장한다 (Apps Script other-budget.gs).
 * 월별 무선장표(판매·N·U·AB·AC 수식)는 건드리지 않는다.
 *
 * 계산 (선택한 월, 삭제 제외):
 *   기타 예산 순증감 = 확보 합계 − 차감 합계
 *   최종 매장 총예산 = 기존 매장 총예산(고객혜택 잔여 + 스팟 + 고불비 차감 후 현금) + 기타 예산 순증감
 * 고객혜택 확보·사용·잔여, 추가지원금, 스팟예산, 현금예산, 고불비, 직원별 예산, AC열 검증에는 넣지 않는다.
 * AC열 검증은 기존 매장 총예산 기준 그대로 (최종 총예산과 AC열을 직접 비교하지 않는다).
 */

export const OTHER_BUDGET_SHEET = "기타예산내역";
export const OTHER_BUDGET_HISTORY_SHEET = "기타예산변경이력";
export const OTHER_BUDGET_HANDLER = "ws-other-budget";
export const OTHER_BUDGET_ENDPOINT = "/api/budget/other";
export const OTHER_NAME_MAX = 40;
export const OTHER_MEMO_MAX = 100;
export const OTHER_AMOUNT_MAX = 100_000_000;
export const OTHER_ID_RE = /^[A-Za-z0-9-]{8,64}$/;
export const OTHER_MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export type OtherKind = "gain" | "deduct";
export const OTHER_KIND_LABEL: Record<OtherKind, string> = { gain: "확보", deduct: "차감" };

export interface OtherBudgetItem {
  id: string;
  /** 적용 월 YYYY-MM */
  month: string;
  name: string;
  kind: OtherKind;
  /** 항상 양수. 부호는 kind 로 */
  amount: number;
  memo: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string;
}

export interface OtherBudgetMonth {
  month: string;
  items: OtherBudgetItem[];
  /** 삭제된 항목 (복구용) */
  deleted: OtherBudgetItem[];
  gain: number;
  deduct: number;
  net: number;
  invalidRows: number;
}

export interface OtherBudgetBefore {
  name: string;
  kind: OtherKind;
  amount: number;
  memo: string;
  updatedAt: string;
}

export interface OtherBudgetInput {
  name: string;
  kind: OtherKind;
  amount: number;
  memo: string;
}

export const otherBeforeOf = (i: OtherBudgetItem): OtherBudgetBefore => ({
  name: i.name,
  kind: i.kind,
  amount: i.amount,
  memo: i.memo,
  updatedAt: i.updatedAt,
});

export function signedAmount(i: Pick<OtherBudgetItem, "kind" | "amount">): number {
  return i.kind === "gain" ? i.amount : -i.amount;
}

export function otherTotals(items: readonly OtherBudgetItem[]) {
  let gain = 0;
  let deduct = 0;
  for (const i of items) {
    if (i.kind === "gain") gain += i.amount;
    else deduct += i.amount;
  }
  return { gain, deduct, net: gain - deduct };
}

/** 최종 매장 총예산 = 기존 매장 총예산 + 기타 예산 순증감 (기존 총예산은 그대로 두고 따로 더한다) */
export function applyOtherBudget(existingTotal: number, net: number) {
  return { existingTotal, net, finalTotal: existingTotal + net };
}

/** 입력 확인 (화면·서버 공통). 문제 없으면 null */
export function otherInputError(input: { name: unknown; kind: unknown; amount: unknown; memo: unknown }): string | null {
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (!name) return "예산 항목명을 입력해 주세요.";
  if (name.length > OTHER_NAME_MAX) return `항목명은 ${OTHER_NAME_MAX}자 이하로 입력해 주세요.`;
  if (/[\r\n\t]/.test(name)) return "항목명은 한 줄로 입력해 주세요.";
  if (input.kind !== "gain" && input.kind !== "deduct") return "구분(확보/차감)을 선택해 주세요.";
  const a = input.amount;
  if (typeof a !== "number" || !Number.isInteger(a) || a < 1 || a > OTHER_AMOUNT_MAX) {
    return `금액은 1원 이상 ${OTHER_AMOUNT_MAX.toLocaleString("ko-KR")}원 이하의 정수로 입력해 주세요.`;
  }
  const memo = typeof input.memo === "string" ? input.memo.trim() : "";
  if (typeof input.memo !== "string" && input.memo !== undefined) return "메모 형식이 올바르지 않습니다.";
  if (memo.length > OTHER_MEMO_MAX) return `메모는 ${OTHER_MEMO_MAX}자 이하로 입력해 주세요.`;
  if (/[\r\n\t]/.test(memo)) return "메모는 한 줄로 입력해 주세요.";
  return null;
}

/** "300,000" "30만" "300000원" → 원 (양수만). 해석 못 하면 null */
export function parseOtherAmount(text: string): number | null {
  const t = text.replace(/[\s,]/g, "").replace(/원$/, "");
  const man = /^(\d+(?:\.\d+)?)만$/.exec(t);
  if (man) {
    const v = Math.round(Number(man[1]) * 10000);
    return Number.isFinite(v) ? v : null;
  }
  return /^\d+$/.test(t) ? Number(t) : null;
}

export function newOtherBudgetId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return `o-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function str(v: unknown, max: number): string {
  return typeof v === "string" ? v.slice(0, max) : "";
}

/** Apps Script 응답의 항목 1건 (형식이 틀리면 null) */
export function parseOtherItem(v: unknown): OtherBudgetItem | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const id = str(o.id, 64);
  const month = str(o.month, 7);
  const kind = o.kind === "gain" || o.kind === "deduct" ? o.kind : null;
  const amount = typeof o.amount === "number" && Number.isInteger(o.amount) && o.amount >= 1 ? o.amount : null;
  if (!OTHER_ID_RE.test(id) || !OTHER_MONTH_RE.test(month) || !kind || amount === null) return null;
  return {
    id,
    month,
    name: str(o.name, OTHER_NAME_MAX + 20),
    kind,
    amount,
    memo: str(o.memo, OTHER_MEMO_MAX + 20),
    createdAt: str(o.createdAt, 30),
    updatedAt: str(o.updatedAt, 30),
    deletedAt: str(o.deletedAt, 30),
  };
}

export function sortOther(items: readonly OtherBudgetItem[]): OtherBudgetItem[] {
  return [...items].sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
}
