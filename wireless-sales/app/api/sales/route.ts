import { getStaffNames } from "@/lib/data/staff";
import type { SaveSaleResponse } from "@/lib/save-sale-api";
import { AppsScriptError, saveRowToAppsScript } from "@/lib/server/apps-script";
import { parseSaleFormInput } from "@/lib/server/sale-input";
import { buildSheetRow, toSheetRowArray } from "@/lib/sheet-mapping";

/*
 * 판매 등록 저장 API.
 * 화면 → (이 API) → Apps Script → 무선장표 월별 시트
 * 응답: 성공 { ok: true, sheet, no, row } / 실패 { ok: false, message, errors? }
 */

function reply(body: SaveSaleResponse, status: number) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

const ERROR_REPLIES: Record<
  AppsScriptError["code"],
  { status: number; message: string }
> = {
  not_configured: {
    status: 503,
    message:
      "스프레드시트 저장 설정이 아직 완료되지 않았습니다. 관리자에게 문의해 주세요.",
  },
  timeout: {
    status: 504,
    message:
      "스프레드시트 응답이 늦어 저장 여부를 확인하지 못했습니다. 장표에 저장되었는지 먼저 확인한 뒤 다시 시도해 주세요.",
  },
  network: {
    status: 502,
    message: "스프레드시트에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.",
  },
  bad_response: {
    status: 502,
    message:
      "스프레드시트 응답을 확인하지 못했습니다. 장표에 저장되었는지 확인해 주세요.",
  },
  rejected: {
    status: 502,
    message: "스프레드시트에 저장하지 못했습니다.",
  },
};

export async function POST(request: Request) {
  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return reply({ ok: false, message: "요청 형식이 올바르지 않습니다." }, 400);
  }

  const parsed = parseSaleFormInput(input, await getStaffNames());
  if (!parsed.ok) {
    return reply(
      {
        ok: false,
        message: "입력값을 확인해 주세요.",
        errors: parsed.errors,
      },
      400,
    );
  }

  // 합계(M, T, AA, AB)는 서버에서 다시 계산한 값으로 보낸다. B열은 빈 값.
  const row = toSheetRowArray(buildSheetRow(parsed.values));

  try {
    const result = await saveRowToAppsScript(row);
    return reply(
      { ok: true, sheet: result.sheet, no: result.no, row: result.row },
      200,
    );
  } catch (error) {
    if (error instanceof AppsScriptError) {
      // 관리자 확인용 기록. 비밀값·고객 정보는 남기지 않는다.
      console.error(`[판매 등록] 저장 실패 (${error.code}): ${error.message}`);
      const { status, message } = ERROR_REPLIES[error.code];
      return reply(
        {
          ok: false,
          // Apps Script가 알려준 이유(예: 빈 행 없음)는 직원에게도 보여준다
          message:
            error.code === "rejected"
              ? `${message} (${error.message})`
              : message,
        },
        status,
      );
    }
    console.error("[판매 등록] 예상하지 못한 오류");
    return reply(
      {
        ok: false,
        message: "저장 중 오류가 발생했습니다. 다시 시도해 주세요.",
      },
      500,
    );
  }
}
