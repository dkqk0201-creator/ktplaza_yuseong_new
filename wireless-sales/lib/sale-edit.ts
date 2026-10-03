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
 * 쓰지는 않고 장표 현재 값이 화면에서 본 값(before)과 같은지만 확인하는 칸.
 * AB·AC 재계산에 쓰였지만 이번에 바꾸지 않는 칸(N·U·Z·AA·AB·AC)을
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

/** Z·AA 중 하나라도 바뀌면 재계산 */
export const USED_PHONE_TRIGGER_KEYS = [
  "usedPhoneSale", // Z
  "usedPhoneUsed", // AA
] as const satisfies readonly ColumnKey[];

/** 재계산에 쓰이는 칸 N·U·Z·AA 와 결과 칸 AB·AC */
export const USED_PHONE_RECALC_KEYS = [
  "securedTotal", // N
  "usedTotal", // U
  "usedPhoneSale", // Z
  "usedPhoneUsed", // AA
  "usedPhoneRemaining", // AB
  "finalTotal", // AC
] as const satisfies readonly ColumnKey[];

const USED_PHONE_NOTE = "중고판매(Z·AA) 변경으로 자동 계산";

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

function hasUsedPhoneTrigger(keys: Iterable<ColumnKey>): boolean {
  for (const key of keys)
    if ((USED_PHONE_TRIGGER_KEYS as readonly ColumnKey[]).includes(key))
      return true;
  return false;
}

/**
 * Z 또는 AA 를 바꾸면 최종값(바꾼 값, 안 바꾼 칸은 화면 값) 기준으로 AB·AC 를 다시 계산해
 * 자동 변경으로 함께 저장한다. 직접 입력한 AB·AC 는 계산값으로 대체한다.
 * 계산값이 지금 값과 같으면 쓰지 않는다 (saleChecks 로 현재 값만 확인).
 * Z·AA 를 바꾸지 않은 수정에서는 AB·AC 를 건드리지 않는다.
 */
function applyUsedPhoneRule(
  sale: SheetSale,
  changes: SaleChange[],
): SaleChange[] {
  if (!hasUsedPhoneTrigger(changes.map((c) => c.key))) return changes;
  const rest = changes.filter(
    (c) => c.key !== "usedPhoneRemaining" && c.key !== "finalTotal",
  );
  const final = (key: ColumnKey) =>
    rest.find((c) => c.key === key)?.after ?? editText(sale, key);
  const result = calcUsedPhone({
    securedTotal: final("securedTotal"),
    usedTotal: final("usedTotal"),
    usedPhoneSale: final("usedPhoneSale"),
    usedPhoneUsed: final("usedPhoneUsed"),
  });
  const auto: SaleChange[] = [];
  for (const key of ["usedPhoneRemaining", "finalTotal"] as const) {
    const before = editText(sale, key);
    if (parseEditAmount(before) !== result[key]) {
      auto.push({
        key,
        before,
        after: String(result[key]),
        auto: true,
        autoNote: USED_PHONE_NOTE,
      });
    }
  }
  return [...rest, ...auto];
}

/**
 * 판매 수정 요청과 함께 보낼 "확인만 하는 칸".
 * Z·AA 를 바꿀 때 N·U·Z·AA·AB·AC 중 이번에 쓰지 않는 칸의 화면 값.
 */
export function saleChecks(
  sale: SheetSale,
  changes: SaleChange[],
): SaleCheck[] {
  if (!hasUsedPhoneTrigger(changes.map((c) => c.key))) return [];
  const changed = new Set<ColumnKey>(changes.map((c) => c.key));
  return USED_PHONE_RECALC_KEYS.filter((key) => !changed.has(key)).map(
    (key) => ({ key, before: editText(sale, key) }),
  );
}

/**
 * 서버 재검증: Z·AA 를 바꾸는 요청이면 N·U·Z·AA·AB·AC 가 모두 (바꾸는 칸 또는 확인 칸으로) 있어야 하고,
 * AB·AC 가 위 규칙으로 계산한 값과 같아야 한다. 맞으면 null, 아니면 오류 문구.
 * Z·AA 를 바꾸지 않는 요청에는 확인 칸이 없어야 한다.
 */
export function verifyUsedPhoneRecalc(
  changes: readonly { key: ColumnKey; before: string; after: string }[],
  checks: readonly SaleCheck[],
): string | null {
  const refresh =
    "중고판매(Z·AA) 수정에 필요한 값이 맞지 않습니다. 화면을 새로고침한 뒤 다시 수정해 주세요.";
  if (!hasUsedPhoneTrigger(changes.map((c) => c.key))) {
    return checks.length === 0 ? null : refresh;
  }
  const screen = new Map<ColumnKey, string>();
  const final = new Map<ColumnKey, string>();
  for (const c of changes) {
    screen.set(c.key, c.before);
    final.set(c.key, c.after);
  }
  for (const c of checks) {
    if (screen.has(c.key)) return refresh; // 바꾸는 칸과 확인 칸이 겹침
    screen.set(c.key, c.before);
    final.set(c.key, c.before);
  }
  for (const key of USED_PHONE_RECALC_KEYS) if (!screen.has(key)) return refresh;
  if (
    checks.some(
      (c) => !(USED_PHONE_RECALC_KEYS as readonly ColumnKey[]).includes(c.key),
    )
  ) {
    return refresh;
  }
  const result = calcUsedPhone({
    securedTotal: final.get("securedTotal")!,
    usedTotal: final.get("usedTotal")!,
    usedPhoneSale: final.get("usedPhoneSale")!,
    usedPhoneUsed: final.get("usedPhoneUsed")!,
  });
  for (const key of ["usedPhoneRemaining", "finalTotal"] as const) {
    if (parseEditAmount(final.get(key)!) !== result[key]) return refresh;
  }
  return null;
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
