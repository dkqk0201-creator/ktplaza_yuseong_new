import type { SheetSale } from "@/lib/sheet-record";

/*
 * W열(추가지원금) = 정책사용 → 추가지원금 + 정책사용 → 고혜(기존할부금)  (두 금액의 합계만 장표에 저장)
 * - 두 금액의 세부 내역은 웹앱참고(판매 건별 참고내용)에 wExtraSupport·wInstallment 로 따로 보관한다 (숫자 글자).
 * - 세부 내역이 없는 예전 판매는 W열 값을 임의로 나누지 않는다 ("세부 없음").
 * - 구글시트에서 W열을 직접 고쳐 세부 합계와 달라지면 "불일치" 로 표시한다 (어느 쪽도 자동으로 고치지 않음).
 * - U열(=SUM(V:Y))은 장표 수식이 W열 합계를 한 번만 더한다.
 */

export const W_EXTRA = "wExtraSupport";
export const W_INSTALLMENT = "wInstallment";
export const W_PART_KEYS = [W_EXTRA, W_INSTALLMENT] as const;
export type WPartKey = (typeof W_PART_KEYS)[number];

export type WSplitStatus =
  /** 세부 내역이 있고 W열과 같음 */
  | "ok"
  /** 세부 내역이 없음 (예전 판매 등) — 나누지 않음 */
  | "none"
  /** 세부 합계 ≠ W열 (구글시트에서 직접 수정 등) */
  | "mismatch";

export interface WSplit {
  status: WSplitStatus;
  /** W열 금액 (빈칸·"-" 는 0) */
  w: number;
  /** 보관된 세부 금액 (없으면 null) */
  extra: number | null;
  installment: number | null;
  /** 세부 합계 (세부 없음이면 null) */
  detailSum: number | null;
}

/** 보관 값(숫자 글자) → 금액. 없거나 숫자가 아니면 null */
function stored(sale: Pick<SheetSale, "notes">, key: WPartKey): number | null {
  const raw = sale.notes?.[key];
  if (raw === undefined) return null;
  const t = raw.replace(/[\s,]/g, "");
  return /^-?\d+$/.test(t) ? Number(t) : null;
}

export function wSplitOf(sale: Pick<SheetSale, "notes" | "usedExtraSupport">): WSplit {
  const w = sale.usedExtraSupport ?? 0;
  const extra = stored(sale, W_EXTRA);
  const installment = stored(sale, W_INSTALLMENT);
  if (extra === null && installment === null) {
    return { status: "none", w, extra, installment, detailSum: null };
  }
  const detailSum = (extra ?? 0) + (installment ?? 0);
  return {
    status: detailSum === w ? "ok" : "mismatch",
    w,
    extra,
    installment,
    detailSum,
  };
}

/** 금액 입력 → 숫자 (빈칸 null, 숫자가 아니면 undefined). 쉼표·"원" 허용 */
export function parseWPart(text: string): number | null | undefined {
  const t = text.replace(/[\s,]/g, "").replace(/원$/, "");
  if (t === "" || t === "-") return null;
  return /^\d+$/.test(t) ? Number(t) : undefined;
}

/** 판매 수정 화면 처음 값: 보관된 세부 금액 (세부 없음이면 빈칸 — W열을 임의로 나누지 않음) */
export function wPartPrefill(sale: Pick<SheetSale, "notes">, key: WPartKey): string {
  const v = stored(sale, key);
  return v === null ? "" : String(v);
}

export interface WSplitEdit {
  extra?: string;
  installment?: string;
}

export interface WSplitPlan {
  /** 새 W열 값 (입력칸을 건드렸을 때만). 판매 수정 diff 에 W열 입력값으로 넣는다 */
  wAfter?: string;
  /** 바뀐 세부 내역 (웹앱참고) */
  notes: { field: WPartKey; before: string; after: string }[];
  errors: Partial<Record<WPartKey, string>>;
  /** 화면 안내용: 입력값 기준 W열 합계 */
  preview: number | null;
}

/**
 * 판매 수정: 추가지원금·고혜(기존할부금) 입력 → W열 합계 + 세부 내역 변경.
 * 두 칸 중 하나라도 건드리면 W열 = 두 입력 금액의 합 (빈칸은 0). 둘 다 빈칸이면 W열 빈칸.
 * 손대지 않았으면 아무것도 바꾸지 않는다.
 */
export function planWSplit(sale: Pick<SheetSale, "notes" | "usedExtraSupport">, edit: WSplitEdit): WSplitPlan {
  const errors: WSplitPlan["errors"] = {};
  if (edit.extra === undefined && edit.installment === undefined) {
    return { notes: [], errors, preview: null };
  }
  const texts: Record<WPartKey, string> = {
    [W_EXTRA]: edit.extra ?? wPartPrefill(sale, W_EXTRA),
    [W_INSTALLMENT]: edit.installment ?? wPartPrefill(sale, W_INSTALLMENT),
  };
  const values: Partial<Record<WPartKey, number | null>> = {};
  for (const key of W_PART_KEYS) {
    const v = parseWPart(texts[key]);
    if (v === undefined) errors[key] = "금액은 숫자로 입력해 주세요. (예: 30000)";
    else values[key] = v;
  }
  if (Object.keys(errors).length > 0) return { notes: [], errors, preview: null };
  const extra = values[W_EXTRA] ?? null;
  const installment = values[W_INSTALLMENT] ?? null;
  const both = extra === null && installment === null;
  const sum = (extra ?? 0) + (installment ?? 0);
  const notes: WSplitPlan["notes"] = [];
  for (const [key, v] of [
    [W_EXTRA, extra],
    [W_INSTALLMENT, installment],
  ] as const) {
    const before = wPartPrefill(sale, key);
    const after = v === null ? "" : String(v);
    if (before !== after) notes.push({ field: key, before, after });
  }
  return { wAfter: both ? "" : String(sum), notes, errors, preview: both ? null : sum };
}

/** 간편등록: 두 금액 → W열 값 + 세부 내역 (입력한 금액만 보관) */
export function quickWSplit(
  extra: number | null,
  installment: number | null,
): { w: number | null; notes: Partial<Record<WPartKey, string>> } {
  const notes: Partial<Record<WPartKey, string>> = {};
  if (extra !== null) notes[W_EXTRA] = String(extra);
  if (installment !== null) notes[W_INSTALLMENT] = String(installment);
  if (extra === null && installment === null) return { w: null, notes };
  return { w: (extra ?? 0) + (installment ?? 0), notes };
}

/** 월 판매 중 W열과 세부 합계가 다른 판매 (예산관리 확인용) */
export function wMismatches(sales: readonly SheetSale[]): { sale: SheetSale; split: WSplit }[] {
  return sales
    .map((sale) => ({ sale, split: wSplitOf(sale) }))
    .filter((x) => x.split.status === "mismatch");
}

/** 표시용 */
export function wonText(n: number): string {
  return `${n.toLocaleString("ko-KR")}원`;
}

