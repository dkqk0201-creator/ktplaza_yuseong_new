/*
 * 유입경로 항목 (2026-11-15 확정: 네이버 · 자점 · TM · 내방 · 외부영업 + 미확인)
 *
 * 항목 목록은 운영 무선장표의 숨김 보조 시트 "웹앱유입경로"에 있고(Apps Script config-handler.gs),
 * 점장이 유입·캠페인 분석 화면의 "항목 관리"에서 추가·비활성화한다. 시트가 없으면 아래 기본 5개를 쓴다.
 *   - 판매연결에는 항목 "이름"을 저장한다. 그래서 이름은 바꿀 수 없고(과거 연결이 깨짐) 비활성화 후 새로 추가한다.
 *   - 비활성 항목은 새 판매에 고를 수 없지만, 이미 저장된 판매의 집계에는 그대로 나온다.
 *   - "미확인"(직원·점장이 직접 고른 값)은 항목 목록과 별도로 항상 고를 수 있다.
 *
 * 분류 (화면·분석 공통)
 *   미입력     : 보고에 유입경로 줄이 없거나 빈칸 (저장값 없음, 원문도 없음)
 *   미확인     : "미확인"을 직접 고름
 *   확인 필요  : 무언가 적었지만 항목·별칭에 없음 (예: "인스타") — 원문만 보관, 임의로 분류하지 않음
 *   기존값     : 예전 14개 항목으로 저장된 값. 네이버 플레이스·블로그·예약 → 네이버, 자점 단골 고객 → 자점,
 *                자연 방문 → 내방 으로 묶어 집계하고, 나머지(인스타그램·스레드·지인 소개·매장 문자·KT 안내·기타)는
 *                "기존값 · 원래 이름" 그대로 둔다 (저장값은 바꾸지 않고 집계할 때만 묶음)
 */

export interface InflowOption {
  /** 항목 이름 (판매연결에 저장되는 값, 1~10자) */
  name: string;
  /** 카톡 보고에서 이 항목으로 알아볼 표현 (띄어쓰기·대소문자 무시) */
  aliases: string[];
  /** false = 비활성 (새 판매에 고를 수 없음, 과거 집계에는 나옴) */
  active: boolean;
  /** 화면 순서 (작을수록 앞) */
  order: number;
}

export const INFLOW_UNKNOWN = "미확인";
export const INFLOW_MISSING = "미입력";
export const INFLOW_CHECK = "확인 필요";
export const LEGACY_PREFIX = "기존값 · ";
export const INFLOW_NAME_MAX = 10;
export const INFLOW_ALIAS_MAX = 20;
export const INFLOW_OPTION_MAX = 20;
/** 판매연결에 보관하는 카톡 원문 최대 글자 수 */
export const INFLOW_RAW_MAX = 40;

export const DEFAULT_INFLOW_OPTIONS: readonly InflowOption[] = [
  { name: "네이버", aliases: ["네이버", "플레이스", "스마트플레이스", "네이버플레이스", "블로그", "네이버블로그", "네이버예약"], active: true, order: 1 },
  { name: "자점", aliases: ["자점", "단골", "자점단골", "자점단골고객", "단골고객", "기존고객"], active: true, order: 2 },
  { name: "TM", aliases: ["tm", "텔레마케팅"], active: true, order: 3 },
  { name: "내방", aliases: ["내방", "자연방문", "워크인"], active: true, order: 4 },
  { name: "외부영업", aliases: ["외부영업", "외부", "상가", "전단지"], active: true, order: 5 },
];

/** 예전 14개 항목 → 새 항목 (저장값은 그대로, 집계할 때만) */
export const LEGACY_INFLOW_MAP: Readonly<Record<string, string>> = {
  "네이버 플레이스": "네이버",
  "네이버 블로그": "네이버",
  "네이버 예약": "네이버",
  "자점 단골 고객": "자점",
  "자연 방문": "내방",
  TM: "TM",
  외부영업: "외부영업",
  미확인: INFLOW_UNKNOWN,
};
/** 예전 항목 중 새 항목으로 묶지 않는 것 (기존값 그대로) */
export const LEGACY_KEEP = ["인스타그램", "스레드", "지인 소개", "매장 문자", "KT 안내", "기타"] as const;

