import type { ColumnKey, SheetRowValues } from "@/lib/sheet-columns";
import { formatCtn } from "@/lib/format";

/*
 * 간편등록: 직원 카톡 판매보고 → 분석 → 검수 → 장표 한 행.
 * 화면(분석·검수)과 서버(저장 전 재검증)가 이 파일을 함께 쓴다.
 * 규칙은 점장이 확정한 업무 규칙만 따른다. 애매하면 "확인 필요"로 막는다.
 */

/** 직원용 보고 양식 (띄어쓰기·줄 순서 그대로 복사된다) */
export const STAFF_REPORT_TEMPLATE = [
  "개통일자 : ",
  "직원명 : ",
  "고객명 : ",
  "실력지표제외 :",
  "CTN : ",
  "개통구분 :",
  "모델명 : ",
  "요금제 :",
  "ㄴ유지/변경 : ",
  "",
  "정책 ",
  "ㄴ고객혜택 : ",
  "ㄴ그외(스팟제외) :",
  "ㄴ2ND연계정책 : ",
  "",
  "정책사용",
  "ㄴ추가지원금 : ",
  "ㄴ고혜(기존할부금) : ",
  "ㄴ고혜(요금) : ",
  "",
  "2ND : ",
  "ㄴ고객혜택 : ",
  "ㄴ자부담 : ",
  "사은품판매or수령 : ",
  "",
  "디초/삼초 : ",
  "ㄴ고객혜택 : ",
  "사은품판매or수령 : ",
  "",
  "중고폰&현물 판매 : ",
  "ㄴ판매금액 : ",
  "ㄴ사용금액 : ",
  "ㄴ어디에 : ",
  "",
  "제카 : ",
  "보험 : ",
  "부가 : ",
  "동판 : ",
  "ㄴ가능일 : ",
  "",
  "고객약속사항 :",
].join("\n");

/** 양식 항목. column 이 없으면 장표에 저장하지 않는 참고 항목 */
export const QUICK_FIELDS = [
  { id: "activatedAt", label: "개통일자", column: "activatedAt" },
  { id: "staff", label: "직원명", column: "staff" },
  { id: "customer", label: "고객명", column: "customer" },
  { id: "excludeIndicator", label: "실력지표제외", column: "excludeIndicator" },
  { id: "ctn", label: "CTN", column: "ctn" },
  { id: "category", label: "개통구분", column: "category" },
  { id: "model", label: "모델명", column: "model" },
  { id: "plan", label: "요금제", column: "plan" },
  { id: "planChange", label: "요금제 → 유지/변경", column: "planChange" },
  { id: "policyBenefit", label: "정책 → 고객혜택", column: "customerBenefit" },
  { id: "policyOther", label: "정책 → 그외(스팟제외)", column: "modelPolicy" },
  {
    id: "policySecond",
    label: "정책 → 2ND연계정책",
    column: "securedSecond",
  },
  { id: "useExtraSupport", label: "정책사용 → 추가지원금", column: "usedExtraSupport" },
  { id: "useInstallment", label: "정책사용 → 고혜(기존할부금)", column: null },
  { id: "usePlan", label: "정책사용 → 고혜(요금)", column: null },
  // 2ND 첫 줄: 내용이 있으면 AD = O, 공란·X 면 AD = X. 적은 글자(예: 워치)는 참고내용으로도 보관
  { id: "second", label: "2ND", column: "secondPerformance" },
  { id: "secondBenefit", label: "2ND → 고객혜택", column: "usedSecond" },
  { id: "secondSelfPay", label: "2ND → 자부담", column: null },
  { id: "secondGift", label: "2ND → 사은품판매or수령", column: null },
  { id: "dicho", label: "디초/삼초", column: null },
  { id: "dichoBenefit", label: "디초/삼초 → 고객혜택", column: "usedDicho" },
  { id: "dichoGift", label: "디초/삼초 → 사은품판매or수령", column: null },
  // 중고폰&현물 판매: 무엇을 팔았는지 자유입력 (참고용, 장표 저장 안 함)
  { id: "usedPhone", label: "중고폰&현물 판매", column: null },
  { id: "usedPhoneSaleAmount", label: "중고폰&현물 → 판매금액", column: "usedPhoneSale" },
  { id: "usedPhoneUse", label: "중고폰&현물 → 사용금액", column: "usedPhoneUsed" },
  // 어디에 사용했는지 메모 (참고용, 장표 저장 안 함)
  { id: "usedPhoneWhere", label: "중고폰&현물 → 어디에", column: null },
  { id: "jeca", label: "제카", column: "jeca" },
  { id: "insurance", label: "보험", column: "insurance" },
  { id: "addon", label: "부가", column: "addon" },
  { id: "dongpan", label: "동판", column: "dongpan" },
  { id: "availableDate", label: "동판 → 가능일", column: "wiredAvailableDate" },
  { id: "customerPromise", label: "고객약속사항", column: "customerPromise" },
] as const satisfies readonly {
  id: string;
  label: string;
  column: ColumnKey | null;
}[];

