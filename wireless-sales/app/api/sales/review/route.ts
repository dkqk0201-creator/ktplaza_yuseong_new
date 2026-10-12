import { REVIEW_MAX, reviewContentError } from "@/lib/inspection-review";
import type { ReviewResponse } from "@/lib/review-api";
import { parseSaleTarget } from "@/lib/sale-target";
import { AppsScriptError, saveReviewInAppsScript } from "@/lib/server/apps-script";

/*
 * 검수 보완 요청 저장·취소 API (검수관리 → 판매 상세).
 * 화면 → (이 API) → Apps Script inspection-review → 숨김 보조 시트 "검수보완" 에만 저장.
 * 무선장표 월 시트(열 구조·금액·수식·메모·No.)에는 아무것도 쓰지 않는다.
 * 검수완료(G열 O)는 기존 검수완료 API(/api/sales/mark-done)로 하고, 그때 Apps Script 가 요청을 닫는다.
 */

function reply(body: ReviewResponse, status: number) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

const FAILURE: Record<AppsScriptError["code"], { status: number; message: string }> = {
  not_configured: {
    status: 503,
    message: "스프레드시트 연결 설정이 아직 완료되지 않았습니다. 관리자에게 문의해 주세요.",
  },
  timeout: {
    status: 504,
    message: "스프레드시트 응답이 늦어 저장 여부를 확인하지 못했습니다. 새로고침해 확인해 주세요.",
  },
  network: { status: 502, message: "스프레드시트에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요." },
  bad_response: { status: 502, message: "스프레드시트 응답을 확인하지 못했습니다. 새로고침해 확인해 주세요." },
  rejected: { status: 409, message: "보완 요청을 저장하지 못했습니다." },
};

export async function POST(request: Request) {
  let input: Record<string, unknown>;
  try {
    input = ((await request.json()) ?? {}) as Record<string, unknown>;
  } catch {
    return reply({ ok: false, message: "요청 형식이 올바르지 않습니다." }, 400);
  }
  const target = parseSaleTarget(input.target);
  const op = input.op === "save" || input.op === "cancel" ? input.op : null;
  const before =
    typeof input.before === "string" && input.before.length <= REVIEW_MAX + 100
      ? input.before.trim()
      : null;
  const content = typeof input.content === "string" ? input.content : op === "cancel" ? "" : null;
  if (!target || !op || before === null || content === null || content.length > REVIEW_MAX + 100) {
    return reply({ ok: false, message: "보완 요청 정보가 올바르지 않습니다." }, 400);
  }
  if (op === "save") {
    const problem = reviewContentError(content);
    if (problem) return reply({ ok: false, message: problem }, 400);
  }
  try {
    const result = await saveReviewInAppsScript(target, op, before, op === "save" ? content.trim() : "");
    return reply(
      {
        ok: true,
        message: result.message || (op === "save" ? "보완 요청이 저장되었습니다." : "보완 요청을 취소했습니다."),
        review: result.review ?? null,
      },
      200,
    );
  } catch (error) {
    if (error instanceof AppsScriptError) {
      console.error(`[보완 요청] 실패 (${error.code}): ${error.message}`);
      const { status, message } = FAILURE[error.code];
      return reply({ ok: false, message: error.code === "rejected" ? `${message} (${error.message})` : message }, status);
    }
    console.error("[보완 요청] 예상하지 못한 오류");
    return reply({ ok: false, message: "처리 중 오류가 발생했습니다. 새로고침해 확인해 주세요." }, 500);
  }
}
