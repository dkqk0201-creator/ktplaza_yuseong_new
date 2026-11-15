import { requireAuth } from "@/lib/server/auth";
import { staffIdForName } from "@/lib/data/staff-list";
import { SALE_LINK_FIELDS, linkValueError, type SaleLink, type SaleLinkField } from "@/lib/sale-link";
import { parseSaleTarget } from "@/lib/sale-target";
import { AppsScriptError, saveSaleLinkInAppsScript, type SaleLinkPatch } from "@/lib/server/apps-script";
import { getSalesConfig } from "@/lib/server/sales-config";

/*
 * 판매연결 저장 API: 유입경로·캠페인·리본 (+ 향후 가망고객ID·TM발굴직원ID).
 * 쓰이는 곳: 판매연결만 저장 실패한 판매의 "판매연결만 다시 저장", 확인 필요(mismatch) 판매의 "새 판매 ID 로 다시 연결".
 * (평소 수정은 판매 수정 화면에서 판매 내용과 함께 /api/sales/update 로 저장)
 * POST { target, saleId, staff, patches: [{ field, before, value }] }
 *   → { ok: true, saleId, link } / { ok: false, message }
 * Apps Script(sale-link.gs)가 행·No.·개통일·고객·CTN·판매 ID 와 저장된 값을 다시 확인한 뒤 저장한다.
 * 판매 ID 가 장표의 다른 행에도 있으면(복사 등) 저장하지 않고 "확인 필요"로 돌려준다.
 * 판매연결 기록의 확인값(개통일+CTN)이 행과 다르면 거부하고, relink: true 일 때만 새 ID 로 다시 연결한다
 * (예전 기록의 유입경로 등은 옮기지 않음).
 */

export type SaleLinkResponse =
  | { ok: true; saleId: string; link: SaleLink }
  | { ok: false; message: string; code?: string };

function reply(body: SaleLinkResponse, status: number) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  // 로그인 확인이 가장 먼저 (통과 전에는 Apps Script 로 아무것도 보내지 않음)
  const denied = await requireAuth(request);
  if (denied) return denied;

  let input: Record<string, unknown>;
  try {
    input = ((await request.json()) ?? {}) as Record<string, unknown>;
  } catch {
    return reply({ ok: false, message: "요청 형식이 올바르지 않습니다." }, 400);
  }
  const target = parseSaleTarget(input.target);
  const saleId = typeof input.saleId === "string" ? input.saleId : null;
  const rawPatches = Array.isArray(input.patches) ? input.patches : null;
  if (!target || saleId === null || (saleId !== "" && !/^[0-9a-f-]{36}$/.test(saleId)) || !rawPatches || rawPatches.length === 0 || rawPatches.length > SALE_LINK_FIELDS.length) {
    return reply({ ok: false, message: "저장할 판매 건 정보가 올바르지 않습니다." }, 400);
  }
  const { inflows } = await getSalesConfig();
  const patches: SaleLinkPatch[] = [];
  const seen = new Set<string>();
  for (const raw of rawPatches) {
    const p = (raw ?? {}) as Record<string, unknown>;
    const field = SALE_LINK_FIELDS.find((f) => f === p.field) as SaleLinkField | undefined;
    if (!field || seen.has(field) || typeof p.before !== "string" || typeof p.value !== "string" || p.before.length > 60 || p.value.length > 60) {
      return reply({ ok: false, message: "저장할 항목 형식이 올바르지 않습니다." }, 400);
    }
    const problem = linkValueError(field, p.value, inflows);
    if (problem) return reply({ ok: false, message: problem }, 400);
    seen.add(field);
    patches.push({ field, before: p.before.trim(), value: p.value.trim() });
  }
  const staff = typeof input.staff === "string" ? input.staff : "";
  try {
    const saved = await saveSaleLinkInAppsScript({
      target,
      saleId,
      staffId: staffIdForName(staff) ?? "",
      patches,
      ...(input.relink === true ? { relink: true } : {}),
    });
    return reply({ ok: true, saleId: saved.saleId, link: saved.link }, 200);
  } catch (error) {
    if (error instanceof AppsScriptError) {
      console.error(`[판매연결] 저장 실패 (${error.code})`);
      const code = typeof error.details.code === "string" ? error.details.code : undefined;
      if (error.code === "rejected") return reply({ ok: false, message: error.message, ...(code ? { code } : {}) }, 409);
      if (error.code === "not_configured") return reply({ ok: false, message: "스프레드시트 연결 설정이 아직 완료되지 않았습니다." }, 503);
      return reply({ ok: false, message: error.code === "bad_response" ? error.message : "스프레드시트와 통신하지 못했습니다. 잠시 후 다시 시도해 주세요." }, 502);
    }
    console.error("[판매연결] 예상하지 못한 오류");
    return reply({ ok: false, message: "저장 중 오류가 발생했습니다." }, 500);
  }
}