/** 비교용: 띄어쓰기 없애고 소문자 */
export function inflowKey(text: string): string {
  return (text ?? "").replace(/\s+/g, "").toLowerCase();
}

/** 화면 순서대로 정렬한 사본 */
export function sortedOptions(options: readonly InflowOption[]): InflowOption[] {
  return [...options].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, "ko"));
}

/** 새 판매에 고를 수 있는 이름 (사용 중 항목 + 미확인) */
export function selectableInflows(options: readonly InflowOption[]): string[] {
  return [...sortedOptions(options).filter((o) => o.active).map((o) => o.name), INFLOW_UNKNOWN];
}

export type InflowResolution =
  | { kind: "empty" }
  | { kind: "match"; name: string }
  | { kind: "check"; raw: string };

/**
 * 카톡 보고·입력칸 글자 → 항목. 사용 중 항목의 이름·별칭과 정확히 같을 때만 (띄어쓰기·대소문자 무시).
 * 모르는 표현·비활성 항목은 추정하지 않고 "확인 필요" (원문 보관). "미확인"·"모름"은 미확인.
 */
export function resolveInflow(raw: string, options: readonly InflowOption[]): InflowResolution {
  const text = (raw ?? "").trim();
  const key = inflowKey(text);
  if (!key) return { kind: "empty" };
  if (key === inflowKey(INFLOW_UNKNOWN) || key === "모름") return { kind: "match", name: INFLOW_UNKNOWN };
  for (const o of sortedOptions(options)) {
    if (!o.active) continue;
    if (inflowKey(o.name) === key || o.aliases.some((a) => inflowKey(a) === key)) return { kind: "match", name: o.name };
  }
  return { kind: "check", raw: text.slice(0, INFLOW_RAW_MAX) };
}

/** 저장할 수 있는 유입경로 값인지 (빈칸 = 지우기 허용) */
export function isSelectableInflow(value: string, options: readonly InflowOption[]): boolean {
  const v = (value ?? "").trim();
  return v === "" || selectableInflows(options).includes(v);
}

/**
 * 분석용 분류 (판매 1건). link 가 없거나 비었으면 "미입력", 원문만 있으면 "확인 필요".
 * 지금 항목(비활성 포함) → 그 이름 / 예전 14개 → 묶은 이름 또는 "기존값 · 이름" / 그 밖 → "기존값 · 이름"
 */
export function inflowGroup(
  link: { inflow?: string; inflowRaw?: string } | undefined,
  options: readonly InflowOption[] = DEFAULT_INFLOW_OPTIONS,
): string {
  const v = (link?.inflow ?? "").trim();
  if (!v) return (link?.inflowRaw ?? "").trim() ? INFLOW_CHECK : INFLOW_MISSING;
  if (v === INFLOW_UNKNOWN) return INFLOW_UNKNOWN;
  if (options.some((o) => o.name === v)) return v;
  const mapped = LEGACY_INFLOW_MAP[v];
  if (mapped) return mapped;
  return LEGACY_PREFIX + v;
}

/** 분류 표시 순서: 항목(순서대로) → 미확인 → 기존값 → 확인 필요 → 미입력. present 가 있으면 비활성·기존값은 판매가 있는 것만 */
export function inflowGroupOrder(options: readonly InflowOption[], present?: Iterable<string>): string[] {
  const seen = present ? new Set(present) : null;
  const sorted = sortedOptions(options);
  const names = sorted.filter((o) => o.active || !seen || seen.has(o.name)).map((o) => o.name);
  const legacy = seen ? [...seen].filter((g) => g.startsWith(LEGACY_PREFIX)).sort((a, b) => a.localeCompare(b, "ko")) : [];
  return [...names, INFLOW_UNKNOWN, ...legacy, INFLOW_CHECK, INFLOW_MISSING];
}

