import {
  COLUMN_INDEX,
  COLUMN_LABEL,
  COLUMN_LETTER,
  SHEET_COLUMNS,
  type ColumnKey,
} from "@/lib/sheet-columns";
import { AMOUNT_KEYS, type SheetSale } from "@/lib/sheet-record";

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
  /** 제휴카드 규칙으로 자동으로 바뀌는 칸 (화면 안내용) */
  auto?: boolean;
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
  return applyCardRule(sale, changes);
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