export type QuickFieldId = (typeof QUICK_FIELDS)[number]["id"];
export type QuickFields = Record<QuickFieldId, string>;

export function emptyQuickFields(): QuickFields {
  return Object.fromEntries(QUICK_FIELDS.map((f) => [f.id, ""])) as QuickFields;
}

/* ---------- 1) 붙여넣은 글 → 판매 건별 항목 ---------- */

/** 상위 항목 (양식의 "ㄴ" 없는 줄). children: "ㄴ" 하위 항목 */
const TOP_LEVEL: {
  key: string;
  id: QuickFieldId | null;
  children?: Record<string, QuickFieldId>;
}[] = [
  { key: "개통일자", id: "activatedAt" },
  { key: "직원명", id: "staff" },
  { key: "고객명", id: "customer" },
  { key: "실력지표제외", id: "excludeIndicator" },
  { key: "ctn", id: "ctn" },
  { key: "개통구분", id: "category" },
  { key: "모델명", id: "model" },
  { key: "요금제", id: "plan", children: { "유지/변경": "planChange" } },
  {
    key: "정책",
    id: null,
    // 항목명은 소문자로 비교한다 (2ND연계정책 → 2nd연계정책). 아래쪽 "2ND" 묶음과는 다른 항목
    children: {
      고객혜택: "policyBenefit",
      "그외(스팟제외)": "policyOther",
      "2nd연계정책": "policySecond",
    },
  },
  {
    key: "정책사용",
    id: null,
    children: {
      추가지원금: "useExtraSupport",
      "고혜(기존할부금)": "useInstallment",
      "고혜(요금)": "usePlan",
    },
  },
  {
    key: "2nd",
    id: "second",
    children: {
      고객혜택: "secondBenefit",
      자부담: "secondSelfPay",
      사은품판매or수령: "secondGift",
    },
  },
  {
    key: "디초/삼초",
    id: "dicho",
    children: { 고객혜택: "dichoBenefit", 사은품판매or수령: "dichoGift" },
  },
  {
    key: "중고폰&현물판매",
    id: "usedPhone",
    children: {
      판매금액: "usedPhoneSaleAmount",
      사용금액: "usedPhoneUse",
      어디에: "usedPhoneWhere",
    },
  },
  {
    // 예전 양식("중고폰 반납", "중고폰 리본or폰삼")으로 보낸 보고도 같은 항목으로 읽는다
    key: "중고폰반납",
    id: "usedPhone",
    children: {
      판매금액: "usedPhoneSaleAmount",
      사용금액: "usedPhoneUse",
      어디에: "usedPhoneWhere",
    },
  },
  {
    key: "중고폰리본or폰삼",
    id: "usedPhone",
    children: {
      판매금액: "usedPhoneSaleAmount",
      사용: "usedPhoneUse",
      사용금액: "usedPhoneUse",
      어디에: "usedPhoneWhere",
    },
  },
  { key: "제카", id: "jeca" },
  { key: "보험", id: "insurance" },
  { key: "부가", id: "addon" },
  { key: "동판", id: "dongpan", children: { 가능일: "availableDate" } },
  { key: "고객약속사항", id: "customerPromise" },
];

/** "ㄴ" 없이 쓰지만 바로 위 2ND / 디초/삼초 묶음에 속하는 줄 */
const GROUP_SIBLING_KEYS = new Set(["사은품판매or수령"]);

