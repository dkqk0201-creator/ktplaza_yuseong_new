import { requireAuth } from "@/lib/server/auth";
import { AppsScriptError, attachCampaignInAppsScript, saveCampaignInAppsScript } from "@/lib/server/apps-script";
import { getSalesConfig, rememberSalesConfig } from "@/lib/server/sales-config";
import { CAMPAIGN_ID_RE, campaignInputError, type CampaignInput } from "@/lib/campaigns";

/*
 * 캠페인 관리 (점장 전용).
 *   POST /api/settings/campaigns { campaign: { id?, name, aliases, type, start, end, status, active }, version }
 *        → 등록(id 없음)·수정. { ok, id, ...설정 }
 *   POST /api/settings/campaigns { attach: { campaignId, apply } }
 *        → 캠페인ID 없이 원문만 있는 판매 중 이 캠페인 이름·별칭과 같은 판매 건수 (apply: true 면 연결). { ok, count }
 * 삭제는 없다 (사용 안 함으로만). 날짜로 판매를 자동 연결하지 않는다.
 */
function reply(body: Record<string, unknown>, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function failure(error: unknown) {
  if (error instanceof AppsScriptError) {
    console.error(`[캠페인] 실패 (${error.code})`);
    return reply(
      { ok: false, message: error.code === "rejected" || error.code === "bad_response" ? error.message : "스프레드시트와 통신하지 못했습니다." },
      error.code === "rejected" ? 409 : 502,
    );
  }
  console.error("[캠페인] 예상하지 못한 오류");
  return reply({ ok: false, message: "저장하지 못했습니다." }, 500);
}

function parseInput(raw: unknown): (CampaignInput & { id?: string }) | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const str = (v: unknown, max: number) => (typeof v === "string" && v.length <= max ? v.trim() : null);
  const name = str(r.name, 60);
  const type = str(r.type, 20);
  const status = str(r.status, 10);
  const start = str(r.start, 10);
  const end = str(r.end, 10);
  const id = r.id === undefined || r.id === "" ? "" : str(r.id, 10);
  if (name === null || type === null || status === null || start === null || end === null || id === null) return null;
  if (id && !CAMPAIGN_ID_RE.test(id)) return null;
  if (typeof r.active !== "boolean" || !Array.isArray(r.aliases) || r.aliases.length > 10) return null;
  if (!r.aliases.every((a) => typeof a === "string" && a.length <= 60)) return null;
  return { ...(id ? { id } : {}), name, aliases: (r.aliases as string[]).map((a) => a.trim()).filter(Boolean), type, start, end, status, active: r.active };
}

export async function POST(request: Request) {
  const denied = await requireAuth(request);
  if (denied) return denied;
  let input: Record<string, unknown>;
  try {
    input = ((await request.json()) ?? {}) as Record<string, unknown>;
  } catch {
    return reply({ ok: false, message: "요청 형식이 올바르지 않습니다." }, 400);
  }
  if (input.attach !== undefined) {
    const a = (input.attach ?? {}) as Record<string, unknown>;
    const id = typeof a.campaignId === "string" ? a.campaignId : "";
    if (!CAMPAIGN_ID_RE.test(id) || typeof a.apply !== "boolean") return reply({ ok: false, message: "연결할 캠페인이 올바르지 않습니다." }, 400);
    try {
      const count = await attachCampaignInAppsScript(id, a.apply);
      return reply({ ok: true, count, applied: a.apply, message: a.apply ? `${count}건을 연결했습니다.` : "" });
    } catch (error) {
      return failure(error);
    }
  }
  const campaign = parseInput(input.campaign);
  const version = typeof input.version === "string" ? input.version : "";
  if (!campaign) return reply({ ok: false, message: "캠페인 정보가 올바르지 않습니다." }, 400);
  const current = await getSalesConfig({ fresh: true });
  const others = current.campaigns.filter((c) => c.id !== campaign.id);
  if (campaign.id && !current.campaigns.some((c) => c.id === campaign.id)) {
    return reply({ ok: false, message: "수정할 캠페인을 찾을 수 없습니다. 새로고침해 주세요." }, 409);
  }
  const problem = campaignInputError(campaign, others);
  if (problem) return reply({ ok: false, message: problem }, 400);
  try {
    const { id, config } = await saveCampaignInAppsScript(campaign, version);
    rememberSalesConfig(config);
    return reply({ ok: true, id, message: campaign.id ? "캠페인을 수정했습니다." : "캠페인을 등록했습니다.", ...config });
  } catch (error) {
    return failure(error);
  }
}
