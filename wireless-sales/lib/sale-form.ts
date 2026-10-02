import type { SaleCategory } from "@/lib/types";

/*
 * 판매 등록 입력값 정의, 자동 계산, 입력값 검증.
 * 금액은 입력 중 편집이 쉽도록 숫자만 담은 문자열로 보관한다 (예: "350000").
 */

export const SALE_CATEGORIES: SaleCategory[] = ["기기변경", "번호이동", "신규"];

export type PlanChange = "유지" | "변경";
export const PLAN_CHANGES: PlanChange[] = ["유지", "변경"];

/** 확보금액 항목 */
export const SECURED_ITEMS = [
  { key: "spot", label: "SPOT 정책" },
  { key: "dicho", label: "디초/삼초" },
  { key: "appleMania", label: "애플매니아" },
  { key: "second", label: "2ND" },
  { key: "modelIncentive", label: "모델인센" },
] as const;
export type SecuredKey = (typeof SECURED_ITEMS)[number]["key"];

/** 고객혜택 / 사용금액 항목 */
export const USED_ITEMS = [
  { key: "modelPlan", label: "모델/요금" },
  { key: "dicho", label: "디초/삼초" },
  { key: "second", label: "2ND" },
  { key: "complaint", label: "민원건" },
] as const;
export type UsedKey = (typeof USED_ITEMS)[number]["key"];

/** 부가서비스 항목 */
export const ADDON_ITEMS = [
  { key: "safe", label: "안심" },
  { key: "media", label: "미디" },
  { key: "dongpan", label: "동판" },
] as const;
export type AddonKey = (typeof ADDON_ITEMS)[number]["key"];

export interface SaleFormValues {
  // 1. 기본 개통정보
  activatedAt: string;
  customer: string;
  /** 숫자만 (예: 01012345678) */
  ctn: string;
  category: SaleCategory | "";
  model: string;
  plan: string;
  planChange: PlanChange | "";
  staff: string;
  // 2. 업무 처리 확인
  inspected: boolean;
  paid: boolean;
  // 3. 확보금액
  secured: Record<SecuredKey, string>;
  // 4. 고객혜택 / 사용금액
  used: Record<UsedKey, string>;
  // 5. 중고판매
  usedPhoneSale: string;
  usedPhoneUsed: string;
  // 6. 추가 관리
  jecaAmount: string;
  weaponType: string;
  weaponRegistered: boolean;
  addons: Record<AddonKey, boolean>;
  wiredAvailableDate: string;
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
    category: "",
    model: "",
    plan: "",
    planChange: "",
    staff: "",
    inspected: false,
    paid: false,
    secured: emptyRecord(SECURED_ITEMS, ""),
    used: emptyRecord(USED_ITEMS, ""),
    usedPhoneSale: "",
    usedPhoneUsed: "",
    jecaAmount: "",
    weaponType: "",
    weaponRegistered: false,
    addons: emptyRecord(ADDON_ITEMS, false),
    wiredAvailableDate: "",
  };
}

/** 숫자 문자열 → 금액 (빈 값은 0) */
export function toAmount(value: string): number {
  return value ? Number(value) : 0;
}

export interface SaleFormTotals {
  /** 총 확보금액 = 확보금액 항목 합계 */
  securedTotal: number;
  /** 총 사용금액 = 고객혜택/사용금액 항목 합계 */
  usedTotal: number;
  /** 중고판매 잔여금액 = 판매금액 − 사용금액 */
  usedPhoneRemaining: number;
}

export function calculateTotals(values: SaleFormValues): SaleFormTotals {
  const sum = (record: Record<string, string>) =>
    Object.values(record).reduce((total, v) => total + toAmount(v), 0);

  return {
    securedTotal: sum(values.secured),
    usedTotal: sum(values.used),
    usedPhoneRemaining:
      toAmount(values.usedPhoneSale) - toAmount(values.usedPhoneUsed),
  };
}

/** 필수 항목. 화면 위에서 아래 순서와 같다. */
export const REQUIRED_FIELDS = [
  { name: "activatedAt", label: "개통일", missing: "개통일을 선택해 주세요." },
  { name: "customer", label: "고객명", missing: "고객명을 입력해 주세요." },
  { name: "ctn", label: "CTN", missing: "CTN을 입력해 주세요." },
  { name: "category", label: "개통구분", missing: "개통구분을 선택해 주세요." },
  { name: "model", label: "모델명", missing: "모델명을 입력해 주세요." },
  { name: "plan", label: "요금제", missing: "요금제를 입력해 주세요." },
  {
    name: "planChange",
    label: "요금제 유지/변경",
    missing: "요금제 유지/변경을 선택해 주세요.",
  },
  { name: "staff", label: "직원명", missing: "직원명을 선택해 주세요." },
] as const;
export type RequiredField = (typeof REQUIRED_FIELDS)[number]["name"];

export type SaleFormErrors = Partial<Record<RequiredField, string>>;

const CTN_PATTERN = /^01[016789]\d{7,8}$/;

export function validateSaleForm(values: SaleFormValues): SaleFormErrors {
  const errors: SaleFormErrors = {};

  for (const { name, missing } of REQUIRED_FIELDS) {
    if (!values[name].trim()) errors[name] = missing;
  }
  if (!errors.ctn && !CTN_PATTERN.test(values.ctn)) {
    errors.ctn = "휴대폰번호 형식(010-0000-0000)을 확인해 주세요.";
  }

  return errors;
}

/** 오류 항목의 화면 요소 id */
export function fieldId(name: string): string {
  return `sale-${name}`;
}
