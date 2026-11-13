import { requireAuth } from "@/lib/server/auth";
import { parseGoalChange, type GoalChange } from "@/lib/goals";
import { isYearMonth } from "@/lib/month-sheet";
import {
  AppsScriptError,
  getGoalBoardFromAppsScript,
  getGoalHistoryFromAppsScript,
  setGoalBoardInAppsScript,
} from "@/lib/server/apps-script";

/*
 * 목표관리 API (점장 전용 — 모든 요청은 로그인 확인부터).
 *   GET  /api/goals/board?month=2026-11            → { ok, month, goals, history }
 *   POST /api/goals/board { month, items: [변경] }  → { ok, month, goals }
 * 매장 후불 목표는 예산관리 화면의 월 목표와 같은 값 하나(스크립트 속성)를 쓴다.
 */

function reply(body: Record<string, unknown>, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function failure(error: unknown) {
  if (error instanceof AppsScriptError) {
    console.error(`[목표관리] 실패 (${error.code})`);
    const message =
      error.code === "not_configured"
        ? "스프레드시트 연결 설정이 아직 완료되지 않았습니다."
        : error.code === "rejected" || error.code === "bad_response"
          ? error.message
          : "스프레드시트와 통신하지 못했습니다. 잠시 후 다시 시도해 주세요.";
    return reply({ ok: false, message }, error.code === "rejected" ? 409 : 502);
  }
  console.error("[목표관리] 예상하지 못한 오류");
  return reply({ ok: false, message: "목표를 처리하지 못했습니다." }, 500);
}

export async function GET(request: Request) {
  const denied = await requireAuth(request);
  if (denied) return denied;
  const month = new URL(request.url).searchParams.get("month") ?? "";
  if (!isYearMonth(month)) return reply({ ok: false, message: "월 형식이 올바르지 않습니다." }, 400);
  try {
    const [goals, history] = await Promise.all([getGoalBoardFromAppsScript(month), getGoalHistoryFromAppsScript(month)]);
    return reply({ ok: true, month, goals, history });
  } catch (error) {
    return failure(error);
  }
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
  const month = typeof input.month === "string" ? input.month : "";
  const raw = Array.isArray(input.items) ? input.items : null;
  if (!isYearMonth(month) || !raw || raw.length === 0 || raw.length > 200) {
    return reply({ ok: false, message: "저장할 목표가 올바르지 않습니다." }, 400);
  }
  const items: GoalChange[] = [];
  const seen = new Set<string>();
  for (const r of raw) {
    const item = parseGoalChange(r);
    if (!item) return reply({ ok: false, message: "목표는 0 이상의 정수이거나 빈칸(미설정)이어야 합니다." }, 400);
    const key = `${item.scope}|${item.staffId}|${item.metric}`;
    if (seen.has(key)) return reply({ ok: false, message: "같은 목표가 두 번 들어 있습니다." }, 400);
    seen.add(key);
    items.push(item);
  }
  try {
    const goals = await setGoalBoardInAppsScript(month, items);
    return reply({ ok: true, month, goals });
  } catch (error) {
    return failure(error);
  }
}
