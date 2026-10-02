/*
 * 무선장표 열 구조 — 웹앱 전체가 쓰는 단 하나의 기준.
 *
 * 기준: 실제 "무선장표" 스프레드시트의 "무선장표 양식" 시트 6·7행 제목
 *       (E열 오른쪽에 "실력지표제외" F열이 삽입된 뒤의 A~AL, 38칸).
 * 열 위치가 바뀌면 이 파일과 Apps Script 의 common.gs 만 고친다.
 */

export const SHEET_COLUMNS = [
  { letter: "A", key: "customerPromise", label: "고객약속사항" },
  { letter: "B", key: "no", label: "No." },
  { letter: "C", key: "activatedAt", label: "개통일" },
  { letter: "D", key: "customer", label: "고객" },
  { letter: "E", key: "ctn", label: "CTN" },
  { letter: "F", key: "excludeIndicator", label: "실력지표제외" },
  { letter: "G", key: "inspected", label: "검수" },
  { letter: "H", key: "paid", label: "수납" },
  { letter: "I", key: "category", label: "개통구분" },
  { letter: "J", key: "model", label: "모델명" },
  { letter: "K", key: "plan", label: "요금제" },
  { letter: "L", key: "planChange", label: "유지/변경" },
  { letter: "M", key: "staff", label: "직원명" },
  { letter: "N", key: "securedTotal", label: "총 확보금액" },
  { letter: "O", key: "spot", label: "SPOT정책" },
  { letter: "P", key: "securedDicho", label: "디초/삼초" },
  { letter: "Q", key: "appleMania", label: "애플매니아" },
  { letter: "R", key: "securedSecond", label: "2ND" },
  { letter: "S", key: "modelPolicy", label: "모델정책" },
  { letter: "T", key: "customerBenefit", label: "고객혜택" },
  { letter: "U", key: "usedTotal", label: "총 사용금액" },
  { letter: "V", key: "usedModelPlan", label: "모델/요금" },
  { letter: "W", key: "usedExtraSupport", label: "추가지원금" },
  { letter: "X", key: "usedDicho", label: "디초/삼초" },
  { letter: "Y", key: "usedSecond", label: "2nd" },
  { letter: "Z", key: "usedPhoneSale", label: "중고판매 판매" },
  { letter: "AA", key: "usedPhoneUsed", label: "중고판매 사용" },
  { letter: "AB", key: "usedPhoneRemaining", label: "중고판매 잔여" },
  { letter: "AC", key: "finalTotal", label: "합계" },
  { letter: "AD", key: "secondPerformance", label: "2ND" },
  { letter: "AE", key: "jeca", label: "제카" },
  { letter: "AF", key: "cardType", label: "카드 종류" },
  { letter: "AG", key: "cardChecked", label: "카드실적 검수(등록)" },
  { letter: "AH", key: "jecaBudget", label: "제카확보예산" },
  { letter: "AI", key: "addon", label: "부가(필L/필S)" },
  { letter: "AJ", key: "insurance", label: "보험" },
  { letter: "AK", key: "dongpan", label: "동판" },
  { letter: "AL", key: "wiredAvailableDate", label: "가능일" },
] as const;

export type SheetColumn = (typeof SHEET_COLUMNS)[number];
export type ColumnLetter = SheetColumn["letter"];
export type ColumnKey = SheetColumn["key"];

/** 장표 열 개수 (A~AL) */
export const COLUMN_COUNT = SHEET_COLUMNS.length; // 38

/** 키 → 0부터 시작하는 열 번호 */
export const COLUMN_INDEX = Object.fromEntries(
  SHEET_COLUMNS.map((c, i) => [c.key, i]),
) as Record<ColumnKey, number>;

/** 키 → 열 문자 */
export const COLUMN_LETTER = Object.fromEntries(
  SHEET_COLUMNS.map((c) => [c.key, c.letter]),
) as Record<ColumnKey, ColumnLetter>;

/** 키 → 화면 표시 이름 (장표 제목과 같게) */
export const COLUMN_LABEL = Object.fromEntries(
  SHEET_COLUMNS.map((c) => [c.key, c.label]),
) as Record<ColumnKey, string>;

/** 데이터 행 시작 (8행까지는 제목·견본 영역) */
export const FIRST_DATA_ROW = 9;

/*
 * 저장할 한 행. 값이 없는 키(undefined)는 Apps Script가 그 칸을 "건드리지 않는다".
 * (간편등록처럼 직원이 보내지 않은 칸을 빈칸 그대로 두기 위함)
 */
export type SheetRowValues = Partial<Record<ColumnKey, string | number>>;

/** 저장 요청용 38칸 배열. 건드리지 않을 칸은 null, B열(No.)은 항상 null. */
export type SheetRowArray = (string | number | null)[];

/**
 * 글자가 =, +, -, @ 로 시작하면 시트가 계산식으로 해석할 수 있으므로
 * 앞에 ' 를 붙여 일반 글자로 저장되게 한다 (시트 화면에는 ' 가 보이지 않음).
 */
export function escapeSheetText(value: string): string {
  return /^[=+\-@]/.test(value) ? `'${value}` : value;
}

export function toSheetRowArray(values: SheetRowValues): SheetRowArray {
  return SHEET_COLUMNS.map(({ key }) => {
    if (key === "no") return null; // B열 No. 는 절대 보내지 않는다
    const value = values[key];
    if (value === undefined) return null;
    return typeof value === "string" ? escapeSheetText(value) : value;
  });
}

/*
 * 열 구조 확인용 제목 (Apps Script common.gs 의 LAYOUT_CHECKS 와 같아야 한다).
 * 장표 6·7행 제목이 이와 다르면 저장·삭제·조회를 하지 않는다.
 */
export const LAYOUT_CHECKS = [
  { row: 6, letter: "F", text: "실력지표제외" },
  { row: 7, letter: "G", text: "검수" },
  { row: 7, letter: "H", text: "수납" },
  { row: 6, letter: "M", text: "직원명" },
  { row: 6, letter: "T", text: "고객혜택" },
  { row: 7, letter: "AE", text: "제카" },
  { row: 7, letter: "AL", text: "가능일" },
] as const;
