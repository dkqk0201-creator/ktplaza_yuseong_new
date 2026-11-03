import { getStaffNames } from "@/lib/data/staff";
import { todayInKorea } from "@/lib/format";
import {
  QUICK_FIELDS,
  emptyQuickFields,
  normalizeQuick,
  type QuickFields,
} from "@/lib/quick-report";
import type { QuickBatchResponse, SaveSaleResponse } from "@/lib/save-sale-api";
import { maskFreeText, maskName, maskPhone, maskTextRecord } from "@/lib/privacy-mask";
import {
  AppsScriptError,
  SAVE_BATCH_MAX,
  checkPrivacySupport,
  saveRowsToAppsScript,
} from "@/lib/server/apps-script";
import { toSheetRowArray, type SheetRowValues } from "@/lib/sheet-columns";

/*
 * 간편등록 저장 API.
 *   { items: [{ fields }, ...] } → 여러 건을 Apps Script 한 번 호출로 저장 (건별 결과)
 *   { fields }                   → 1건 (예전 화면 호환)
 * 화면에서 검수한 항목 원문을 받아 서버에서 같은 규칙으로 다시 변환·검증한 뒤
 * Apps Script save(B열 보호, 수식 차단, LockService)로 저장한다.
 * 확인이 필요한 건은 저장하지 않고 그 건만 실패로 돌려준다.
 * 직원 양식에 없는 장표 칸은 보내지 않는다 (= 장표에서 빈칸 그대로).
 *
 * 개인정보 (마스킹을 끄는 설정은 없음):
 *   - 저장 전에 Apps Script 가 마스킹·판매 ID 를 지원하는지 확인하고(privacy-status), 확인하지 못하면 아무것도 저장하지 않는다.
 *   - 고객명·CTN 은 마스킹 값으로만 보낸다 (김수현 → 김수*, 010-1234-5678 → 010-12**-*678).
 *   - 고객약속사항·참고내용 등 글 속 전화번호와, 그 판매의 원본 고객명도 마스킹해서 보낸다.
 *   - 응답·서버 로그에는 원본 이름·번호를 넣지 않는다 (Apps Script 도 같은 마스킹을 한 번 더 강제).
 */

/** 저장할 한 행·참고내용을 마스킹 (원본 이름은 이 판매의 글 칸에서도 바꾼다) */
function maskForSave(
  row: SheetRowValues,
  notes: Record<string, string>,
): { row: SheetRowValues; notes: Record<string, string> } {
  const original = typeof row.customer === "string" ? row.customer : "";
  const names = original ? [original] : [];
  const out: SheetRowValues = {};
  for (const [key, value] of Object.entries(row) as [keyof SheetRowValues, SheetRowValues[keyof SheetRowValues]][]) {
    if (value === undefined) continue;
    if (key === "customer") out[key] = maskName(value);
    else if (key === "ctn") out[key] = maskPhone(value);
    else if (key === "activatedAt" || key === "no") out[key] = value;
    else out[key] = typeof value === "string" ? maskFreeText(value, names) : value;
  }
  return { row: out, notes: maskTextRecord(notes, names) };
}

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
  const pending: {
    index: number;
    row: ReturnType<typeof toSheetRowArray>;
    notes: Record<string, string>;
  }[] = [];
  list.forEach((fields, index) => {
    const normalized = normalizeQuick(fields, context);
    if (normalized.issues.length > 0) {
      results[index] = {
        ok: false,
        message: "확인이 필요한 항목이 있습니다.",
        errors: normalized.issues.map((i) => i.message),
      };
    } else {
      const masked = maskForSave(normalized.row, normalized.notes as Record<string, string>);
      pending.push({
        index,
        row: toSheetRowArray(masked.row),
        notes: masked.notes,
      });
    }
  });
  if (pending.length === 0) return results;

  // 마스킹·판매 ID 를 지원하는 Apps Script 인지 먼저 확인 → 아니면 아무것도 저장하지 않는다
  try {
    await checkPrivacySupport();
  } catch (error) {
    const { message } = errorReply(error);
    for (const p of pending) results[p.index] = { ok: false, message };
    return results;
  }

  try {
    const saved = await saveRowsToAppsScript(
      pending.map((p) => p.row),
      pending.map((p) => p.notes),
    );
    saved.forEach((item, k) => {
      const index = pending[k].index;
      const hasNotes = Object.keys(pending[k].notes).length > 0;
      results[index] = item.ok
        ? {
            ok: true,
            sheet: item.sheet,
            no: item.no,
            row: item.row,
            ...(hasNotes && !item.notesSaved
              ? {
                  warning: item.notesSkipped
                    ? "장표 저장은 완료됐지만 같은 날 같은 고객으로 보이는 판매가 있어 판매보고 참고내용(장표에 없는 항목)은 다른 판매에 섞이지 않도록 보관하지 않았습니다. 판매 수정에서 다시 입력해 주세요."
                    : "장표 저장은 완료됐지만 판매보고 참고내용(장표에 없는 항목)은 보관하지 못했습니다. Apps Script 최신 버전 배포가 필요합니다.",
                }
              : {}),
          }
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