function normalizeKey(key: string): string {
  return key.replace(/\s+/g, "").toLowerCase();
}

/** ":" 없는 줄에서 알려진 항목명으로 시작하면 [항목, 값] (가장 긴 항목명 우선) */
function splitKeyValue(
  body: string,
  keys: readonly string[],
): [string, string] | null {
  let best: [string, string] | null = null;
  for (const raw of keys) {
    const key = normalizeKey(raw);
    const pattern = [...key]
      .map((ch) => ch.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&"))
      .join("\\s*");
    const m = body.match(new RegExp(`^${pattern}(?:\\s+(.*))?$`, "i"));
    if (m && (!best || key.length > best[0].length)) {
      best = [key, (m[1] ?? "").trim()];
    }
  }
  return best;
}

export interface QuickReport {
  fields: QuickFields;
  /** 양식에 없는 줄 (참고용) */
  unknownLines: string[];
  /** 같은 항목이 두 번 나온 경우 (나중 값은 무시하고 확인 필요) */
  repeatedFields: QuickFieldId[];
  /** 이 판매 건의 원문 */
  raw: string;
}

/** 카톡 복사 시 붙는 "[이름] [오후 3:21]" 같은 앞부분 제거 */
function stripChatPrefix(line: string): string {
  return line.replace(/^\s*\[[^\]]*\]\s*\[[^\]]*\]\s*/, "");
}

/** 여러 판매 건이 붙은 글을 "개통일자 :" 줄마다 나눠 분석한다 */
export function parseQuickReports(text: string): QuickReport[] {
  const reports: QuickReport[] = [];
  let current: QuickReport | null = null;
  let parent: (typeof TOP_LEVEL)[number] | null = null;
  let lastField: QuickFieldId | null = null;
  let rawLines: string[] = [];

  const finish = () => {
    if (current) {
      current.raw = rawLines.join("\n").trim();
      reports.push(current);
    }
  };

  const set = (report: QuickReport, id: QuickFieldId, value: string) => {
    if (report.fields[id] !== "" || report.repeatedFields.includes(id)) {
      // 이미 값이 있는 항목이 또 나오면 덮어쓰지 않고 확인 필요로 표시
      if (value !== "" && !report.repeatedFields.includes(id)) {
        report.repeatedFields.push(id);
      }
      return;
    }
    report.fields[id] = value;
  };

  for (const original of text.replace(/\r\n?/g, "\n").split("\n")) {
    const line = stripChatPrefix(original).replace(/：/g, ":");
    const trimmed = line.trim();
    if (!trimmed) {
      if (current) rawLines.push("");
      continue;
    }

    const isChild = /^(ㄴ|└)/.test(trimmed);
    const body = isChild ? trimmed.replace(/^(ㄴ|└)\s*/, "") : trimmed;
    const colon = body.indexOf(":");
    let key = normalizeKey(colon >= 0 ? body.slice(0, colon) : body);
    let value = colon >= 0 ? body.slice(colon + 1).trim() : "";
    if (colon < 0) {
      // ":" 없이 "ㄴ고객혜택 30만" 처럼 쓴 줄도 항목명 + 값으로 나눈다
      const candidates = isChild
        ? Object.keys(parent?.children ?? {})
        : [
            ...TOP_LEVEL.map((t) => t.key),
            ...[...GROUP_SIBLING_KEYS].filter((k) => parent?.children?.[k]),
          ];
      const split = splitKeyValue(body, candidates);
      // 고객약속사항 다음 줄들은 내용이 이어지는 것으로 본다 (새 판매 건 시작만 예외)
      if (
        split &&
        (lastField !== "customerPromise" || split[0] === "개통일자")
      ) {
        [key, value] = split;
      }
    }

    // "개통일자" 줄이 나오면 새 판매 건 시작
    if (!isChild && key === "개통일자") {
      finish();
      current = {
        fields: emptyQuickFields(),
        unknownLines: [],
        repeatedFields: [],
        raw: "",
      };
      rawLines = [];
    }
    if (!current) continue; // 첫 판매 건 앞의 글(인사말 등)은 무시
    rawLines.push(original);

    if (isChild || (GROUP_SIBLING_KEYS.has(key) && parent?.children?.[key])) {
      const childId = parent?.children?.[key];
      if (childId) {
        set(current, childId, value);
        lastField = childId;
      } else {
        current.unknownLines.push(trimmed);
        lastField = null;
      }
      continue;
    }

    const top = TOP_LEVEL.find((t) => normalizeKey(t.key) === key);
    if (top) {
      parent = top;
      if (top.id) set(current, top.id, value);
      lastField = top.id;
      continue;
    }

    // 고객약속사항이 여러 줄이면 이어 붙인다
    if (lastField === "customerPromise" && colon < 0) {
      current.fields.customerPromise = current.fields.customerPromise
        ? `${current.fields.customerPromise}\n${trimmed}`
        : trimmed;
      continue;
    }
    current.unknownLines.push(trimmed);
  }
  finish();
  return reports;
}

