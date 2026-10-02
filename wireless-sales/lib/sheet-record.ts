import { ALL_SHEET_COLUMNS } from "@/lib/sheet-mapping";

/*
 * 장표 한 행(A~AK 37칸) → 화면에 보여줄 판매내역 1건.
 * 열 위치는 lib/sheet-mapping.ts 와 같은 A~AK 구조를 그대로 따른다.
 * 장표에는 "-", "50,000", 빈 칸처럼 손으로 입력한 값도 있으므로 너그럽게 읽는다.
 */

export interface SheetSale {
  /** 장표의 실제 행 번호 */
  row: number;
  /** B열 No. */
  no: string;
  customerPromise: string; // A
  activatedAt: string; // C
  customer: string; // D
  ctn: string; // E
  inspected: string; // F
  paid: string; // G
  category: string; // H
  model: string; // I
  plan: string; // J
  planChange: string; // K
  staff: string; // L
  securedTotal: number | null; // M
  spot: number | null; // N
  securedDicho: number | null; // O
  appleMania: number | null; // P
  securedSecond: number | null; // Q
  modelIncentive: number | null; // R
  customerBenefitTotal: number | null; // S
  usedTotal: number | null; // T
  usedModelPlan: number | null; // U
  usedDicho: number | null; // V
  usedSecond: number | null; // W
  complaint: number | null; // X
  usedPhoneSale: number | null; // Y
  usedPhoneUsed: number | null; // Z
  usedPhoneRemaining: number | null; // AA
  finalTotal: number | null; // AB
  secondPerformance: string; // AC
  jecaPerformance: string; // AD
  weaponType: string; // AE
  weaponRegistered: string; // AF
  jecaBudget: number | null; // AG
  pilS: string; // AH
  pilL: string; // AI
  dongpan: string; // AJ
  wiredAvailableDate: string; // AK
}

type Column = (typeof ALL_SHEET_COLUMNS)[number];

/** 글자로 읽기. 시트가 계산식 방지용으로 붙인 ' 는 떼어 낸다. */
export function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = String(value).trim();
  return text.startsWith("'") ? text.slice(1) : text;
}

/** 금액으로 읽기. 빈 칸·"-"·숫자가 아닌 값은 null (화면에서는 "-"로 표시). */
export function cellAmount(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const text = cellText(value).replace(/,/g, "").replace(/원$/, "");
  if (!/^-?\d+(\.\d+)?$/.test(text)) return null;
  return Number(text);
}

export function parseSheetRow(
  row: number,
  no: string,
  values: readonly unknown[],
): SheetSale {
  const get = (column: Column) => values[ALL_SHEET_COLUMNS.indexOf(column)];
  const text = (column: Column) => cellText(get(column));
  const amount = (column: Column) => cellAmount(get(column));

  return {
    row,
    no: cellText(no) || text("B"),
    customerPromise: text("A"),
    activatedAt: text("C"),
    customer: text("D"),
    ctn: text("E"),
    inspected: text("F"),
    paid: text("G"),
    category: text("H"),
    model: text("I"),
    plan: text("J"),
    planChange: text("K"),
    staff: text("L"),
    securedTotal: amount("M"),
    spot: amount("N"),
    securedDicho: amount("O"),
    appleMania: amount("P"),
    securedSecond: amount("Q"),
    modelIncentive: amount("R"),
    customerBenefitTotal: amount("S"),
    usedTotal: amount("T"),
    usedModelPlan: amount("U"),
    usedDicho: amount("V"),
    usedSecond: amount("W"),
    complaint: amount("X"),
    usedPhoneSale: amount("Y"),
    usedPhoneUsed: amount("Z"),
    usedPhoneRemaining: amount("AA"),
    finalTotal: amount("AB"),
    secondPerformance: text("AC"),
    jecaPerformance: text("AD"),
    weaponType: text("AE"),
    weaponRegistered: text("AF"),
    jecaBudget: amount("AG"),
    pilS: text("AH"),
    pilL: text("AI"),
    dongpan: text("AJ"),
    wiredAvailableDate: text("AK"),
  };
}
