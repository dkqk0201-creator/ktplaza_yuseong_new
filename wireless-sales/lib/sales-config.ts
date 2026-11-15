import { DEFAULT_INFLOW_OPTIONS, parseInflowOptions, type InflowOption } from "@/lib/inflow-options";
import { parseCampaigns, type Campaign } from "@/lib/campaigns";

/*
 * 판매 설정: 유입경로 항목 + 캠페인 목록 (운영 무선장표 숨김 보조 시트, Apps Script config-handler.gs).
 * 화면·서버가 같은 모양으로 쓴다. version = 화면에서 본 목록 판 (저장할 때 그사이 바뀌었으면 거부).
 */
export interface SalesConfig {
  inflows: InflowOption[];
  campaigns: Campaign[];
  inflowVersion: string;
  campaignVersion: string;
  /** Apps Script 에서 읽지 못해 기본값을 쓰는 중 (config-handler.gs 미배포 등) */
  fallback?: boolean;
}

export function defaultSalesConfig(): SalesConfig {
  return {
    inflows: DEFAULT_INFLOW_OPTIONS.map((o) => ({ ...o, aliases: [...o.aliases] })),
    campaigns: [],
    inflowVersion: "",
    campaignVersion: "",
    fallback: true,
  };
}

/** Apps Script·API 응답 → 설정 (항목이 없으면 기본 5개) */
export function parseSalesConfig(data: Record<string, unknown>): SalesConfig {
  const version = (v: unknown) => (typeof v === "string" && /^[0-9a-f]{0,32}$/.test(v) ? v : "");
  return {
    inflows: parseInflowOptions(data.inflows) ?? defaultSalesConfig().inflows,
    campaigns: parseCampaigns(data.campaigns),
    inflowVersion: version(data.inflowVersion),
    campaignVersion: version(data.campaignVersion),
    ...(data.fallback === true ? { fallback: true } : {}),
  };
}
