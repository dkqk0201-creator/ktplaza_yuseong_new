import { emptyLink, type SaleLink, type SaleLinkField } from "@/lib/sale-link";
import { INFLOW_CHECK, inflowGroup, selectableInflows, type InflowOption } from "@/lib/inflow-options";
import { campaignOfLink, sortedCampaigns, type Campaign } from "@/lib/campaigns";
import { ribbonFromUsedPhone, ribbonModeFor, ribbonOf } from "@/lib/ribbon";
import type { SheetSale } from "@/lib/sheet-record";

/*
 * 판매 수정 화면의 판매연결(유입경로·캠페인·리본) — 판매 내용과 함께 한 번에 저장 (2026-11-15).
 * 화면은 이 파일로 입력칸 값·선택지·저장할 변경(patches)을 만들고, 서버·Apps Script 가 같은 기준으로 다시 검사한다.
 *
 * 리본 규칙
 *   - 점장이 리본을 직접 고르면 그 값 (방식: 자동판정과 같으면 자동, 다르면 수동)
 *   - 이번 수정에서 "중고폰&현물 판매" 내용을 바꾸고 리본은 건드리지 않았으면:
 *       저장된 방식이 수동이 아니면 새 내용으로 다시 판정 (예: 리본예정 → 리본 으로 고치면 X → O)
 *       수동이면 그대로 두고 안내만 (판정 결과가 다를 때)
 *   - 중고폰&현물 판매를 건드리지 않았으면 리본은 그대로 (예전 양식 판매가 X 로 바뀌지 않음)
 */

/** 캠페인 선택값: "" = 캠페인 없음, "CMP-0001" = 그 캠페인, KEEP_RAW = 보고 원문 그대로(확인 필요) */
export const CAMPAIGN_KEEP_RAW = "__keep_raw__";

export interface LinkDraft {
  inflow?: string;
  campaign?: string;
  goodbye?: string;
}

export interface UsedPhoneEdit {
  /** 이번 수정에서 중고폰&현물 판매 내용을 바꿨는지 */
  changed: boolean;
  /** 수정 후 내용 (안 바꿨으면 지금 내용) */
  after: string;
}

export interface LinkEditPlan {
  patches: { field: SaleLinkField; before: string; value: string }[];
  /** 화면에 보여줄 값 */
  view: { inflow: string; campaign: string; goodbye: string };
  /** 중고폰&현물 판매로 리본을 자동으로 바꿨을 때 */
  autoRibbon: "O" | "X" | null;
  /** 안내 (예: 수동 리본이라 다시 판정하지 않음) */
  notice: string | null;
}

/** 이 판매의 판매연결을 판매 수정에서 함께 고칠 수 있는지 (ID 중복·확인 필요·미배포면 불가) */
export function linkEditable(sale: SheetSale): boolean {
  return sale.saleIdState === "ok" || sale.saleIdState === "none";
}

export function currentLink(sale: SheetSale): SaleLink {
  return { ...emptyLink(), ...(sale.link ?? {}) };
}

/** 지금 저장된 캠페인의 선택값 */
export function campaignChoiceOf(link: SaleLink): string {
  if (link.campaignId.trim()) return link.campaignId.trim();
  return link.campaign.trim() ? CAMPAIGN_KEEP_RAW : "";
}

/** 유입경로 선택지: 사용 중 항목 + 미확인 (+ 지금 저장값이 목록에 없으면 그 값을 맨 앞에) */
export function inflowChoices(link: SaleLink, options: readonly InflowOption[]): string[] {
  const list = selectableInflows(options);
  const v = link.inflow.trim();
  return v && !list.includes(v) ? [v, ...list] : list;
}

/** 캠페인 선택지 [값, 표시] — 사용 중 캠페인(진행·예정·종료 순) + 지금 연결된 캠페인 + 확인 필요 원문 */
export function campaignChoices(link: SaleLink, campaigns: readonly Campaign[]): [string, string][] {
  const out: [string, string][] = [];
  const now = campaignOfLink(link, campaigns);
  if (now.state === "check") out.push([CAMPAIGN_KEEP_RAW, `${INFLOW_CHECK} · ${now.raw} (그대로 두기)`]);
  for (const c of sortedCampaigns(campaigns)) {
    if (!c.active && !(now.state === "linked" && now.id === c.id)) continue;
    out.push([c.id, `${c.name} (${c.status}${c.active ? "" : " · 사용 안 함"})`]);
  }
  if (now.state === "linked" && !out.some(([v]) => v === now.id)) out.push([now.id, `${now.name} (목록에 없음)`]);
  return out;
}

