import { requireAuth } from "@/lib/server/auth";
import { AppsScriptError, saveInflowOptionsInAppsScript } from "@/lib/server/apps-script";
import { getSalesConfig, rememberSalesConfig } from "@/lib/server/sales-config";
import { inflowOptionsError, parseInflowOptions } from "@/lib/inflow-options";

/*
 * 유입경로 항목 저장 (점장 전용).
 *   POST /api/settings/inflow { items: [{ name, aliases, active, order }], version } → { ok, ...설정 }
 * 항목 추가·비활성화·별칭·순서만. 이름 변경·삭제는 받지 않는다 (판매연결에 저장된 이름이 깨지지 않게).
 * Apps Script 가 같은 기준으로 다시 검사하고, 화면에서 본 목록 판(version)이 다르면 거부한다.
 */
function reply(body: Record<string, unknown>, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
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
  const items = parseInflowOptions(input.items);
  const version = typeof input.version === "string" ? input.version : "";
  if (!items || !Array.isArray(input.items) || items.length !== input.items.length) {
    return reply({ ok: false, message: "유입경로 항목이 올바르지 않습니다." }, 400);
  }
  const current = await getSalesConfig({ fresh: true });
  const problem = inflowOptionsError(items, current.inflows);
  if (problem) return reply({ ok: false, message: problem }, 400);
  try {
    const config = await saveInflowOptionsInAppsScript(items, version);
    rememberSalesConfig(config);
    return reply({ ok: true, message: "유입경로 항목을 저장했습니다.", ...config });
  } catch (error) {
    if (error instanceof AppsScriptError) {
      console.error(`[유입경로 설정] 실패 (${error.code})`);
      return reply({ ok: false, message: error.code === "rejected" || error.code === "bad_response" ? error.message : "스프레드시트와 통신하지 못했습니다." }, error.code === "rejected" ? 409 : 502);
    }
    console.error("[유입경로 설정] 예상하지 못한 오류");
    return reply({ ok: false, message: "저장하지 못했습니다." }, 500);
  }
}
