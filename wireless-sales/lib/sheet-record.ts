import { COLUMN_INDEX, type ColumnKey } from "@/lib/sheet-columns";

/*
 * 장표 한 행(A~AL 38칸) → 화면에서 쓰는 판매 1건.
 * 열 위치는 lib/sheet-columns.ts 를 그대로 따른다.
 * 장표에는 "-", "50,000", 빈 칸처럼 손으로 입력한 값도 있으므로 너그럽게 읽는다.
 */

export const AMOUNT_KEYS = [
  "securedTotal",
  "spot",
  "securedDicho",
  "appleMania",
  "securedSecond",
  "modelPolicy",
  "customerBenefit",
  "usedTotal",
  "usedModelPlan",
  "usedExtraSupport",
  "usedDicho",
  "usedSecond",
  "usedPhoneSale",
  "usedPhoneUsed",
  "usedPhoneRemaining",
  "finalTotal",
  "jecaBudget",
] as const satisfies readonly ColumnKey[];

type AmountKey = (typeof AMOUNT_KEYS)[number];
type TextKey = Exclude<ColumnKey, AmountKey | "no">;

export type SheetSale = {
  /** 장표의 실제 행 번호 */
  row: number;
  /** B열 No. */
  no: string;
} & Record<TextKey, string> &
  Record<AmountKey, number | null> & {
    /**
     * 판매보고 참고내용 (장표 A~AL 에 없는 항목, 예: 중고폰&현물 판매·어디에).
     * Apps Script 보조 시트 "웹앱참고" 에서 이 판매에 정확히 연결된 경우만 있다.
     */
    notes?: Record<string, string>;
    /** O열(SPOT정책) 셀 메모 원문 (스팟관리 조회용, 읽기 전용) */
    spotNote?: string;
  };

/** 글자로 읽기. 시트가 계산식 방지용으로 붙인 ' 는 떼어 낸다. */
export function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = String(value).trim();
  return text.startsWith("'") ? text.slice(1) : text;
}

/** 금액으로 읽기. 빈 칸·"-"·숫자가 아닌 값은 null (화면에서는 "-", 합계에서는 0). */
export function cellAmount(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const text = cellText(value).replace(/,/g, "").replace(/원$/, "");
  if (!/^-?\d+(\.\d+)?$/.test(text)) return null;
  return Number(text);
}

const AMOUNT_SET = new Set<ColumnKey>(AMOUNT_KEYS);

export function parseSheetRow(
  row: number,
  no: string,
  values: readonly unknown[],
): SheetSale {
  const sale: Record<string, unknown> = { row };
  for (const [key, index] of Object.entries(COLUMN_INDEX) as [
    ColumnKey,
    number,
  ][]) {
    if (key === "no") continue;
    sale[key] = AMOUNT_SET.has(key)
      ? cellAmount(values[index])
      : cellText(values[index]);
  }
  sale.no = cellText(no) || cellText(values[COLUMN_INDEX.no]);
  return sale as SheetSale;
}

/** O 로 표시된 칸인지 (대소문자·공백 무시) */
export function isO(value: string): boolean {
  return value.trim().toUpperCase() === "O";
}
