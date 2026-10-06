import type { CardCheckResponse } from "@/lib/card-check-api";
import { parseSaleTarget } from "@/lib/sale-target";
import { AppsScriptError, updateRowInAppsScript } from "@/lib/server/apps-script";
import { COLUMN_INDEX } from "@/lib/sheet-columns";
import { cellText } from "@/lib/sheet-record";

/*
 * 카드실적 "등록완료" API: 판매 1건의 AG열(카드실적 검수)만 O 로 저장.
 * - 판매 수정과 같은 안전한 식별: 같은 월 시트·같은 행 + No.·개통일·고객·CTN 이 모두 같을 때만 (Apps Script 가 확인)
 * - AG 의 지금 값이 화면에서 본 값(before)과 같을 때만 (그사이 바뀌었으면 거부)
 * - AG 외 다른 칸은 쓰지 않는다 (Apps Script 에 keepRowFormulas 로 N·U·AB·AC 수식 변환도 하지 않게 함)
 * - Apps Script 가 돌려준 저장 후 값에서 AG = O 를 확인한 뒤에만 성공으로 응답
 */

const AG = COLUMN_INDEX.cardChecked;

function reply(body: CardCheckResponse, status: number) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
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
  rejected: { status: 409, message: "등록완료를 저장하지 못했습니다." },
};

export async function POST(request: Request) {
  let input: Record<string, unknown>;
  try {
    input = ((await request.json()) ?? {}) as Record<string, unknown>;
  } catch {
    return reply({ ok: false, message: "요청 형식이 올바르지 않습니다." }, 400);
  }
  const target = parseSaleTarget(input.target);
  const before = typeof input.before === "string" && input.before.length <= 20 ? input.before : null;
  if (!target || before === null) {
    return reply({ ok: false, message: "등록완료할 판매 건 정보가 올바르지 않습니다." }, 400);
  }
  if (cellText(before).toUpperCase() === "O") {
    return reply({ ok: false, message: "이미 등록완료(AG = O)된 카드입니다. 화면을 새로고침해 주세요." }, 409);
  }

  try {
    const result = await updateRowInAppsScript(
      target,
      [{ col: AG, before, value: "O" }],
      [],
      { onlyChanges: true },
    );
    // 장표에 실제로 O 가 들어갔는지 Apps Script 가 돌려준 값으로 확인
    if (cellText(result.values[AG]).toUpperCase() !== "O") {
      return reply(
        { ok: false, message: "장표에 O 가 저장된 것을 확인하지 못했습니다. 새로고침해 확인해 주세요." },
        502,
      );
    }
    return reply(
      { ok: true, message: "등록완료되었습니다. (카드실적 검수 AG = O)", row: result.row, values: result.values },
      200,
    );
  } catch (error) {
    if (error instanceof AppsScriptError) {
      console.error(`[카드 등록완료] 실패 (${error.code}): ${error.message}`);
      const { status, message } = FAILURE[error.code];
      return reply({ ok: false, message: error.code === "rejected" ? `${message} (${error.message})` : message }, status);
    }
    console.error("[카드 등록완료] 예상하지 못한 오류");
    return reply({ ok: false, message: "등록완료 중 오류가 발생했습니다. 새로고침해 확인해 주세요." }, 500);
  }
}
