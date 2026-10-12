import type { SheetSale } from "@/lib/sheet-record";

/*
 * 고객혜택 사용금액 저장 규칙 (최종 확정)
 *   V열(모델/요금) = 정책사용 → 고혜(요금) + 정책사용 → 고혜(기존할부금)  (두 금액의 합계만 장표에 저장)
 *   W열(추가지원금) = 정책사용 → 추가지원금 단독 (다른 금액을 절대 더하지 않음)
 *   U열 = 장표 수식 =SUM(V:Y) 그대로 (V 합계가 한 번만 들어감)
 * - V열 두 금액의 세부 내역은 웹앱참고(판매 건별 참고내용)에 vPlan·vInstallment 로 따로 보관 (숫자 글자).
 * - 세부 내역이 없는 판매는 V열 값을 임의로 나누지 않는다 ("세부 없음").
 * - 구글시트에서 V열을 직접 고쳐 세부 합계와 달라지면 "불일치" 로 표시한다 (자동으로 고치지 않음).
 *
 * 이전에 잘못 적용했던 규칙(W열 = 추가지원금 + 고혜(기존할부금), 세부 wExtraSupport·wInstallment)은 없앴다.
 * 그 규칙으로 저장된 판매는 세부 내역에 wInstallment 가 남아 있으므로 "이전 규칙 의심" 으로만 알려 주고,
 * 금액을 옮기거나 고치지 않는다 (예전 세부 기록도 지우지 않음).
 */

export const V_PLAN = "vPlan";
export const V_INSTALLMENT = "vInstallment";
export const V_PART_KEYS = [V_PLAN, V_INSTALLMENT] as const;
export type VPartKey = (typeof V_PART_KEYS)[number];

/** 이전(잘못된) W열 합산 규칙의 세부 키 — 읽기만 (의심 건 확인용), 새로 쓰지 않음 */
export const OLD_W_EXTRA = "wExtraSupport";
export const OLD_W_INSTALLMENT = "wInstallment";

export type VSplitStatus = "ok" | "none" | "mismatch";

export interface VSplit {
  status: VSplitStatus;
  /** V열 금액 (빈칸·"-" 는 0) */
  v: number;
  plan: number | null;
  installment: number | null;
  /** 세부 합계 (세부 없음이면 null) */
  detailSum: number | null;
}

function storedAmount(sale: Pick<SheetSale, "notes">, key: string): number | null {
  const raw = sale.notes?.[key];
  if (raw === undefined) return null;
  const t = raw.replace(/[\s,]/g, "");
  return /^-?\d+$/.test(t) ? Number(t) : null;
}

export function vSplitOf(sale: Pick<SheetSale, "notes" | "usedModelPlan">): VSplit {
  const v = sale.usedModelPlan ?? 0;
  const plan = storedAmount(sale, V_PLAN);
  const installment = storedAmount(sale, V_INSTALLMENT);
  if (plan === null && installment === null) {
    return { status: "none", v, plan, installment, detailSum: null };
  }
  const detailSum = (plan ?? 0) + (installment ?? 0);
  return { status: detailSum === v ? "ok" : "mismatch", v, plan, installment, detailSum };
}

/**
 * 이전 잘못된 규칙(W열에 고혜(기존할부금) 합산)으로 입력된 금액이 현재 W열에 실제로 남아 있는 판매.
 * - 세부 기록에 고혜(기존할부금)(wInstallment)이 0 이 아닌 금액으로 있고,
 * - 현재 W열 = 이전 규칙 합계(추가지원금 wExtraSupport(없으면 0) + wInstallment) 그대로일 때만 의심 건.
 * W열을 이미 바로잡은 판매(W열이 이전 합계와 다름 — 빈칸·0·정상 추가지원금)는 과거 기록이 남아 있어도 경고하지 않는다.
 * 예산관리·판매 상세·판매 수정 화면이 모두 이 함수 하나로 판별한다. 금액·기록은 고치지 않는다.
 */
export function oldWRuleSuspect(
  sale: Pick<SheetSale, "notes" | "usedExtraSupport">,
): { installment: number; extra: number | null; w: number } | null {
  const installment = storedAmount(sale, OLD_W_INSTALLMENT);
  if (installment === null || installment === 0) return null;
  const extra = storedAmount(sale, OLD_W_EXTRA);
  const w = sale.usedExtraSupport ?? 0;
  if (w !== (extra ?? 0) + installment) return null;
  return { installment, extra, w };
}

