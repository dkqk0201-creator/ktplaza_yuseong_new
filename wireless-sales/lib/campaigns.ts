/*
 * 캠페인 (매장 행사·신제품 사전예약 등) — 2026-11-15 확정
 *
 * 저장: 운영 무선장표의 숨김 보조 시트 "웹앱캠페인" (변경 이력 "웹앱캠페인이력", Apps Script config-handler.gs).
 * 판매연결("웹앱판매연결")에는 직원이 보고한 캠페인 원문(캠페인 칸)과, 목록과 맞춘 캠페인ID(캠페인ID 칸)를 함께 둔다.
 *   - 이름을 바꿔도 캠페인ID 로 연결되므로 판매 연결이 유지된다.
 *   - 보고의 "캠페인 :" 값이 캠페인명·별칭과 정확히 같을 때만 연결한다 (띄어쓰기·대소문자 무시).
 *     행사 기간에 팔렸다는 이유만으로 연결하지 않는다. 날짜는 비교하지 않는다
 *     (사전예약 고객의 개통일이 행사 기간을 넘어도 연결되고, 종료된 캠페인도 사용 중이면 연결된다).
 *   - 빈칸·없음·x·- 는 캠페인 없음. 목록에 없는 이름은 원문만 보관하고 "확인 필요".
 */

export const CAMPAIGN_TYPES = ["매장 행사", "신제품 사전예약", "기타"] as const;
export type CampaignType = (typeof CAMPAIGN_TYPES)[number];
export const CAMPAIGN_STATUSES = ["예정", "진행", "종료"] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];
export const CAMPAIGN_NAME_MAX = 40;
export const CAMPAIGN_ALIAS_MAX = 40;
export const CAMPAIGN_ID_RE = /^CMP-\d{4}$/;
/** 캠페인 없음으로 보는 표현 */
const NONE_WORDS = new Set(["", "없음", "x", "-", "없어요", "해당없음", "no", "none"]);

export interface Campaign {
  id: string;
  name: string;
  aliases: string[];
  type: CampaignType;
  /** yyyy-MM-dd (비어 있을 수 있음) */
  start: string;
  end: string;
  status: CampaignStatus;
  /** false = 사용 안 함 (새 판매에 연결 안 함, 과거 연결·조회는 그대로) */
  active: boolean;
  updatedAt?: string;
}

/** 비교용: 띄어쓰기 없애고 소문자 */
export function campaignKey(text: string): string {
  return (text ?? "").replace(/\s+/g, "").toLowerCase();
}

export function isNoCampaign(raw: string): boolean {
  return NONE_WORDS.has(campaignKey(raw));
}

export type CampaignResolution =
  | { kind: "none" }
  | { kind: "match"; campaign: Campaign }
  | { kind: "check"; raw: string };

/** 보고 원문 → 캠페인. 사용 중인 캠페인의 이름·별칭과 정확히 같을 때만 */
export function resolveCampaign(raw: string, campaigns: readonly Campaign[]): CampaignResolution {
  const text = (raw ?? "").trim();
  if (isNoCampaign(text)) return { kind: "none" };
  const key = campaignKey(text);
  const found = campaigns.find((c) => c.active && (campaignKey(c.name) === key || c.aliases.some((a) => campaignKey(a) === key)));
  return found ? { kind: "match", campaign: found } : { kind: "check", raw: text.slice(0, CAMPAIGN_NAME_MAX) };
}

/** 판매 1건의 캠페인 상태 */
export type SaleCampaign =
  | { state: "none" }
  | { state: "linked"; id: string; name: string; campaign: Campaign | null }
  | { state: "check"; raw: string };

export function campaignOfLink(
  link: { campaign?: string; campaignId?: string } | undefined,
  campaigns: readonly Campaign[],
): SaleCampaign {
  const id = (link?.campaignId ?? "").trim();
  if (id) {
    const c = campaigns.find((x) => x.id === id) ?? null;
    return { state: "linked", id, name: c?.name ?? id, campaign: c };
  }
  const raw = (link?.campaign ?? "").trim();
  if (isNoCampaign(raw)) return { state: "none" };
  return { state: "check", raw };
}

