import { getStaffNames } from "@/lib/data/staff";
import { todayInKorea } from "@/lib/format";
import {
  QUICK_FIELDS,
  emptyQuickFields,
  normalizeQuick,
  type QuickFields,
} from "@/lib/quick-report";
import type { SaveSaleResponse } from "@/lib/save-sale-api";
import { AppsScriptError, saveRowToAppsScript } from "@/lib/server/apps-script";
import { toSheetRowArray } from "@/lib/sheet-columns";

/*
 * 간편등록 저장 API (판매 1건).
 * 화면에서 검수한 항목 원문을 받아 서버에서 같은 규칙으로 다시 변환·검증한 뒤
 * 판매등록과 같은 방식(Apps Script save, B열 보호, 수식 차단, LockService)으로 저장한다.
 * 직원 양식에 없는 장표 칸은 보내지 않는다 (= 장표에서 빈칸 그대로).
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
  rejected: { status: 502, message: "스프레드시트에 저장하지 못했습니다." },
};

function parseFields(input: unknown): QuickFields | null {
  if (typeof input !== "object" || input === null) return null;
  const raw = (input as Record<string, unknown>).fields;
  if (typeof raw !== "object" || raw === null) return null;
  const fields = emptyQuickFields();
  for (const { id } of QUICK_FIELDS) {
    const value = (raw as Record<string, unknown>)[id] ?? "";
    if (typeof value !== "string" || value.length > 600) return null;
    fields[id] = value;
  }
  return fields;
}

export async function POST(request: Request) {
  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return reply({ ok: false, message: "요청 형식이 올바르지 않습니다." }, 400);
  }
  const fields = parseFields(input);
  if (!fields) {
    return reply({ ok: false, message: "요청 형식이 올바르지 않습니다." }, 400);
  }

  const normalized = normalizeQuick(fields, {
    today: todayInKorea(),
    staffNames: await getStaffNames(),
  });
  if (normalized.issues.length > 0) {
    return reply(
      {
        ok: false,
        message: "확인이 필요한 항목이 있습니다.",
        errors: normalized.issues.map((i) => i.message),
      },
      400,
    );
  }

  try {
    const result = await saveRowToAppsScript(toSheetRowArray(normalized.row));
    return reply(
      { ok: true, sheet: result.sheet, no: result.no, row: result.row },
      200,
    );
  } catch (error) {
    if (error instanceof AppsScriptError) {
      console.error(`[간편등록] 저장 실패 (${error.code}): ${error.message}`);
      const { status, message } = ERROR_REPLIES[error.code];
      return reply(
        {
          ok: false,
          message:
            error.code === "rejected"
              ? `${message} (${error.message})`
              : message,
        },
        status,
      );
    }
    console.error("[간편등록] 예상하지 못한 오류");
    return reply(
      {
        ok: false,
        message: "저장 중 오류가 발생했습니다. 다시 시도해 주세요.",
      },
      500,
    );
  }
}
