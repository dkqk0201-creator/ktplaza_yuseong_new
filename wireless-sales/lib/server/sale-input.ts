import "server-only";
import {
  DONGPAN_OPTIONS,
  OX_OPTIONS,
  PLAN_CHANGES,
  SALE_CATEGORIES,
  SECURED_ITEMS,
  USED_ITEMS,
  createInitialValues,
  validateSaleForm,
  type SaleFormValues,
} from "@/lib/sale-form";

/*
 * 서버에서 판매 등록 입력값을 다시 검증한다.
 * 브라우저가 보낸 값은 믿지 않고, 알려진 항목만 정해진 형식으로 골라 새 객체를 만든다.
 */

export type ParseResult =
  | { ok: true; values: SaleFormValues }
  | { ok: false; errors: string[] };

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const AMOUNT_PATTERN = /^\d{1,12}$/;

function isValidDate(value: string): boolean {
  if (!DATE_PATTERN.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return (
    !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}

export function parseSaleFormInput(
  input: unknown,
  staffNames: readonly string[],
): ParseResult {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { ok: false, errors: ["입력값 형식이 올바르지 않습니다."] };
  }
  const raw = input as Record<string, unknown>;
  const errors: string[] = [];

  function text(key: string, label: string, maxLength: number): string {
    const value = raw[key] ?? "";
    if (typeof value !== "string") {
      errors.push(`${label} 값이 올바르지 않습니다.`);
      return "";
    }
    if (value.length > maxLength) {
      errors.push(`${label}은(는) ${maxLength}자 이하로 입력해 주세요.`);
    }
    return value;
  }

  function choice<T extends string>(
    key: string,
    label: string,
    options: readonly T[],
    allowEmpty = false,
  ): T | "" {
    const value = raw[key] ?? "";
    if (allowEmpty && value === "") return "";
    if (typeof value !== "string" || !options.includes(value as T)) {
      errors.push(`${label} 값이 올바르지 않습니다.`);
      return "";
    }
    return value as T;
  }

  // O/X·동판은 값이 아예 없으면 기본값 X, 허용되지 않은 값이면 오류
  function ox(key: string, label: string) {
    if (raw[key] === undefined) return "X";
    return (choice(key, label, OX_OPTIONS) || "X") as "O" | "X";
  }

  function amount(value: unknown, label: string): string {
    const v = value ?? "";
    if (v === "") return "";
    if (typeof v !== "string" || !AMOUNT_PATTERN.test(v)) {
      errors.push(`${label} 금액이 올바르지 않습니다.`);
      return "";
    }
    return String(Number(v));
  }

  function date(key: string, label: string, allowEmpty: boolean): string {
    const value = text(key, label, 10);
    if (value === "" && allowEmpty) return "";
    if (value !== "" && !isValidDate(value)) {
      errors.push(`${label} 날짜 형식이 올바르지 않습니다.`);
      return "";
    }
    return value;
  }

  function amountGroup<K extends string>(
    key: string,
    items: readonly { key: K; label: string }[],
  ): Record<K, string> {
    const group = raw[key];
    const source =
      typeof group === "object" && group !== null
        ? (group as Record<string, unknown>)
        : {};
    return Object.fromEntries(
      items.map((item) => [item.key, amount(source[item.key], item.label)]),
    ) as Record<K, string>;
  }

  const ctn = text("ctn", "CTN", 11);
  const staff = text("staff", "직원명", 20);
  if (staff !== "" && !staffNames.includes(staff)) {
    errors.push("등록되지 않은 직원명입니다.");
  }

  const values: SaleFormValues = {
    ...createInitialValues(""),
    activatedAt: date("activatedAt", "개통일", true),
    customer: text("customer", "고객명", 50),
    ctn: /^\d*$/.test(ctn) ? ctn : "",
    category: choice("category", "개통구분", SALE_CATEGORIES, true),
    model: text("model", "모델명", 100),
    plan: text("plan", "요금제", 100),
    planChange: choice("planChange", "요금제 유지/변경", PLAN_CHANGES, true),
    staff,
    customerPromise: text("customerPromise", "추후 고객약속", 500),
    inspected: ox("inspected", "검수"),
    paid: ox("paid", "수납"),
    secured: amountGroup("secured", SECURED_ITEMS),
    customerBenefitTotal: amount(raw.customerBenefitTotal, "고객혜택 총액"),
    used: amountGroup("used", USED_ITEMS),
    usedPhoneSale: amount(raw.usedPhoneSale, "중고판매 판매금액"),
    usedPhoneUsed: amount(raw.usedPhoneUsed, "중고판매 사용금액"),
    secondPerformance: ox("secondPerformance", "2ND 실적"),
    jecaPerformance: ox("jecaPerformance", "제카 실적"),
    weaponType: text("weaponType", "판매무기 종류", 50),
    weaponRegistered: ox("weaponRegistered", "판매무기 등록"),
    jecaBudget: amount(raw.jecaBudget, "제카 확보예산"),
    pilS: ox("pilS", "필S"),
    pilL: ox("pilL", "필L"),
    dongpan: (raw.dongpan === undefined
      ? "X"
      : choice("dongpan", "동판", DONGPAN_OPTIONS) ||
        "X") as SaleFormValues["dongpan"],
    wiredAvailableDate: date("wiredAvailableDate", "유선 가능일", true),
  };

  // 필수 항목·CTN 형식은 화면과 같은 규칙으로 다시 확인한다
  errors.push(...Object.values(validateSaleForm(values)));

  return errors.length > 0
    ? { ok: false, errors: [...new Set(errors)] }
    : { ok: true, values };
}
