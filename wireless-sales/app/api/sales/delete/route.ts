import type {
  DeleteSaleRequest,
  DeleteSaleResponse,
} from "@/lib/delete-sale-api";
import {
  AppsScriptError,
  deleteRowFromAppsScript,
} from "@/lib/server/apps-script";

/*
 * 판매내역 삭제 API.
 * 화면 → (이 API) → Apps Script → 장표의 해당 행 A열·C~AL열 값만 비움
 * 실제로 지울지는 Apps Script가 장표의 현재 값(No.·개통일·고객·CTN)을 다시 확인해 결정한다.
 */

function reply(body: DeleteSaleResponse, status: number) {
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
      "스프레드시트 연결 설정이 아직 완료되지 않았습니다. 관리자에게 문의해 주세요.",
  },
  timeout: {
    status: 504,
    message:
      "스프레드시트 응답이 늦어 삭제 여부를 확인하지 못했습니다. 판매 현황을 새로고침해 확인해 주세요.",
  },
  network: {
    status: 502,
    message: "스프레드시트에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.",
  },
  bad_response: {
    status: 502,
    message:
      "스프레드시트 응답을 확인하지 못했습니다. Apps Script에 삭제 기능이 추가·배포되었는지 확인해 주세요.",
  },
  rejected: {
    status: 409,
    message: "판매내역을 삭제하지 못했습니다.",
  },
};

/** 요청 값 검사: 정해진 형식이 아니면 Apps Script로 보내지 않는다 */
function parseTarget(input: unknown): DeleteSaleRequest | null {
  if (typeof input !== "object" || input === null) return null;
  const raw = input as Record<string, unknown>;
  const str = (v: unknown, max: number) =>
    typeof v === "string" && v.length <= max ? v.trim() : null;

  const sheet = str(raw.sheet, 3);
  const no = str(raw.no, 10);
  const activatedAt = str(raw.activatedAt, 20);
  const customer = str(raw.customer, 50);
  const ctn = str(raw.ctn, 20);
  const row = raw.row;

  if (
    sheet === null ||
    !/^(1[0-2]|[1-9])월$/.test(sheet) ||
    typeof row !== "number" ||
    !Number.isInteger(row) ||
    row < 9 ||
    row > 5000 ||
    no === null ||
    no === "" ||
    activatedAt === null ||
    customer === null ||
    ctn === null ||
    (customer === "" && ctn === "")
  ) {
    return null;
  }
  return { sheet, row, no, activatedAt, customer, ctn };
}

export async function POST(request: Request) {
  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return reply({ ok: false, message: "요청 형식이 올바르지 않습니다." }, 400);
  }

  const target = parseTarget(input);
  if (!target) {
    return reply(
      { ok: false, message: "삭제할 판매 건 정보가 올바르지 않습니다." },
      400,
    );
  }

  try {
    await deleteRowFromAppsScript(target);
    return reply({ ok: true, message: "판매내역이 삭제되었습니다." }, 200);
  } catch (error) {
    if (error instanceof AppsScriptError) {
      // 관리자 확인용 기록. 비밀값·고객 정보는 남기지 않는다.
      console.error(`[판매 삭제] 실패 (${error.code}): ${error.message}`);
      const { status, message } = ERROR_REPLIES[error.code];
      return reply(
        {
          ok: false,
          // Apps Script가 알려준 이유(예: 장표 내용이 화면과 다름)를 그대로 보여준다
          message: error.code === "rejected" ? error.message : message,
        },
        status,
      );
    }
    console.error("[판매 삭제] 예상하지 못한 오류");
    return reply(
      {
        ok: false,
        message: "삭제 중 오류가 발생했습니다. 다시 시도해 주세요.",
      },
      500,
    );
  }
}
