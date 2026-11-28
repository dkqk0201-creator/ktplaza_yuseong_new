import { requireAuth } from "@/lib/server/auth";
import { AppsScriptError, listGobulbiFromAppsScript } from "@/lib/server/apps-script";
import { listOtherBudgetFromAppsScript } from "@/lib/server/other-budget";
import { MONTH_RE } from "@/lib/gobulbi";
import type { BudgetExtrasPart, BudgetExtrasResponse } from "@/lib/budget-extras";
import type { GobulbiMonth } from "@/lib/gobulbi";
import type { OtherBudgetMonth } from "@/lib/other-budget";

/*
 * 예산관리 예산 현황 진입용 조회 API (관리자 로그인 필요, 읽기 전용).
 *   GET /api/budget/extras?month=2026-11 → 그 달 고불비사용 + 기타 예산을 한 번에
 * 기존 /api/budget/gobulbi·/api/budget/other GET 과 같은 Apps Script 조회(같은 결과·같은 검사)를 쓰되,
 * 로그인 확인(Apps Script 세션 확인)을 한 번만 하고 두 조회를 동시에 보낸다 → 화면 진입 시 Apps Script 호출 4번 → 3번,
 * 두 요청이 서로 기다리지 않음. 둘 중 하나가 실패해도 다른 하나는 그대로 돌려주고, 실패는 실패로 알린다 (0원 처리 안 함).
 * 저장·수정·삭제는 기존 API 그대로 (이 API 는 조회만).
 */

function reply(body: BudgetExtrasResponse, status: number) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

const MESSAGE: Record<AppsScriptError["code"], string> = {
  not_configured: "스프레드시트 연결 설정이 아직 완료되지 않았습니다.",
  timeout: "스프레드시트 응답이 늦어 불러오지 못했습니다. 다시 조회해 주세요.",
  network: "스프레드시트에 연결하지 못했습니다. 잠시 후 다시 조회해 주세요.",
  bad_response: "스프레드시트 응답을 확인하지 못했습니다. 다시 조회해 주세요.",
  rejected: "조회를 처리하지 못했습니다.",
};

function part<T>(result: PromiseSettledResult<T>, what: string): BudgetExtrasPart<T> {
  if (result.status === "fulfilled") return { ok: true, data: result.value };
  const error = result.reason;
  if (error instanceof AppsScriptError) {
    console.error(`[예산 현황] ${what} 조회 실패 (${error.code}): ${error.message}`);
    const base = MESSAGE[error.code];
    const message = error.code === "rejected" ? error.message || base : error.code === "bad_response" ? `${base} [원인: ${error.message}]` : base;
    return { ok: false, message, notDeployed: error.details.notDeployed === true };
  }
  console.error(`[예산 현황] ${what} 조회 오류`, error);
  return { ok: false, message: `${what} 조회 중 오류가 발생했습니다.`, notDeployed: false };
}

export async function GET(request: Request) {
  // 로그인 확인이 가장 먼저 (통과 전에는 Apps Script 로 아무것도 보내지 않음)
  const denied = await requireAuth(request);
  if (denied) return denied;

  const month = new URL(request.url).searchParams.get("month") ?? "";
  if (!MONTH_RE.test(month)) return reply({ ok: false, message: "월 형식이 올바르지 않습니다." }, 400);
  const [g, o] = await Promise.allSettled<[Promise<GobulbiMonth>, Promise<OtherBudgetMonth>]>([
    listGobulbiFromAppsScript(month),
    listOtherBudgetFromAppsScript(month),
  ]);
  return reply({ ok: true, month, gobulbi: part(g, "고불비사용"), other: part(o, "기타 예산") }, 200);
}
