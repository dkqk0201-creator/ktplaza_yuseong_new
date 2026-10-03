import {
  COLUMN_INDEX,
  COLUMN_LABEL,
  COLUMN_LETTER,
  SHEET_COLUMNS,
  type ColumnKey,
} from "@/lib/sheet-columns";
import { AMOUNT_KEYS, type SheetSale } from "@/lib/sheet-record";
import { amountOf } from "@/lib/quick-report";

/*
 * 검수관리 "판매 수정": 기존 판매 1건의 값 고치기 (화면·서버 공용 규칙).
 * - B열 No.·C열 개통일은 고칠 수 없다.
 * - 바뀐 칸만 보낸다. before = 화면에서 본 값(장표와 대조용), after = 새 값.
 */

export const LOCKED_KEYS = ["no", "activatedAt"] as const;
const LOCKED = new Set<ColumnKey>(LOCKED_KEYS);
const AMOUNTS = new Set<string>(AMOUNT_KEYS);

/** 고칠 수 있는 칸 (A, D~AL) */
export const EDITABLE_KEYS: ColumnKey[] = SHEET_COLUMNS.map(
  (c) => c.key,
).filter((key) => !LOCKED.has(key));

export function isAmountKey(key: ColumnKey): boolean {
  return AMOUNTS.has(key);
}

/** 입력창에 처음 보여줄 값 (= 장표 대조용 before) */
export function editText(sale: SheetSale, key: ColumnKey): string {
  const value = (sale as Record<string, unknown>)[key];
  if (value === null || value === undefined) return "";
  return String(value);
}

/** 금액 입력값 → 숫자 (빈칸은 null, 숫자가 아니면 undefined) */
export function parseEditAmount(text: string): number | null | undefined {
  const t = text.replace(/[\s,]/g, "").replace(/원$/, "");
  if (t === "") return null;
  return /^-?\d+$/.test(t) ? Number(t) : undefined;
}

export interface SaleChange {
  key: ColumnKey;
  before: string;
  after: string;
  /** 규칙으로 자동으로 바뀌는 칸 (화면 안내용) */
  auto?: boolean;
  /** 자동 변경 이유 (없으면 "카드 종류 변경으로 자동") */
  autoNote?: string;
}

/**
 * 쓰지는 않고 장표 현재 값이 before 와 같은지만 확인하는 칸.
 * AB·AC 계산에 쓴 N·U·Z·AA 중 이번에 바꾸지 않는 칸을
 * 그사이 다른 사람이 고쳤다면 Apps Script 가 수정을 거부한다.
 */
export interface SaleCheck {
  key: ColumnKey;
  before: string;
}

/** 카드사명이 아닌 값 (X·빈칸·"-") */
function isCardName(value: string): boolean {
  const v = value.trim().toUpperCase();
  return v !== "" && v !== "X" && v !== "-";
}

/**
 * 제휴카드 규칙: 카드 종류(AF)를 카드사명으로 새로 입력하거나 바꾸면
 *   AE 제카 = "O", AF = 입력한 카드사명, AG 카드실적 검수(등록) = 빈칸 (다시 검수받도록)
 * 카드 종류를 바꾸지 않은 수정에서는 AE/AF/AG 를 건드리지 않는다.
 */
function applyCardRule(sale: SheetSale, changes: SaleChange[]): SaleChange[] {
  const card = changes.find((c) => c.key === "cardType");
  if (!card || !isCardName(card.after)) return changes;
  const rest = changes.filter(
    (c) => c.key !== "jeca" && c.key !== "cardChecked",
  );
  const auto: SaleChange[] = [];
  const jecaBefore = editText(sale, "jeca");
  if (jecaBefore.trim() !== "O") {
    auto.push({ key: "jeca", before: jecaBefore, after: "O", auto: true });
  }
  const checkedBefore = editText(sale, "cardChecked");
  if (checkedBefore.trim() !== "") {
    auto.push({
      key: "cardChecked",
      before: checkedBefore,
      after: "",
      auto: true,
    });
  }
  return [...rest, ...auto];
}

/** 원래 값과 입력값을 비교해 바뀐 칸만 (금액은 숫자로 비교) */
export function diffSale(
  sale: SheetSale,
  edited: Partial<Record<ColumnKey, string>>,
): SaleChange[] {
  const changes: SaleChange[] = [];
  for (const key of EDITABLE_KEYS) {
    if (!(key in edited)) continue;
    const before = editText(sale, key);
    const after = (edited[key] ?? "").trim();
    if (isAmountKey(key)) {
      const a = parseEditAmount(after);
      const b = parseEditAmount(before);
      if (a !== undefined && a === b) continue;
    } else if (after === before.trim()) {
      continue;
    }
    changes.push({ key, before, after });
  }
  return applyUsedPhoneRule(sale, applyCardRule(sale, changes));
}

/* ---------- 중고판매 AB·AC 재계산 (간편등록과 같은 규칙) ---------- */

/** 재계산에 쓰이는 칸 N·U·Z·AA 와 결과 칸 AB·AC */
export const USED_PHONE_RECALC_KEYS = [
  "securedTotal", // N
  "usedTotal", // U
  "usedPhoneSale", // Z
  "usedPhoneUsed", // AA
  "usedPhoneRemaining", // AB
  "finalTotal", // AC
] as const satisfies readonly ColumnKey[];

const USED_PHONE_NOTE = "AB=Z−AA, AC=N+U+AB 자동 계산";

/**
 * AB = Z − AA,  AC = N + U + AB
 * "-"·빈칸·숫자가 아닌 값은 계산할 때만 0 (간편등록 applyQuickColumnRules 와 같은 amountOf).
 * AB 가 음수여도 0 으로 바꾸지 않는다.
 */
