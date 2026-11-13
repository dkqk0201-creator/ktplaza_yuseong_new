/*
 * 판매연결 정보 — 판매 1건에 붙는 유입경로·캠페인·굿바이와 향후 가망고객관리 연동 값.
 *
 * 저장: 운영 무선장표의 숨김 보조 시트 "웹앱판매연결" (Apps Script sale-link.gs). 월 시트 열은 바꾸지 않는다.
 * 연결: 판매 고유 ID(saleId)로만 연결한다. saleId 는 그 판매 행의 C열(개통일) 셀 메모에
 *       "웹앱판매ID: <ID>" 줄로 들어 있어, 웹앱이 판매를 정렬해 옮겨도 판매를 따라간다.
 *       (예전 "웹앱참고" 의 개통일·CTN·고객명 키와 달리, 같은 날 같은 고객 판매가 2건이어도 각각 구분된다)
 * 같은 saleId 가 두 행에 있으면(시트에서 행 복사 등) 둘 다 "ID 중복 — 확인 필요"로 표시하고 연결·저장하지 않는다.
 */

/** 유입경로 선택값 (한 판매에 대표 경로 1개) */
export const INFLOW_SOURCES = [
  "네이버 플레이스",
  "네이버 블로그",
  "네이버 예약",
  "인스타그램",
  "스레드",
  "지인 소개",
  "자점 단골 고객",
  "TM",
  "매장 문자",
  "자연 방문",
  "외부영업",
  "KT 안내",
  "기타",
  "미확인",
] as const;
export type InflowSource = (typeof INFLOW_SOURCES)[number];
/** 저장된 값이 없는 판매 (직접 고른 "미확인"과 구분) */
export const INFLOW_MISSING = "미입력";

export const CAMPAIGN_MAX = 40;
export const PROSPECT_ID_MAX = 40;

/** 카톡 보고에 적힌 표현 → 선택값 (띄어쓰기·대소문자 무시). 모르는 표현은 null (추정하지 않음) */
const INFLOW_ALIASES: Record<string, InflowSource> = {
  네이버플레이스: "네이버 플레이스",
  플레이스: "네이버 플레이스",
  스마트플레이스: "네이버 플레이스",
  네이버블로그: "네이버 블로그",
  블로그: "네이버 블로그",
  네이버예약: "네이버 예약",
  인스타그램: "인스타그램",
  인스타: "인스타그램",
  스레드: "스레드",
  쓰레드: "스레드",
  threads: "스레드",
  지인소개: "지인 소개",
  지인: "지인 소개",
  자점단골고객: "자점 단골 고객",
  자점단골: "자점 단골 고객",
  단골: "자점 단골 고객",
  단골고객: "자점 단골 고객",
  tm: "TM",
  매장문자: "매장 문자",
  문자: "매장 문자",
  자연방문: "자연 방문",
  워크인: "자연 방문",
  외부영업: "외부영업",
  kt안내: "KT 안내",
  기타: "기타",
  미확인: "미확인",
  모름: "미확인",
};

export function parseInflow(raw: string): InflowSource | null {
  const key = (raw ?? "").replace(/\s+/g, "").toLowerCase();
  if (!key) return null;
  return INFLOW_ALIASES[key] ?? null;
}

export function isInflowSource(value: unknown): value is InflowSource {
  return typeof value === "string" && (INFLOW_SOURCES as readonly string[]).includes(value);
}

/** 판매연결 값 (모두 글자, 없으면 "") */
export interface SaleLink {
  inflow: string;
  campaign: string;
  /** 굿바이 표시 "O" / "X" / "" (인정 기준 미확정 — 제안: O 표시만 실적) */
  goodbye: string;
  /** 향후 가망고객관리 연동 (지금은 저장 구조만) */
  prospectId: string;
  tmStaffId: string;
  /** 저장 당시 판매 직원 ID (M열 직원명 → lib/data/staff-list.ts 의 ID). 이름 변경·퇴사 후에도 유지 */
  staffId: string;
}
export const SALE_LINK_FIELDS = ["inflow", "campaign", "goodbye", "prospectId", "tmStaffId"] as const;
export type SaleLinkField = (typeof SALE_LINK_FIELDS)[number];

export function emptyLink(): SaleLink {
  return { inflow: "", campaign: "", goodbye: "", prospectId: "", tmStaffId: "", staffId: "" };
}

/** saleId 상태: ok = 이 판매만 가진 ID / none = 아직 ID 없음(예전 판매) / duplicate = 같은 ID 가 다른 행에도 있음 */
export type SaleIdState = "ok" | "none" | "duplicate";

/** 한 항목 값 검사. 문제가 있으면 안내 문구 */
export function linkValueError(field: SaleLinkField, value: string): string | null {
  const v = value.trim();
  if (!v) return null;
  if (field === "inflow") return isInflowSource(v) ? null : "유입경로는 목록에서 골라 주세요.";
  if (field === "goodbye") return v === "O" || v === "X" ? null : "굿바이는 O 또는 X 로 입력해 주세요.";
  if (field === "campaign") return v.length <= CAMPAIGN_MAX ? null : `캠페인명은 ${CAMPAIGN_MAX}자 이내로 입력해 주세요.`;
  if (field === "prospectId") return v.length <= PROSPECT_ID_MAX && /^[\w-]+$/.test(v) ? null : "가망고객 ID 형식이 올바르지 않습니다.";
  if (field === "tmStaffId") return /^st-\d{3}$/.test(v) ? null : "TM 발굴 직원 ID 형식이 올바르지 않습니다.";
  return null;
}

/** 분석용 유입경로 (저장 값이 없으면 "미입력") */
export function inflowOf(sale: { link?: SaleLink }): string {
  const v = sale.link?.inflow?.trim() ?? "";
  return v && isInflowSource(v) ? v : INFLOW_MISSING;
}

/** 판매들에 쓰인 캠페인명 (가나다순, 중복 없이) — 입력칸 추천 목록 */
export function usedCampaigns(sales: readonly { link?: SaleLink }[]): string[] {
  const set = new Set<string>();
  for (const s of sales) {
    const c = s.link?.campaign?.trim();
    if (c) set.add(c);
  }
  return [...set].sort((a, b) => a.localeCompare(b, "ko"));
}