/* ---------- 2) 값 변환·검증 ---------- */

export interface QuickIssue {
  field: QuickFieldId;
  message: string;
}

export interface QuickNormalized {
  /** 장표에 저장할 값 (없는 키는 장표 칸을 건드리지 않음) */
  row: SheetRowValues;
  /** 등록을 막는 문제 */
  issues: QuickIssue[];
  /** 항목별로 변환된 값 (화면 표시용) */
  display: Partial<Record<QuickFieldId, string>>;
  /** 중복 확인용 "개통일|CTN숫자" (개통일·CTN 이 정상일 때만) */
  duplicateKey: string | null;
  /**
   * 장표에 저장하지 않는 참고 항목(column: null) 중 직원이 실제로 적은 것.
   * 장표 A~AL 이 아니라 Apps Script 의 숨김 보조 시트 "웹앱참고" 에 판매 건별로 보관한다.
   */
  notes: SaleNotes;
}

/** 참고 항목 id → 직원이 적은 원문 */
export type SaleNotes = Partial<Record<QuickFieldId, string>>;

/**
 * 참고내용으로 보관하는 항목: 장표 저장 안 함(참고) 항목 + 2ND 첫 줄 원문
 * (2ND 는 장표 AD 에 O/X 만 저장되므로, 직원이 적은 글자는 참고내용으로 따로 남긴다)
 */
export const NOTE_FIELDS = QUICK_FIELDS.filter(
  (f) => f.column === null || f.id === "second",
);

export function quickNotes(fields: QuickFields): SaleNotes {
  const notes: SaleNotes = {};
  for (const { id } of NOTE_FIELDS) {
    const value = fields[id].trim();
    if (value) notes[id] = value.slice(0, 500);
  }
  return notes;
}

export interface QuickContext {
  /** 오늘 날짜 (한국 시간, YYYY-MM-DD) — 연도와 저장 대상 월 판단에 사용 */
  today: string;
  staffNames: readonly string[];
}

/** 금액: "30만" → 300000, "15000원" → 15000, "300,000원" → 300000. 애매하면 error */
export function parseAmount(
  raw: string,
): { value: number | null } | { error: string } {
  const s = raw.replace(/\s+/g, "").replace(/,/g, "");
  if (s === "") return { value: null };
  if (/^(x|-|없음)$/i.test(s)) return { value: null };
  const man = s.match(/^(\d+(?:\.\d+)?)만(원)?$/);
  if (man) {
    const value = Math.round(Number(man[1]) * 10000);
    if (Math.abs(value - Number(man[1]) * 10000) > 1e-6) {
      return { error: `금액 "${raw}" 를 확인해 주세요.` };
    }
    return { value };
  }
  const won = s.match(/^(\d+)(원)?$/);
  if (won) {
    const value = Number(won[1]);
    // "30" 처럼 단위 없이 작은 숫자는 30원인지 30만원인지 알 수 없다
    if (!won[2] && value > 0 && value < 1000) {
      return {
        error: `금액 "${raw}" 가 원 단위인지 만원 단위인지 확인해 주세요.`,
      };
    }
    return { value };
  }
  return { error: `금액 "${raw}" 를 읽을 수 없습니다.` };
}

