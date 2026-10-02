import type { SaleCategory } from "@/lib/types";

/*
 * 판매등록 입력값 정의, 자동 계산, 입력값 검증.
 * 항목 이름은 실제 장표(무선장표 양식) 제목과 같게 쓴다. 열 위치는 lib/sheet-columns.ts 참고.
 * 금액은 입력 중 편집이 쉽도록 숫자만 담은 문자열로 보관한다 (예: "350000").
 */

export const SALE_CATEGORIES: SaleCategory[] = ["기기변경", "번호이동", "신규"];

export type PlanChange = "유지" | "변경";
export const PLAN_CHANGES: PlanChange[] = ["유지", "변경"];

/** 확보금액 항목 (O~S열) — 합계가 N열 총 확보금액 */
export const SECURED_ITEMS = [
  { key: "spot", label: "SPOT정책" }, // O
  { key: "dicho", label: "디초/삼초" }, // P
  { key: "appleMania", label: "애플매니아" }, // Q
  { key: "second", label: "2ND" }, // R
  { key: "modelPolicy", label: "모델정책" }, // S
] as const;
export type SecuredKey = (typeof SECURED_ITEMS)[number]["key"];

/** 고객혜택 사용 항목 (V~Y열) — 합계가 U열 총 사용금액 */
export const USED_ITEMS = [
  { key: "modelPlan", label: "모델/요금" }, // V
  { key: "extraSupport", label: "추가지원금" }, // W
  { key: "dicho", label: "디초/삼초" }, // X
  { key: "second", label: "2nd" }, // Y
] as const;
export type UsedKey = (typeof USED_ITEMS)[number]["key"];

/** 장표의 O/X 값. 완료·해당 = "O", 미완료·미해당 = "X" */
export type OX = "O" | "X";
export const OX_OPTIONS: OX[] = ["O", "X"];

/** 동판 선택값 (O/X가 아니라 반드시 이 4개 중 하나) */
export type Dongpan = "신동" | "순동" | "약동" | "X";
export const DONGPAN_OPTIONS: Dongpan[] = ["신동", "순동", "약동", "X"];

/** 부가(필L/필S) 선택값 */
export type Addon = "필L" | "필S" | "X";
export const ADDON_OPTIONS: Addon[] = ["필L", "필S", "X"];

export interface SaleFormValues {
  // 1. 기본 개통정보
  activatedAt: string; // C 개통일
  customer: string; // D 고객
  /** 숫자만 (예: 01012345678) */
  ctn: string; // E CTN
  excludeIndicator: OX | ""; // F 실력지표제외
  category: SaleCategory | ""; // I 개통구분
  model: string; // J 모델명
  plan: string; // K 요금제
  planChange: PlanChange | ""; // L 유지/변경
  staff: string; // M 직원명
  customerPromise: string; // A 고객약속사항 (선택)
  // 2. 정리 (검수·수납)
  inspected: OX; // G 검수
  paid: OX; // H 수납
  // 3. 확보금액 (O~S)
  secured: Record<SecuredKey, string>;
  // 4. 고객혜택 / 고객혜택사용
  /** T 고객혜택. 총 사용금액 계산에는 포함하지 않는다. */
  customerBenefit: string;
  used: Record<UsedKey, string>; // V~Y
  // 5. 중고판매
  usedPhoneSale: string; // Z 판매
  usedPhoneUsed: string; // AA 사용
  // 6. 추가 관리
  secondPerformance: OX; // AD 2ND
  jeca: OX; // AE 제카
  cardType: string; // AF 종류 (제카 O 일 때 카드 종류)
  /** AH 제카확보예산. 총 확보금액에 포함하지 않는다. */
  jecaBudget: string;
  addon: Addon; // AI 부가 (필L/필S)
  insurance: OX; // AJ 보험
  dongpan: Dongpan; // AK 동판
  wiredAvailableDate: string; // AL 가능일 (동판이 X 가 아닐 때, YYYY-MM-DD)
}

function emptyRecord<K extends string, V>(
  keys: readonly { key: K }[],
  value: V,
) {
  return Object.fromEntries(keys.map(({ key }) => [key, value])) as Record<
    K,
    V
  >;
}

