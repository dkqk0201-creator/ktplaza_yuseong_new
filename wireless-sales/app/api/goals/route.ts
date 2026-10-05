import {
  AppsScriptError,
  getGoalFromAppsScript,
  setGoalInAppsScript,
} from "@/lib/server/apps-script";

/*
 * 월별 무선 목표 API. 목표는 Apps Script 스크립트 속성에 월별로 저장된다.
 *   GET  /api/goals?month=2026-10        → { ok, month, goal }
 *   POST /api/goals { month, goal }      → { ok, month, goal }
 */

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

function reply(body: Record<string, unknown>, status = 200) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function failure(error: unknown) {
  if (error instanceof AppsScriptError) {
    console.error(`[무선 목표] 실패 (${error.code}): ${error.message}`);
    const message =
      error.code === "not_configured"
        ? "스프레드시트 연결 설정이 아직 완료되지 않았습니다."
        : error.code === "rejected"
          ? error.message
          : // 실제 원인(Apps Script 응답·연결 오류)을 함께 보여 준다
            `목표를 불러오거나 저장하지 못했습니다. Apps Script 목표 기능(goal-handler.gs)이 배포되었는지 확인해 주세요. [원인: ${error.message}]`;
    return reply(
      { ok: false, message },
      error.code === "not_configured" ? 503 : 502,
    );
  }
  return reply(
    { ok: false, message: "목표 처리 중 오류가 발생했습니다." },
    500,
  );
}

export async function GET(request: Request) {
  const month = new URL(request.url).searchParams.get("month") ?? "";
  if (!MONTH.test(month)) {
    return reply({ ok: false, message: "월 형식이 올바르지 않습니다." }, 400);
  }
  try {
    return reply({ ok: true, month, goal: await getGoalFromAppsScript(month) });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return reply({ ok: false, message: "요청 형식이 올바르지 않습니다." }, 400);
  }
  const month = String(body.month ?? "");
  const goal = body.goal;
  if (
    !MONTH.test(month) ||
    typeof goal !== "number" ||
    !Number.isInteger(goal) ||
    goal < 0 ||
    goal > 100000
  ) {
    return reply(
      { ok: false, message: "목표는 0 이상의 정수로 입력해 주세요." },
      400,
    );
  }
  try {
    return reply({
      ok: true,
      month,
      goal: await setGoalInAppsScript(month, goal),
    });
  } catch (error) {
    return failure(error);
  }
}
