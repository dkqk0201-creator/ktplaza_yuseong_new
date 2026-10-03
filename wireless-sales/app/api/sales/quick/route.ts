import { getStaffNames } from "@/lib/data/staff";
import { todayInKorea } from "@/lib/format";
import {
  QUICK_FIELDS,
  emptyQuickFields,
  normalizeQuick,
  type QuickFields,
} from "@/lib/quick-report";
import type { QuickBatchResponse, SaveSaleResponse } from "@/lib/save-sale-api";
import {
  AppsScriptError,
  SAVE_BATCH_MAX,
  saveRowsToAppsScript,
} from "@/lib/server/apps-script";
import { toSheetRowArray } from "@/lib/sheet-columns";

/*
 * 간편등록 저장 API.
 *   { items: [{ fields }, ...] } → 여러 건을 Apps Script 한 번 호출로 저장 (건별 결과)
 *   { fields }                   → 1건 (예전 화면 호환)
 * 화면에서 검수한 항목 원문을 받아 서버에서 같은 규칙으로 다시 변환·검증한 뒤
 * Apps Script save(B열 보호, 수식 차단, LockService)로 저장한다.
 * 확인이 필요한 건은 저장하지 않고 그 건만 실패로 돌려준다.
 * 직원 양식에 없는 장표 칸은 보내지 않는다 (= 장표에서 빈칸 그대로).
 */

function reply(body: SaveSaleResponse | QuickBatchResponse, status: number) {
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

function errorReply(error: unknown): { status: number; message: string } {
  if (error instanceof AppsScriptError) {
    console.error(`[간편등록] 저장 실패 (${error.code}): ${error.message}`);
    const { status, message } = ERROR_REPLIES[error.code];
    return {
      status,
      message:
        error.code === "rejected" ? `${message} (${error.message})` : message,
    };
  }
  console.error("[간편등록] 예상하지 못한 오류");
  return {
    status: 500,
    message: "저장 중 오류가 발생했습니다. 다시 시도해 주세요.",
  };
}

/** 여러 건 저장. 확인이 필요한 건은 빼고 나머지만 Apps Script 로 한 번에 보낸다. */
async function saveItems(list: QuickFields[]): Promise<SaveSaleResponse[]> {
  const context = {
    today: todayInKorea(),
    staffNames: await getStaffNames(),
  };
  const results: SaveSaleResponse[] = new Array(list.length);
  const pending: { index: number; row: ReturnType<typeof toSheetRowArray> }[] =
    [];
  list.forEach((fields, index) => {
    const normalized = normalizeQuick(fields, context);
    if (normalized.issues.length > 0) {
      results[index] = {
        ok: false,
        message: "확인이 필요한 항목이 있습니다.",
        errors: normalized.issues.map((i) => i.message),
      };
    } else {
      pending.push({ index, row: toSheetRowArray(normalized.row) });
    }
  });
  if (pending.length === 0) return results;

  try {
    const saved = await saveRowsToAppsScript(pending.map((p) => p.row));
    saved.forEach((item, k) => {
      const index = pending[k].index;
      results[index] = item.ok
        ? { ok: true, sheet: item.sheet, no: item.no, row: item.row }
        : { ok: false, message: errorReply(item.error).message };
    });
  } catch (error) {
    // 통신 실패 등: 보낸 건 모두 저장 여부를 확인해야 하는 실패로 돌려준다
    const { message } = errorReply(error);
    for (const p of pending) results[p.index] = { ok: false, message };
  }
  return results;
}

export async function POST(request: Request) {
  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return reply({ ok: false, message: "요청 형식이 올바르지 않습니다." }, 400);
  }

  // 여러 건
  const items = (input as Record<string, unknown> | null)?.items;
  if (Array.isArray(items)) {
    if (items.length === 0 || items.length > SAVE_BATCH_MAX) {
      return reply(
        {
          ok: false,
          message: `한 번에 1~${SAVE_BATCH_MAX}건까지 등록할 수 있습니다.`,
        },
        400,
      );
    }
    const list = items.map(parseFields);
    if (list.some((f) => f === null)) {
      return reply(
        { ok: false, message: "요청 형식이 올바르지 않습니다." },
        400,
      );
    }
    const results = await saveItems(list as QuickFields[]);
    return reply({ ok: true, results }, 200);
  }

  // 1건
  const fields = parseFields(input);
  if (!fields) {
    return reply({ ok: false, message: "요청 형식이 올바르지 않습니다." }, 400);
  }
  const [result] = await saveItems([fields]);
  if (result.ok) return reply(result, 200);
  return reply(result, result.errors ? 400 : 502);
}