export function calcUsedPhone(values: {
  securedTotal: string;
  usedTotal: string;
  usedPhoneSale: string;
  usedPhoneUsed: string;
}): { usedPhoneRemaining: number; finalTotal: number } {
  const remaining =
    amountOf(values.usedPhoneSale) - amountOf(values.usedPhoneUsed);
  return {
    usedPhoneRemaining: remaining,
    finalTotal:
      amountOf(values.securedTotal) + amountOf(values.usedTotal) + remaining,
  };
}

type RecalcKey = (typeof USED_PHONE_RECALC_KEYS)[number];
/** AB·AC 계산 기준값: N·U·Z·AA·AB·AC 의 장표 값 (화면에서 본 값 또는 서버가 방금 읽은 값) */
export type RecalcBase = Record<RecalcKey, string>;

/** 금액 비교용: "-"·빈칸·숫자가 아님 → null */
function baseAmount(text: string): number | null {
  const t = text.replace(/[\s,]/g, "").replace(/원$/, "");
  return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : null;
}

export interface UsedPhonePlan {
  /** 써야 하는 AB·AC (before = 기준값, after = 계산값) */
  writes: {
    key: "usedPhoneRemaining" | "finalTotal";
    before: string;
    after: number;
  }[];
  /** 쓰지 않고 대조만 하는 N·U·Z·AA */
  checks: SaleCheck[];
}

/**
 * 판매 수정 1건의 AB·AC 처리 계획 (화면 표시와 서버 저장이 같은 함수를 쓴다).
 *   - 최종값 = 이번에 바꾸는 칸은 새 값, 나머지는 base(장표 값)
 *   - AB = Z − AA, AC = N + U + AB ("-"·빈칸은 계산 시에만 0, 음수 그대로)
 *   - AB·AC 가 base 와 다르면 쓴다 → 이미 틀어져 있던 AB·AC 도 바로잡는다 (거부하지 않음)
 *   - AB·AC 를 쓸 때만, 계산에 쓴 N·U·Z·AA 중 이번에 바꾸지 않는 칸을 checks 로 보내
 *     그사이 다른 사람이 고쳤는지 Apps Script 가 대조하게 한다.
 *   - AB·AC 가 이미 맞으면 아무것도 추가하지 않는다 (일반 수정은 기존과 동일).
 * changes 에 AB·AC 가 있어도 무시한다 (AB·AC 는 항상 계산값).
 */
export function planUsedPhoneRecalc(
  changes: readonly { key: ColumnKey; after: string }[],
  base: RecalcBase,
): UsedPhonePlan {
  const changed = new Map<ColumnKey, string>();
  for (const c of changes) {
    if (c.key !== "usedPhoneRemaining" && c.key !== "finalTotal") {
      changed.set(c.key, c.after);
    }
  }
  const final = (key: RecalcKey) => changed.get(key) ?? base[key];
  const result = calcUsedPhone({
    securedTotal: final("securedTotal"),
    usedTotal: final("usedTotal"),
    usedPhoneSale: final("usedPhoneSale"),
    usedPhoneUsed: final("usedPhoneUsed"),
  });
  const writes: UsedPhonePlan["writes"] = [];
  for (const key of ["usedPhoneRemaining", "finalTotal"] as const) {
    if (baseAmount(base[key]) !== result[key]) {
      writes.push({ key, before: base[key], after: result[key] });
    }
  }
  const inputs = [
    "securedTotal",
    "usedTotal",
    "usedPhoneSale",
    "usedPhoneUsed",
  ] as const;
  const checks: SaleCheck[] =
    writes.length === 0
      ? []
      : inputs
          .filter((key) => !changed.has(key))
          .map((key) => ({ key, before: base[key] }));
  return { writes, checks };
}

/** 화면에서 본 N·U·Z·AA·AB·AC (판매 수정 요청과 함께 보내 서버 계산 기준으로 쓴다) */
export function saleRecalcBase(sale: SheetSale): RecalcBase {
  return Object.fromEntries(
    USED_PHONE_RECALC_KEYS.map((key) => [key, editText(sale, key)]),
  ) as RecalcBase;
}

/** 화면 표시용: 바꾼 칸 + AB·AC 자동 변경 (서버가 같은 planUsedPhoneRecalc 로 다시 계산해 저장) */
function applyUsedPhoneRule(
  sale: SheetSale,
  changes: SaleChange[],
): SaleChange[] {
  const rest = changes.filter(
    (c) => c.key !== "usedPhoneRemaining" && c.key !== "finalTotal",
  );
  const plan = planUsedPhoneRecalc(rest, saleRecalcBase(sale));
  return [
    ...rest,
    ...plan.writes.map((w) => ({
      key: w.key,
      before: w.before,
      after: String(w.after),
      auto: true,
      autoNote: USED_PHONE_NOTE,
    })),
  ];
}

/** 금액 칸에 숫자가 아닌 값이 있으면 오류 문구 */
export function validateEdits(
  changes: SaleChange[],
): Partial<Record<ColumnKey, string>> {
  const errors: Partial<Record<ColumnKey, string>> = {};
  for (const { key, after } of changes) {
    if (isAmountKey(key) && parseEditAmount(after) === undefined) {
      errors[key] = "금액은 숫자로 입력해 주세요. (예: 150000)";
    } else if (after.length > 500) {
      errors[key] = "500자 이내로 입력해 주세요.";
    }
  }
  return errors;
}

export function changeLabel(key: ColumnKey): string {
  return `${COLUMN_LABEL[key]} (${COLUMN_LETTER[key]}열)`;
}

export function columnIndexOf(key: ColumnKey): number {
  return COLUMN_INDEX[key];
}