/** 항목 목록 저장 전 검사 (점장 화면·서버 공통). 문제가 있으면 안내 문구 */
export function inflowOptionsError(
  next: readonly InflowOption[],
  previous: readonly InflowOption[],
): string | null {
  if (next.length === 0 || next.length > INFLOW_OPTION_MAX) return `항목은 1~${INFLOW_OPTION_MAX}개까지 둘 수 있습니다.`;
  if (!next.some((o) => o.active)) return "사용 중인 항목이 하나 이상 있어야 합니다.";
  const names = new Set<string>();
  const aliasOwner = new Map<string, string>();
  for (const o of next) {
    const name = (o.name ?? "").trim();
    if (!name || name.length > INFLOW_NAME_MAX) return `항목 이름은 1~${INFLOW_NAME_MAX}자로 입력해 주세요.`;
    if (/[,|]/.test(name)) return "항목 이름에 쉼표(,)나 | 는 쓸 수 없습니다.";
    if ([INFLOW_UNKNOWN, INFLOW_MISSING, INFLOW_CHECK, "모름"].includes(name) || name.startsWith(LEGACY_PREFIX.trim()))
      return `"${name}" 은(는) 따로 쓰는 분류라 항목 이름으로 쓸 수 없습니다.`;
    if (names.has(inflowKey(name))) return `항목 이름 "${name}" 이(가) 두 번 있습니다.`;
    names.add(inflowKey(name));
    if (!Number.isInteger(o.order) || o.order < 1 || o.order > 999) return "순서는 1~999 사이 숫자여야 합니다.";
    if (o.aliases.length > 20) return `"${name}" 의 별칭이 너무 많습니다 (최대 20개).`;
    for (const a of [name, ...o.aliases]) {
      const k = inflowKey(a);
      if (!k) continue;
      if (a.length > INFLOW_ALIAS_MAX) return `별칭은 ${INFLOW_ALIAS_MAX}자 이내로 입력해 주세요.`;
      if (/[,|]/.test(a)) return "별칭에 쉼표(,)나 | 는 쓸 수 없습니다.";
      if (k === inflowKey(INFLOW_UNKNOWN) || k === "모름") return `"${a}" 은(는) 미확인으로 쓰는 표현이라 별칭으로 쓸 수 없습니다.`;
      const owner = aliasOwner.get(k);
      if (owner && owner !== name) return `"${a}" 이(가) "${owner}" 와 "${name}" 두 항목에 있습니다.`;
      aliasOwner.set(k, name);
    }
  }
  // 예전 항목은 지울 수 없다 (판매에 저장된 이름이므로 비활성화만)
  for (const p of previous) {
    if (!next.some((o) => o.name === p.name)) return `"${p.name}" 항목은 지울 수 없습니다. 사용 안 함으로 바꿔 주세요.`;
  }
  return null;
}

/** API·Apps Script 응답 → 항목 목록 (잘못된 값은 버림). 비어 있으면 null */
export function parseInflowOptions(value: unknown): InflowOption[] | null {
  if (!Array.isArray(value)) return null;
  const out: InflowOption[] = [];
  for (const raw of value.slice(0, INFLOW_OPTION_MAX)) {
    const r = (raw ?? {}) as Record<string, unknown>;
    const name = typeof r.name === "string" ? r.name.trim() : "";
    if (!name || name.length > INFLOW_NAME_MAX) continue;
    const aliases = Array.isArray(r.aliases)
      ? r.aliases.filter((a): a is string => typeof a === "string").map((a) => a.trim()).filter((a) => a && a.length <= INFLOW_ALIAS_MAX).slice(0, 20)
      : [];
    const order = Number(r.order);
    out.push({ name, aliases, active: r.active !== false, order: Number.isInteger(order) && order >= 1 && order <= 999 ? order : out.length + 1 });
  }
  return out.length > 0 ? out : null;
}
