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
  return changes;
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