export function createInitialValues(today: string): SaleFormValues {
  return {
    activatedAt: today,
    customer: "",
    ctn: "",
    excludeIndicator: "",
    category: "",
    model: "",
    plan: "",
    planChange: "",
    staff: "",
    customerPromise: "",
    inspected: "X",
    paid: "X",
    secured: emptyRecord(SECURED_ITEMS, ""),
    customerBenefit: "",
    used: emptyRecord(USED_ITEMS, ""),
    usedPhoneSale: "",
    usedPhoneUsed: "",
    secondPerformance: "X",
    jeca: "X",
    cardType: "",
    jecaBudget: "",
    addon: "X",
    insurance: "X",
    dongpan: "X",
    wiredAvailableDate: "",
  };
}

/** 숫자 문자열 → 금액 (빈 값은 0) */
export function toAmount(value: string): number {
  return value ? Number(value) : 0;
}

export interface SaleFormTotals {
  /** N 총 확보금액 = O + P + Q + R + S (고객혜택·제카확보예산 제외) */
  securedTotal: number;
  /** U 총 사용금액 = V + W + X + Y (고객혜택 제외) */
  usedTotal: number;
  /** AB 중고판매 잔여 = Z − AA */
  usedPhoneRemaining: number;
  /** AC 합계 = N − U + AB */
  finalTotal: number;
}

export function calculateTotals(values: SaleFormValues): SaleFormTotals {
  const sum = (record: Record<string, string>) =>
    Object.values(record).reduce((total, v) => total + toAmount(v), 0);

  const securedTotal = sum(values.secured);
  const usedTotal = sum(values.used);
  const usedPhoneRemaining =
    toAmount(values.usedPhoneSale) - toAmount(values.usedPhoneUsed);

  return {
    securedTotal,
    usedTotal,
    usedPhoneRemaining,
    finalTotal: securedTotal - usedTotal + usedPhoneRemaining,
  };
}

/** 필수 항목. 화면 위에서 아래 순서와 같다. */
export const REQUIRED_FIELDS = [
  { name: "activatedAt", label: "개통일", missing: "개통일을 선택해 주세요." },
  { name: "customer", label: "고객", missing: "고객명을 입력해 주세요." },
  { name: "ctn", label: "CTN", missing: "CTN을 입력해 주세요." },
  {
    name: "excludeIndicator",
    label: "실력지표제외",
    missing: "실력지표제외(O/X)를 선택해 주세요.",
  },
  { name: "category", label: "개통구분", missing: "개통구분을 선택해 주세요." },
  { name: "model", label: "모델명", missing: "모델명을 입력해 주세요." },
  { name: "plan", label: "요금제", missing: "요금제를 입력해 주세요." },
  {
    name: "planChange",
    label: "유지/변경",
    missing: "요금제 유지/변경을 선택해 주세요.",
  },
  { name: "staff", label: "직원명", missing: "직원명을 선택해 주세요." },
  {
    name: "cardType",
    label: "카드 종류",
    missing: "제카가 O 이면 카드 종류를 입력해 주세요.",
  },
  {
    name: "wiredAvailableDate",
    label: "가능일",
    missing: "동판이 X 가 아니면 가능일을 입력해 주세요.",
  },
] as const;
export type RequiredField = (typeof REQUIRED_FIELDS)[number]["name"];

export type SaleFormErrors = Partial<Record<RequiredField, string>>;

export const CTN_PATTERN = /^01[016789]\d{7,8}$/;

/** 제카가 O 일 때만 카드 종류, 동판이 X 가 아닐 때만 가능일이 필수 */
function isRequired(name: RequiredField, values: SaleFormValues): boolean {
  if (name === "cardType") return values.jeca === "O";
  if (name === "wiredAvailableDate") return values.dongpan !== "X";
  return true;
}

export function validateSaleForm(values: SaleFormValues): SaleFormErrors {
  const errors: SaleFormErrors = {};

  for (const { name, missing } of REQUIRED_FIELDS) {
    if (isRequired(name, values) && !String(values[name]).trim()) {
      errors[name] = missing;
    }
  }
  if (!errors.ctn && !CTN_PATTERN.test(values.ctn)) {
    errors.ctn = "휴대폰번호 형식(010-0000-0000)을 확인해 주세요.";
  }
  if (values.jeca === "O" && values.cardType.trim().toUpperCase() === "X") {
    errors.cardType = "제카가 O 이면 카드 종류에 X 를 넣을 수 없습니다.";
  }

  return errors;
}

/** 오류 항목의 화면 요소 id */
export function fieldId(name: string): string {
  return `sale-${name}`;
}
