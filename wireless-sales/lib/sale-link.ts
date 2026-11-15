/*
 * 판매연결 정보 — 판매 1건에 붙는 유입경로·캠페인·굿바이와 향후 가망고객관리 연동 값.
 *
 * 저장: 운영 무선장표의 숨김 보조 시트 "웹앱판매연결" (Apps Script sale-link.gs). 월 시트 열은 바꾸지 않는다.
 * 연결: 판매 고유 ID(saleId)로만 연결한다. saleId 는 그 판매 행의 C열(개통일) 셀 메모에
 *       "웹앱판매ID: <ID>" 줄로 들어 있어, 웹앱이 판매를 정렬해 옮겨도 판매를 따라간다.
 *       (예전 "웹앱참고" 의 개통일·CTN·고객명 키와 달리, 같은 날 같은 고객 판매가 2건이어도 각각 구분된다)
 * 같은 saleId 가 두 행에 있으면(시트에서 행 복사 등) 둘 다 "ID 중복 — 확인 필요"로 표시하고 연결·저장하지 않는다.
 */

import {
  DEFAULT_INFLOW_OPTIONS,
  INFLOW_MISSING,
  INFLOW_RAW_MAX,
  inflowGroup,
  isSelectableInflow,
  resolveInflow,
  selectableInflows,
  type InflowOption,
} from "@/lib/inflow-options";
import { CAMPAIGN_ID_RE } from "@/lib/campaigns";

export { INFLOW_MISSING };

/** 기본 유입경로 선택값 (항목 시트가 없을 때) — 네이버·자점·TM·내방·외부영업 + 미확인 */
export const INFLOW_SOURCES: readonly string[] = selectableInflows(DEFAULT_INFLOW_OPTIONS);

export const CAMPAIGN_MAX = 40;
export const PROSPECT_ID_MAX = 40;

/** 카톡 보고에 적힌 표현 → 기본 항목 이름. 모르는 표현은 null (추정하지 않음) */
export function parseInflow(raw: string, options: readonly InflowOption[] = DEFAULT_INFLOW_OPTIONS): string | null {
  const r = resolveInflow(raw, options);
  return r.kind === "match" ? r.name : null;
}

export function isInflowSource(value: unknown, options: readonly InflowOption[] = DEFAULT_INFLOW_OPTIONS): value is string {
  return typeof value === "string" && value.trim() !== "" && isSelectableInflow(value, options);
}

/** 판매연결 값 (모두 글자, 없으면 "") */
export interface SaleLink {
  /** 유입경로 항목 이름 ("" = 미입력 또는 확인 필요) */
  inflow: string;
  /** 캠페인: 직원이 보고한 원문 (목록과 맞으면 campaignId 도 있음) */
  campaign: string;
  /** 리본 "O" / "X" / "" (저장 칸 이름은 예전 그대로 goodbye) */
  goodbye: string;
  /** 향후 가망고객관리 연동 (지금은 저장 구조만) */
  prospectId: string;
  tmStaffId: string;
  /** 저장 당시 판매 직원 ID (M열 직원명 → lib/data/staff-list.ts 의 ID). 이름 변경·퇴사 후에도 유지 */
  staffId: string;
  /** 캠페인 목록의 캠페인ID (CMP-0001). "" = 캠페인 없음 또는 확인 필요 */
  campaignId: string;
  /** 리본 값의 방식: 자동(중고폰&현물 판매로 판정) / 수동(점장이 고름) / "" */
  ribbonMode: string;
  /** 유입경로를 목록에서 찾지 못했을 때의 카톡 원문 (확인 필요) */
  inflowRaw: string;
  /** 간편등록 요청 ID (같은 요청 재전송 시 판매 중복 방지) — 화면에서 바꾸지 않음 */
  requestId: string;
}
export const SALE_LINK_FIELDS = ["inflow", "campaign", "goodbye", "prospectId", "tmStaffId", "campaignId", "ribbonMode", "inflowRaw"] as const;
export type SaleLinkField = (typeof SALE_LINK_FIELDS)[number];

export function emptyLink(): SaleLink {
  return { inflow: "", campaign: "", goodbye: "", prospectId: "", tmStaffId: "", staffId: "", campaignId: "", ribbonMode: "", inflowRaw: "", requestId: "" };
}

/**
 * saleId 상태: ok = 이 판매만 가진 ID / none = 아직 ID 없음(예전 판매) / duplicate = 같은 ID 가 다른 행에도 있음
 * mismatch = 판매연결 기록의 확인값(개통일+CTN)이 이 행과 다름 (장표에서 값만 옮긴 경우 등) — 연결 정보를 붙이지 않음
 */
export type SaleIdState = "ok" | "none" | "duplicate" | "mismatch";

/** 한 항목 값 검사. 문제가 있으면 안내 문구 (Apps Script sale-link.gs wsLinkValueError_ 와 같은 기준) */
export function linkValueError(
  field: SaleLinkField,
  value: string,
  options: readonly InflowOption[] = DEFAULT_INFLOW_OPTIONS,
): string | null {
  const v = value.trim();
  if (!v) return null;
  if (field === "inflow") return isSelectableInflow(v, options) ? null : "유입경로는 목록에서 골라 주세요.";
  if (field === "goodbye") return v === "O" || v === "X" ? null : "리본은 O 또는 X 로 입력해 주세요.";
  if (field === "campaign") return v.length <= CAMPAIGN_MAX ? null : `캠페인명은 ${CAMPAIGN_MAX}자 이내로 입력해 주세요.`;
  if (field === "prospectId") return v.length <= PROSPECT_ID_MAX && /^[\w-]+$/.test(v) ? null : "가망고객 ID 형식이 올바르지 않습니다.";
  if (field === "tmStaffId") return /^st-\d{3}$/.test(v) ? null : "TM 발굴 직원 ID 형식이 올바르지 않습니다.";
  if (field === "campaignId") return CAMPAIGN_ID_RE.test(v) ? null : "캠페인 ID 형식이 올바르지 않습니다.";
  if (field === "ribbonMode") return v === "자동" || v === "수동" ? null : "리본 방식이 올바르지 않습니다.";
  if (field === "inflowRaw") return v.length <= INFLOW_RAW_MAX ? null : `유입경로 원문은 ${INFLOW_RAW_MAX}자까지 보관합니다.`;
  return null;
}

/** 분석용 유입경로 분류 (미입력·미확인·확인 필요·기존값 구분 — lib/inflow-options.ts inflowGroup) */
export function inflowOf(sale: { link?: SaleLink }, options: readonly InflowOption[] = DEFAULT_INFLOW_OPTIONS): string {
  return inflowGroup(sale.link, options);
}