/** 금액 입력 → 숫자 (빈칸 null, 숫자가 아니면 undefined). 쉼표·"원" 허용 */
export function parseVPart(text: string): number | null | undefined {
  const t = text.replace(/[\s,]/g, "").replace(/원$/, "");
  if (t === "" || t === "-") return null;
  return /^\d+$/.test(t) ? Number(t) : undefined;
}

/** 판매 수정 화면 처음 값: 보관된 세부 금액 (세부 없음이면 빈칸 — V열을 임의로 나누지 않음) */
export function vPartPrefill(sale: Pick<SheetSale, "notes">, key: VPartKey): string {
  const v = storedAmount(sale, key);
  return v === null ? "" : String(v);
}

export interface VSplitEdit {
  plan?: string;
  installment?: string;
}

export interface VSplitPlan {
  /** 새 V열 값 (입력칸을 건드렸을 때만). 판매 수정 diff 에 V열 입력값으로 넣는다 */
  vAfter?: string;
  notes: { field: VPartKey; before: string; after: string }[];
  errors: Partial<Record<VPartKey, string>>;
  /** 화면 안내용: 입력값 기준 V열 합계 */
  preview: number | null;
}

/**
 * 판매 수정: 고혜(요금)·고혜(기존할부금) 입력 → V열 합계 + 세부 내역 변경.
 * 두 칸 중 하나라도 건드리면 V열 = 두 입력 금액의 합 (빈칸은 0). 둘 다 빈칸이면 V열 빈칸.
 * 손대지 않았으면 아무것도 바꾸지 않는다 (W열은 이 계산과 무관).
 */
export function planVSplit(sale: Pick<SheetSale, "notes" | "usedModelPlan">, edit: VSplitEdit): VSplitPlan {
  const errors: VSplitPlan["errors"] = {};
  if (edit.plan === undefined && edit.installment === undefined) {
    return { notes: [], errors, preview: null };
  }
  const texts: Record<VPartKey, string> = {
    [V_PLAN]: edit.plan ?? vPartPrefill(sale, V_PLAN),
    [V_INSTALLMENT]: edit.installment ?? vPartPrefill(sale, V_INSTALLMENT),
  };
  const values: Partial<Record<VPartKey, number | null>> = {};
  for (const key of V_PART_KEYS) {
    const v = parseVPart(texts[key]);
    if (v === undefined) errors[key] = "금액은 숫자로 입력해 주세요. (예: 30000)";
    else values[key] = v;
  }
  if (Object.keys(errors).length > 0) return { notes: [], errors, preview: null };
  const plan = values[V_PLAN] ?? null;
  const installment = values[V_INSTALLMENT] ?? null;
  const both = plan === null && installment === null;
  const sum = (plan ?? 0) + (installment ?? 0);
  const notes: VSplitPlan["notes"] = [];
  for (const [key, v] of [
    [V_PLAN, plan],
    [V_INSTALLMENT, installment],
  ] as const) {
    const before = vPartPrefill(sale, key);
    const after = v === null ? "" : String(v);
    if (before !== after) notes.push({ field: key, before, after });
  }
  return { vAfter: both ? "" : String(sum), notes, errors, preview: both ? null : sum };
}

/** 간편등록: 고혜(요금)·고혜(기존할부금) → V열 값 + 세부 내역 (입력한 금액만 보관) */
export function quickVSplit(
  plan: number | null,
  installment: number | null,
): { v: number | null; notes: Partial<Record<VPartKey, string>> } {
  const notes: Partial<Record<VPartKey, string>> = {};
  if (plan !== null) notes[V_PLAN] = String(plan);
  if (installment !== null) notes[V_INSTALLMENT] = String(installment);
  if (plan === null && installment === null) return { v: null, notes };
  return { v: (plan ?? 0) + (installment ?? 0), notes };
}

/** 월 판매 중 V열과 세부 합계가 다른 판매 */
export function vMismatches(sales: readonly SheetSale[]): { sale: SheetSale; split: VSplit }[] {
  return sales
    .map((sale) => ({ sale, split: vSplitOf(sale) }))
    .filter((x) => x.split.status === "mismatch");
}

/** 월 판매 중 이전 잘못된 W열 합산 규칙 의심 건 */
export function oldWRuleSuspects(
  sales: readonly SheetSale[],
): { sale: SheetSale; suspect: NonNullable<ReturnType<typeof oldWRuleSuspect>> }[] {
  return sales.flatMap((sale) => {
    const suspect = oldWRuleSuspect(sale);
    return suspect ? [{ sale, suspect }] : [];
  });
}

export function wonText(n: number): string {
  return `${n.toLocaleString("ko-KR")}원`;
}