/** 기간으로 제안하는 상태 (점장이 바꿀 수 있음). 시작일 전 예정, 종료일 지나면 종료, 그 사이 진행 */
export function suggestedStatus(start: string, end: string, today: string): CampaignStatus {
  if (start && today < start) return "예정";
  if (end && today > end) return "종료";
  return "진행";
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export interface CampaignInput {
  name: string;
  aliases: string[];
  type: string;
  start: string;
  end: string;
  status: string;
  active: boolean;
}

/** 캠페인 저장 전 검사 (점장 화면·서버 공통). others = 같은 목록의 다른 캠페인 */
export function campaignInputError(input: CampaignInput, others: readonly Campaign[]): string | null {
  const name = (input.name ?? "").trim();
  if (!name || name.length > CAMPAIGN_NAME_MAX) return `캠페인명은 1~${CAMPAIGN_NAME_MAX}자로 입력해 주세요.`;
  if (/[|]/.test(name)) return "캠페인명에 | 는 쓸 수 없습니다.";
  if (isNoCampaign(name)) return `"${name}" 은(는) 캠페인 없음으로 쓰는 표현이라 캠페인명으로 쓸 수 없습니다.`;
  if (!(CAMPAIGN_TYPES as readonly string[]).includes(input.type)) return "유형을 골라 주세요.";
  if (!(CAMPAIGN_STATUSES as readonly string[]).includes(input.status)) return "상태를 골라 주세요.";
  if (input.start && !DATE.test(input.start)) return "시작일 형식이 올바르지 않습니다.";
  if (input.end && !DATE.test(input.end)) return "종료일 형식이 올바르지 않습니다.";
  if (input.start && input.end && input.start > input.end) return "종료일이 시작일보다 빠릅니다.";
  if (input.aliases.length > 10) return "별칭은 10개까지 넣을 수 있습니다.";
  const mine = [name, ...input.aliases.map((a) => a.trim()).filter(Boolean)];
  for (const a of mine) {
    if (a.length > CAMPAIGN_ALIAS_MAX) return `별칭은 ${CAMPAIGN_ALIAS_MAX}자 이내로 입력해 주세요.`;
    if (/[,|]/.test(a) && a !== name) return "별칭에 쉼표(,)나 | 는 쓸 수 없습니다.";
    if (isNoCampaign(a)) return `"${a}" 은(는) 캠페인 없음으로 쓰는 표현이라 별칭으로 쓸 수 없습니다.`;
    const k = campaignKey(a);
    const clash = others.find((c) => campaignKey(c.name) === k || c.aliases.some((x) => campaignKey(x) === k));
    if (clash) return `"${a}" 은(는) 이미 "${clash.name}" 캠페인에서 쓰고 있습니다.`;
  }
  return null;
}

/** API·Apps Script 응답 → 캠페인 목록 (잘못된 값은 버림) */
export function parseCampaigns(value: unknown): Campaign[] {
  if (!Array.isArray(value)) return [];
  const out: Campaign[] = [];
  for (const raw of value.slice(0, 500)) {
    const r = (raw ?? {}) as Record<string, unknown>;
    const id = typeof r.id === "string" ? r.id.trim() : "";
    const name = typeof r.name === "string" ? r.name.trim() : "";
    if (!CAMPAIGN_ID_RE.test(id) || !name) continue;
    const type = (CAMPAIGN_TYPES as readonly string[]).includes(String(r.type)) ? (r.type as CampaignType) : "기타";
    const status = (CAMPAIGN_STATUSES as readonly string[]).includes(String(r.status)) ? (r.status as CampaignStatus) : "진행";
    const date = (v: unknown) => (typeof v === "string" && DATE.test(v) ? v : "");
    out.push({
      id,
      name: name.slice(0, CAMPAIGN_NAME_MAX),
      aliases: Array.isArray(r.aliases)
        ? r.aliases.filter((a): a is string => typeof a === "string").map((a) => a.trim()).filter(Boolean).slice(0, 10)
        : [],
      type,
      start: date(r.start),
      end: date(r.end),
      status,
      active: r.active !== false,
      ...(typeof r.updatedAt === "string" ? { updatedAt: r.updatedAt.slice(0, 20) } : {}),
    });
  }
  return out;
}

/** 캠페인 선택 목록 순서: 진행 → 예정 → 종료, 같은 상태는 시작일 최근 순 */
export function sortedCampaigns(campaigns: readonly Campaign[]): Campaign[] {
  const rank: Record<CampaignStatus, number> = { 진행: 0, 예정: 1, 종료: 2 };
  return [...campaigns].sort(
    (a, b) => rank[a.status] - rank[b.status] || (b.start || "").localeCompare(a.start || "") || a.name.localeCompare(b.name, "ko"),
  );
}