/** 수정 내용 → 저장할 판매연결 변경 */
export function planLinkEdit(
  sale: SheetSale,
  draft: LinkDraft,
  usedPhone: UsedPhoneEdit,
  campaigns: readonly Campaign[],
): LinkEditPlan {
  const cur = currentLink(sale);
  const patches: LinkEditPlan["patches"] = [];
  const put = (field: SaleLinkField, value: string) => {
    const before = cur[field].trim();
    if (before !== value.trim()) patches.push({ field, before, value: value.trim() });
  };

  // 유입경로: 고르면 그 이름, 원문(확인 필요)은 지운다
  const inflow = draft.inflow ?? cur.inflow;
  if (draft.inflow !== undefined && draft.inflow.trim() !== cur.inflow.trim()) {
    put("inflow", draft.inflow);
    if (draft.inflow.trim() && cur.inflowRaw.trim()) put("inflowRaw", "");
  }

  // 캠페인: 없음 / 목록 캠페인(ID + 이름) / 원문 그대로
  const choice = draft.campaign ?? campaignChoiceOf(cur);
  if (draft.campaign !== undefined && draft.campaign !== campaignChoiceOf(cur)) {
    if (draft.campaign === "") {
      put("campaign", "");
      put("campaignId", "");
    } else if (draft.campaign !== CAMPAIGN_KEEP_RAW) {
      const c = campaigns.find((x) => x.id === draft.campaign);
      put("campaignId", draft.campaign);
      // 원문이 없던 판매(점장이 직접 연결)는 캠페인 칸에 이름을 남긴다
      if (!cur.campaign.trim() && c) put("campaign", c.name);
    }
  }

  // 리본
  let goodbye = cur.goodbye.trim().toUpperCase();
  let autoRibbon: "O" | "X" | null = null;
  let notice: string | null = null;
  if (draft.goodbye !== undefined && draft.goodbye.trim().toUpperCase() !== goodbye) {
    goodbye = draft.goodbye.trim().toUpperCase();
    put("goodbye", goodbye);
    put("ribbonMode", goodbye ? ribbonModeFor(goodbye, usedPhone.after) : "");
  } else if (usedPhone.changed && draft.goodbye === undefined) {
    const judged = ribbonFromUsedPhone(usedPhone.after);
    if (cur.ribbonMode === "수동" && cur.goodbye.trim()) {
      if (judged !== cur.goodbye.trim().toUpperCase()) {
        notice = `중고폰&현물 판매 내용으로는 리본 ${judged} 이지만, 점장이 직접 고른 값(${cur.goodbye.trim()})이라 바꾸지 않았습니다.`;
      }
    } else {
      if (judged !== goodbye) autoRibbon = judged;
      goodbye = judged;
      put("goodbye", judged);
      put("ribbonMode", "자동");
    }
  }

  return { patches, view: { inflow, campaign: choice, goodbye }, autoRibbon, notice };
}

const LINK_LABEL: Partial<Record<SaleLinkField, string>> = {
  inflow: "유입경로",
  campaign: "캠페인 (보고 원문)",
  campaignId: "캠페인",
  goodbye: "리본",
  ribbonMode: "리본 방식",
  inflowRaw: "유입경로 원문 (확인 필요)",
};
export function linkFieldLabel(field: SaleLinkField): string {
  return LINK_LABEL[field] ?? field;
}

/** 변경 확인 화면에 보여줄 글자 (캠페인ID → 캠페인명) */
export function linkValueText(field: SaleLinkField, value: string, campaigns: readonly Campaign[]): string {
  if (!value) return "(빈칸)";
  if (field === "campaignId") return campaigns.find((c) => c.id === value)?.name ?? value;
  return value;
}

/** 판매 상세 보기용 글자 */
export function linkSummary(sale: SheetSale, options: readonly InflowOption[], campaigns: readonly Campaign[]) {
  const c = campaignOfLink(sale.link, campaigns);
  const r = ribbonOf(sale);
  return {
    inflow: inflowGroup(sale.link, options) + (sale.link?.inflowRaw && !sale.link.inflow ? ` (${sale.link.inflowRaw})` : ""),
    campaign: c.state === "none" ? "없음" : c.state === "linked" ? c.name : `${INFLOW_CHECK} · ${c.raw}`,
    ribbon:
      r.value === "판정불가"
        ? "판정 불가 (중고폰&현물 판매 원본 없음)"
        : `${r.value}${r.source === "auto" ? " (중고폰&현물 판매로 자동판정 · 저장 안 됨)" : sale.link?.ribbonMode ? ` (${sale.link.ribbonMode})` : ""}`,
  };
}
