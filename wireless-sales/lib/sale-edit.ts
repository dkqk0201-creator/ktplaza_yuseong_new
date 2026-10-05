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
 * - N·U·AB·AC열은 장표의 같은 행 수식이라 직접 고치지 않는다 (웹앱은 이 4칸을 쓰지 않음):
 *     N = O+…+T, U = V+W+X+Y, AB = Z − AA, AC = N + U + AB  ("-"·빈칸은 0, 음수 그대로)
 *   O~T·V~Y·Z·AA 를 고치면 장표가 다시 계산하고, 화면에는 바뀔 값을 자동 항목으로 보여준다.
 * - 바뀐 칸만 보낸다. before = 화면에서 본 값(장표와 대조용), after = 새 값.
 */

export const LOCKED_KEYS = [
  "no",
  "activatedAt",
  "securedTotal", // N = SUM(O:T) 수식
  "usedTotal", // U = SUM(V:Y) 수식
  "usedPhoneRemaining", // AB = Z − AA 수식
  "finalTotal", // AC = N + U + AB 수식
] as const;

/** N·U·AB·AC열: 장표 행별 수식 칸 (직접 수정 불가, 화면 표시용 자동 항목) */
export const ROW_FORMULA_KEYS = [
  "securedTotal",
  "usedTotal",
  "usedPhoneRemaining",
  "finalTotal",
] as const;
export type RowFormulaKey = (typeof ROW_FORMULA_KEYS)[number];
const ROW_FORMULA_SET = new Set<string>(ROW_FORMULA_KEYS);
export function isRowFormulaKey(key: string): key is RowFormulaKey {
  return ROW_FORMULA_SET.has(key);
}

/** N = O+P+Q+R+S+T */
export const SECURED_PART_KEYS = [
  "spot",
  "securedDicho",
  "appleMania",
  "securedSecond",
  "modelPolicy",
  "customerBenefit",
] as const satisfies readonly ColumnKey[];
/** U = V+W+X+Y */
export const USED_PART_KEYS = [
  "usedModelPlan",
  "usedExtraSupport",
  "usedDicho",
  "usedSecond",
] as const satisfies readonly ColumnKey[];

/**
 * 장표 행별 수식이 계산할 N·U·AB·AC (수정 화면 입력값 기준, 장표 SUM·N 함수와 같게 "-"·빈칸·글자는 0)
 *   N = O+…+T, U = V+W+X+Y, AB = Z − AA, AC = N + U + AB
 */
export function rowFormulaValues(
  sale: SheetSale,
  edited: Partial<Record<ColumnKey, string>> = {},
): Record<RowFormulaKey, number> {
  const val = (k: ColumnKey) => amountOf(edited[k] ?? editText(sale, k));
  const sum = (keys: readonly ColumnKey[]) =>
    keys.reduce((t, k) => t + val(k), 0);
  const { usedPhoneRemaining, finalTotal } = calcUsedPhone({
    securedTotal: String(sum(SECURED_PART_KEYS)),
    usedTotal: String(sum(USED_PART_KEYS)),
    usedPhoneSale: edited.usedPhoneSale ?? editText(sale, "usedPhoneSale"),
    usedPhoneUsed: edited.usedPhoneUsed ?? editText(sale, "usedPhoneUsed"),
  });
  return {
    securedTotal: sum(SECURED_PART_KEYS),
    usedTotal: sum(USED_PART_KEYS),
    usedPhoneRemaining,
    finalTotal,
  };
}
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
  return applyRowFormulaRule(sale, applyCardRule(sale, changes));
}

export const ROW_FORMULA_NOTE: Record<RowFormulaKey, string> = {
  securedTotal: "O~T 합계 수식 자동",
  usedTotal: "V~Y 합계 수식 자동",
  usedPhoneRemaining: "Z−AA 수식 자동",
  finalTotal: "N+U+AB 수식 자동",
};

/* ---------- 행별 수식 칸 N·U·AB·AC (장표가 계산, 화면은 바뀔 값만 표시) ---------- */

/**
 * AB = Z − AA,  AC = N + U + AB
 * "-"·빈칸·숫자가 아닌 값은 계산할 때만 0 (간편등록 applyQuickColumnRules·장표 수식과 같은 결과).
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

/** 금액 비교용: "-"·빈칸·숫자가 아님 → null */
function baseAmount(text: string): number | null {
  const t = text.replace(/[\s,]/g, "").replace(/원$/, "");
  return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : null;
}

/**
 * 화면 표시용: 바꾼 칸 + N·U·AB·AC 자동 변경 (지금 장표 값과 다를 때만).
 * 자동 항목은 서버가 버린다 — 장표 수식이 계산하고, 숫자로 남아 있던 칸은 Apps Script 가 수식으로 바꾼다.
 * 사용자가 N·U·AB·AC 를 직접 입력해도 무시한다 (LOCKED).
 */
function applyRowFormulaRule(
  sale: SheetSale,
  changes: SaleChange[],
): SaleChange[] {
  const rest = changes.filter((c) => !isRowFormulaKey(c.key));
  if (rest.length === 0) return []; // 저장할 칸이 없으면 자동 항목도 없음 (수식 칸만으로는 저장하지 않음)
  const edited = Object.fromEntries(rest.map((c) => [c.key, c.after]));
  const values = rowFormulaValues(sale, edited);
  const autos: SaleChange[] = [];
  for (const key of ROW_FORMULA_KEYS) {
    const before = editText(sale, key);
    if (baseAmount(before) !== values[key]) {
      autos.push({
        key,
        before,
        after: String(values[key]),
        auto: true,
        autoNote: ROW_FORMULA_NOTE[key],
      });
    }
  }
  return [...rest, ...autos];
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