function validDate(y: number, m: number, d: number): string | null {
  const date = new Date(Date.UTC(y, m - 1, d));
  if (
    date.getUTCFullYear() !== y ||
    date.getUTCMonth() !== m - 1 ||
    date.getUTCDate() !== d
  ) {
    return null;
  }
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** 개통일자 "10.03" (MM.DD) → 올해 날짜 */
export function parseActivatedAt(raw: string, today: string): string | null {
  const s = raw.replace(/\s+/g, "");
  // 월.일 (연도는 올해): 10.5 · 10.05 · 10/5 · 10-05
  const md = s.match(/^(\d{1,2})[./-](\d{1,2})\.?$/);
  if (md)
    return validDate(Number(today.slice(0, 4)), Number(md[1]), Number(md[2]));
  // 연.월.일: 2026-10-05 · 2026.10.5 · 2026/10/05 · 2026. 10. 5
  const ymd = s.match(/^(20\d{2})[./-](\d{1,2})[./-](\d{1,2})\.?$/);
  if (ymd) return validDate(Number(ymd[1]), Number(ymd[2]), Number(ymd[3]));
  return null;
}

/**
 * 동판 가능일 (년.월, 일은 쓰지 않음) → "YY.MM"
 *   "27.03" / "27.3" / "2027.03" / "27-3" → "27.03". 월은 1~12만.
 */
export function parseAvailableMonth(raw: string): string | null {
  const s = raw.replace(/\s+/g, "");
  const ym = s.match(/^(\d{2}|20\d{2})[./-](\d{1,2})\.?$/);
  if (!ym) return null;
  const month = Number(ym[2]);
  if (month < 1 || month > 12) return null;
  return `${ym[1].slice(-2)}.${String(month).padStart(2, "0")}`;
}

/** 동판 저장값: 빈칸·x → "X", 그 외 글자는 그대로 */
export function normalizeDongpan(raw: string): string {
  const value = raw.trim();
  return value === "" || value.toUpperCase() === "X" ? "X" : value;
}

/** 가능일은 동판이 X 이거나 빈칸일 때만 입력할 수 있다 */
export function availableDateAllowed(dongpanRaw: string): boolean {
  return normalizeDongpan(dongpanRaw) === "X";
}

const CATEGORY_MAP: Record<string, string> = {
  기변: "기기변경",
  기기변경: "기기변경",
  번이: "번호이동",
  번호이동: "번호이동",
  신규: "신규",
};

/** UMNP: 대소문자 구분 없이 인식하고 장표에는 "UMNP" 로 저장 */
const UMNP = "UMNP";

/**
 * 개통구분 값 → 표준값 ("기기변경" / "번호이동" / "신규" / "UMNP"), 모르는 값은 null.
 * 간편등록 normalizeQuick 의 개통구분 규칙과 같다 (집계 화면에서 장표 값을 읽을 때 사용).
 */
export function normalizeCategory(raw: string): string | null {
  const key = raw.replace(/\s+/g, "");
  if (key.toUpperCase() === UMNP) return UMNP;
  return Object.prototype.hasOwnProperty.call(CATEGORY_MAP, key)
    ? CATEGORY_MAP[key]
    : null;
}

function ox(raw: string): "O" | "X" | null {
  const s = raw.trim().toUpperCase();
  return s === "O" || s === "X" ? s : null;
}

export function normalizeQuick(
  fields: QuickFields,
  ctx: QuickContext,
): QuickNormalized {
  const issues: QuickIssue[] = [];
  const display: Partial<Record<QuickFieldId, string>> = {};
  const row: SheetRowValues = {};
  const v = (id: QuickFieldId) => fields[id].trim();
  const need = (id: QuickFieldId, label: string) => {
    if (!v(id))
      issues.push({ field: id, message: `${label}이(가) 비어 있습니다.` });
    return !!v(id);
  };

  // 개통일자 (MM.DD, 올해) — 저장 대상 월(이번 달)과 다르면 등록하지 않는다
  let activatedAt: string | null = null;
  if (need("activatedAt", "개통일자")) {
    activatedAt = parseActivatedAt(v("activatedAt"), ctx.today);
    if (!activatedAt) {
      issues.push({
        field: "activatedAt",
        message: `개통일자 "${v("activatedAt")}" 를 확인해 주세요. (예: 10.03, 10/3, 2026-10-03)`,
      });
    } else {
      display.activatedAt = activatedAt;
      if (activatedAt.slice(0, 7) !== ctx.today.slice(0, 7)) {
        issues.push({
          field: "activatedAt",
          message: `개통월 확인 필요: ${Number(activatedAt.slice(5, 7))}월 개통은 이번 달(${Number(ctx.today.slice(5, 7))}월) 시트에 등록할 수 없습니다.`,
        });
      } else {
        row.activatedAt = activatedAt;
      }
    }
  }

  if (need("staff", "직원명")) {
    if (ctx.staffNames.includes(v("staff"))) {
      row.staff = v("staff");
      display.staff = v("staff");
    } else {
      issues.push({
        field: "staff",
        message: `등록되지 않은 직원명입니다: ${v("staff")}`,
      });
    }
  }

  if (need("customer", "고객명")) {
    if (v("customer").length > 50) {
      issues.push({ field: "customer", message: "고객명이 너무 깁니다." });
    } else {
      row.customer = v("customer");
      display.customer = v("customer");
    }
  }

  // 실력지표제외: O/X. 공란이면 X 로 저장
  if (!v("excludeIndicator")) {
    row.excludeIndicator = "X";
    display.excludeIndicator = "X (공란 → X)";
  } else {
    const value = ox(v("excludeIndicator"));
    if (value) {
      row.excludeIndicator = value;
      display.excludeIndicator = value;
    } else {
      issues.push({
        field: "excludeIndicator",
        message: "실력지표제외는 O 또는 X 만 가능합니다.",
      });
    }
  }

  let ctnDigits: string | null = null;
  if (need("ctn", "CTN")) {
    const digits = v("ctn").replace(/[\s-]/g, "");
    if (/^01[016789]\d{7,8}$/.test(digits)) {
      ctnDigits = digits;
      row.ctn = formatCtn(digits);
      display.ctn = formatCtn(digits);
    } else {
      issues.push({
        field: "ctn",
        message: `CTN "${v("ctn")}" 형식을 확인해 주세요.`,
      });
    }
  }

  if (need("category", "개통구분")) {
    const key = v("category").replace(/\s+/g, "");
    const value =
      key.toUpperCase() === UMNP ? UMNP : CATEGORY_MAP[key];
    if (value) {
      row.category = value;
      display.category = value;
    } else {
      issues.push({
        field: "category",
        message: "개통구분은 기변 / 번이 / 신규 / UMNP 중 하나여야 합니다.",
      });
    }
  }

  for (const [id, label, key] of [
    ["model", "모델명", "model"],
    ["plan", "요금제", "plan"],
  ] as const) {
    if (need(id, label)) {
      if (v(id).length > 100) {
        issues.push({ field: id, message: `${label}이 너무 깁니다.` });
      } else {
        row[key] = v(id);
        display[id] = v(id);
      }
    }
  }

  if (need("planChange", "유지/변경")) {
    if (v("planChange") === "유지" || v("planChange") === "변경") {
      row.planChange = v("planChange");
      display.planChange = v("planChange");
    } else {
      issues.push({
        field: "planChange",
        message: "유지/변경은 '유지' 또는 '변경' 이어야 합니다.",
      });
    }
  }

  // 장표에 저장하는 금액 (공란 칸의 "-" 와 합계는 아래 applyQuickColumnRules 가 열 위치 기준으로 채움)
  for (const id of [
    "policyBenefit",
    "policyOther",
    "policySecond",
    "dichoBenefit",
    "secondBenefit",
    "useExtraSupport", // W 추가지원금
  ] as const) {
    const parsed = parseAmount(fields[id]);
    const column = QUICK_FIELDS.find((f) => f.id === id)!.column as ColumnKey;
    if ("error" in parsed) {
      issues.push({ field: id, message: parsed.error });
    } else if (parsed.value !== null) {
      row[column] = parsed.value;
      display[id] = `${parsed.value.toLocaleString("ko-KR")}원`;
    }
  }

  // 중고폰&현물: 판매금액 → Z(중고판매 판매), 사용금액 → AA(중고판매 사용).
  // 기존 금액 규칙(parseAmount), 공란이면 "-" (V~AA 공란 규칙). AB = Z − AA 는 아래 applyQuickColumnRules.
  // "중고폰&현물 판매"(무엇을 팔았는지)와 "어디에"는 자유입력 참고용 — 검사하지 않고 장표에 저장하지 않는다.
  for (const [id, column] of [
    ["usedPhoneSaleAmount", "usedPhoneSale"],
    ["usedPhoneUse", "usedPhoneUsed"],
  ] as const) {
    const parsed = parseAmount(fields[id]);
    if ("error" in parsed) {
      issues.push({ field: id, message: parsed.error });
    } else if (parsed.value !== null) {
      row[column] = parsed.value;
      display[id] = `${parsed.value.toLocaleString("ko-KR")}원`;
    }
  }
  // 어디에: 참고용 메모 (장표 저장 안 함, 화면 표시만)

  // 2ND(AD): 첫 번째 "2ND :" 값만 본다 (하위 항목 고객혜택·자부담·사은품은 보지 않음).
  // 내용이 있으면 O, 공란이거나 X(대소문자·앞뒤 공백 무관)면 X
  {
    const second = v("second");
    const value = second === "" || second.toUpperCase() === "X" ? "X" : "O";
    row.secondPerformance = value;
    display.second = second && value === "O" ? `O (${second})` : "X";
  }

  // 제카: 비어 있거나 X → 제카·종류·카드실적 검수 모두 X / 카드 종류 → O·종류·검수 칸은 비워 둠
  const jeca = v("jeca");
  if (jeca === "" || jeca.toUpperCase() === "X") {
    row.jeca = "X";
    row.cardType = "X";
    row.cardChecked = "X";
    display.jeca = "X (카드 없음)";
  } else if (jeca.toUpperCase() === "O") {
    issues.push({
      field: "jeca",
      message: "제카에는 카드 종류(예: 우리, 신한) 또는 X 를 적어 주세요.",
    });
  } else if (jeca.length > 30) {
    issues.push({ field: "jeca", message: "카드 종류가 너무 깁니다." });
  } else {
    row.jeca = "O";
    row.cardType = jeca;
    display.jeca = `O · ${jeca}`;
  }

  // 보험: O/X, 비어 있으면 X
  const insurance = v("insurance") ? ox(v("insurance")) : "X";
  if (insurance) {
    row.insurance = insurance;
    display.insurance = insurance;
  } else {
    issues.push({
      field: "insurance",
      message: "보험은 O 또는 X 만 가능합니다.",
    });
  }

  // 부가: 필L/필S, 비어 있으면 X
  const addonRaw = v("addon").replace(/\s+/g, "").toUpperCase();
  const addon =
    addonRaw === "" || addonRaw === "X"
      ? "X"
      : addonRaw === "필L"
        ? "필L"
        : addonRaw === "필S"
          ? "필S"
          : null;
  if (addon) {
    row.addon = addon;
    display.addon = addon;
  } else {
    issues.push({
      field: "addon",
      message: "부가는 필L 또는 필S 만 가능합니다.",
    });
  }

  // 동판: 자유입력. 입력한 글자를 그대로 AK열에 저장하고, 공란이면 X 로 저장한다.
  // 가능일(년.월): 동판이 X(또는 공란)일 때만 입력 가능. 적으면 YY.MM, 공란이면 X.
  // 동판에 X 이외의 글자가 있으면 가능일은 입력 불가 → AL열 X.
  const dongpan = normalizeDongpan(v("dongpan"));
  row.dongpan = dongpan;
  display.dongpan = dongpan;
  if (!availableDateAllowed(fields.dongpan) || !v("availableDate")) {
    row.wiredAvailableDate = "X";
    display.availableDate = "X";
  } else {
    const month = parseAvailableMonth(v("availableDate"));
    if (month) {
      // 앞의 ' 는 구글 시트가 27.03 을 숫자(27.03)·날짜로 바꾸지 않고 글자 그대로 두게 한다
      row.wiredAvailableDate = `'${month}`;
      display.availableDate = month;
    } else {
      issues.push({
        field: "availableDate",
        message: `가능일 "${v("availableDate")}" 를 확인해 주세요. 년.월로 입력해 주세요. (예: 27.03)`,
      });
    }
  }

  if (v("customerPromise")) {
    if (fields.customerPromise.length > 500) {
      issues.push({
        field: "customerPromise",
        message: "고객약속사항이 너무 깁니다.",
      });
    } else {
      row.customerPromise = fields.customerPromise.trim();
      display.customerPromise = fields.customerPromise.trim();
    }
  }

  return {
    row: applyQuickColumnRules(row),
    issues,
    display,
    duplicateKey:
      activatedAt && ctnDigits ? `${activatedAt}|${ctnDigits}` : null,
    notes: quickNotes(fields),
  };
}

/* ---------- 3) 신규 저장 시 열 위치 기준 기본값·합계 ---------- */

/** 금액 칸 숫자 (없음·"-"·숫자가 아님 → 0). 판매 수정의 AB·AC 재계산도 이 함수를 그대로 쓴다. */
export function amountOf(value: SheetRowValues[ColumnKey]): number {
  if (typeof value === "number") return value;
  const t = String(value ?? "")
    .replace(/[,\s]/g, "")
    .replace(/원$/, "");
  return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : 0;
}

const EMPTY = (v: SheetRowValues[ColumnKey]) =>
  v === undefined || v === null || String(v).trim() === "";

/**
 * 간편등록 신규 저장 행에 장표 열 위치 기준 규칙을 적용한다 (항목 이름이 아니라 열 위치 기준).
 *   G·H              → X (검수·수납은 신규 등록 시 항상 X)
 *   O~T              → 값이 없으면 "-",  N = O+P+Q+R+S+T
 *   V~AA             → 값이 없으면 "-",  U = V+W+X+Y (Z·AA 제외)
 *   AB = Z − AA,  AC = N + U + AB   ("-"·빈칸은 0 으로 계산, AB 가 음수여도 0 으로 바꾸지 않음)
 *   AD~AG, AI·AJ     → 값이 없으면 X
 *   AH·AK·AL 및 그 밖의 칸은 기존 규칙 그대로 (여기서 바꾸지 않음)
 */
export function applyQuickColumnRules(input: SheetRowValues): SheetRowValues {
  const row: SheetRowValues = { ...input };
  row.inspected = "X"; // G
  row.paid = "X"; // H
  const dash = (keys: readonly ColumnKey[]) => {
    for (const key of keys) if (EMPTY(row[key])) row[key] = "-";
  };
  const xIfEmpty = (keys: readonly ColumnKey[]) => {
    for (const key of keys) if (EMPTY(row[key])) row[key] = "X";
  };
  const sum = (keys: readonly ColumnKey[]) =>
    keys.reduce((total, key) => total + amountOf(row[key]), 0);

  const OT = [
    "spot",
    "securedDicho",
    "appleMania",
    "securedSecond",
    "modelPolicy",
    "customerBenefit",
  ] as const; // O P Q R S T
  const VY = [
    "usedModelPlan",
    "usedExtraSupport",
    "usedDicho",
    "usedSecond",
  ] as const; // V W X Y
  dash(OT);
  dash([...VY, "usedPhoneSale", "usedPhoneUsed"]); // V~AA
  row.securedTotal = sum(OT); // N
  row.usedTotal = sum(VY); // U
  row.usedPhoneRemaining =
    amountOf(row.usedPhoneSale) - amountOf(row.usedPhoneUsed); // AB = Z − AA
  row.finalTotal =
    amountOf(row.securedTotal) +
    amountOf(row.usedTotal) +
    amountOf(row.usedPhoneRemaining); // AC = N + U + AB
  xIfEmpty(["secondPerformance", "jeca", "cardType", "cardChecked"]); // AD~AG
  xIfEmpty(["addon", "insurance"]); // AI·AJ
  return row;
}

/** 장표 판매 1건의 중복 확인 키 */
export function saleDuplicateKey(activatedAt: string, ctn: string): string {
  return `${activatedAt}|${ctn.replace(/\D/g, "")}`;
}
