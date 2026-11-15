import { requireAuth } from "@/lib/server/auth";
import {
  EDITABLE_KEYS,
  columnIndexOf,
  isAmountKey,
  isRowFormulaKey,
  parseEditAmount,
} from "@/lib/sale-edit";
import {
  AppsScriptError,
  updateRowInAppsScript,
  type UpdateCell,
} from "@/lib/server/apps-script";
import { POLICY_NAME_FIELD } from "@/lib/model-policy";
import {
  EDITABLE_NOTE_KEYS,
  cleanNote,
  isNoteField,
  noteError,
  type NoteChange,
} from "@/lib/sale-form-layout";
import type { ColumnKey } from "@/lib/sheet-columns";
import { linkValueError, type SaleLinkField } from "@/lib/sale-link";
import { staffIdForName } from "@/lib/data/staff-list";
import { getSalesConfig } from "@/lib/server/sales-config";
import type { InflowOption } from "@/lib/inflow-options";
import type {
  UpdateSaleResponse,
  UpdateSaleTarget,
} from "@/lib/update-sale-api";

/*
 * 기존 판매 수정 API (검수관리 → 판매 상세 → 판매 수정).
 * 화면 → (이 API) → Apps Script update → 같은 월 시트·같은 행의 바뀐 칸만 고침.
 * - 새 판매 등록(빈 행 찾기) 로직은 쓰지 않는다.
 * - No.(B)·개통일(C)은 바꿀 수 없다.
 * - 실제로 고칠지는 Apps Script 가 장표의 현재 값을 다시 확인해 결정한다.
 * - N·U·AB·AC 는 장표의 같은 행 수식(N = SUM(O:T), U = SUM(V:Y), AB = Z−AA, AC = N−U+AB)이
 *   계산하므로 쓰지 않는다. 화면이 보낸 이 4칸(자동 항목·직접 입력)은 버린다.
 *   숫자로 남아 있던 예전 행은 Apps Script 가 수정과 함께 수식으로 바꾼다.
 */

function reply(body: UpdateSaleResponse, status: number) {
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
      "스프레드시트 응답이 늦어 수정 여부를 확인하지 못했습니다. 새로고침해 확인해 주세요.",
  },
  network: {
    status: 502,
    message: "스프레드시트에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.",
  },
  bad_response: {
    status: 502,
    message:
      "스프레드시트 응답을 확인하지 못했습니다. Apps Script에 수정 기능(update-handler.gs)이 추가·배포되었는지 확인해 주세요.",
  },
  rejected: { status: 409, message: "판매내역을 수정하지 못했습니다." },
};

const EDITABLE = new Set<string>(EDITABLE_KEYS);

function parseTarget(input: unknown): UpdateSaleTarget | null {
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
    activatedAt === null ||
    customer === null ||
    ctn === null ||
    (customer === "" && ctn === "")
  ) {
    return null;
  }
  return { sheet, row, no, activatedAt, customer, ctn };
}

/** 판매 수정 화면에서 함께 고칠 수 있는 판매연결 항목 */
const LINK_EDITABLE = new Set<SaleLinkField>(["inflow", "campaign", "goodbye", "campaignId", "ribbonMode", "inflowRaw"]);
const SALE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

type ParsedLink = { saleId: string; staffId: string; patches: { field: SaleLinkField; before: string; value: string }[] };

/** 판매연결 변경 검사 (없으면 null, 형식 오류면 글자) */
function parseLinkPart(input: unknown, inflows: readonly InflowOption[]): ParsedLink | null | string {
  if (input === undefined || input === null) return null;
  if (typeof input !== "object") return "판매연결 형식이 올바르지 않습니다.";
  const raw = input as Record<string, unknown>;
  const saleId = typeof raw.saleId === "string" ? raw.saleId : "";
  if (saleId && !SALE_ID.test(saleId)) return "판매 ID 형식이 올바르지 않습니다.";
  if (!Array.isArray(raw.patches) || raw.patches.length > LINK_EDITABLE.size) return "판매연결 형식이 올바르지 않습니다.";
  const seen = new Set<string>();
  const patches: ParsedLink["patches"] = [];
  for (const item of raw.patches) {
    const p = (item ?? {}) as Record<string, unknown>;
    const field = p.field as SaleLinkField;
    if (typeof p.field !== "string" || !LINK_EDITABLE.has(field) || seen.has(field)) return "판매연결 항목이 올바르지 않습니다.";
    if (typeof p.before !== "string" || typeof p.value !== "string" || p.before.length > 100 || p.value.length > 100) return "판매연결 값이 올바르지 않습니다.";
    const problem = linkValueError(field, p.value, inflows);
    if (problem) return problem;
    seen.add(field);
    patches.push({ field, before: p.before.trim(), value: p.value.trim() });
  }
  if (patches.length === 0) return null;
  const staff = typeof raw.staff === "string" ? raw.staff : "";
  return { saleId, staffId: staffIdForName(staff) ?? "", patches };
}

interface ParsedChanges {
  cells: UpdateCell[];
  list: { key: ColumnKey; before: string; after: string }[];
}

/**
 * 참고 항목(장표 저장 안 함, 웹앱참고 보관) 변경 검사 → 바뀐 항목만. 형식 오류면 글자.
 * notes: [{ field, before, after }] (판매 수정 화면) + policyName: { before, after } (예전 화면 호환, 정책명)
 */
function parseNoteChanges(notesInput: unknown, policyInput: unknown): NoteChange[] | string {
  const raw: { field: unknown; before: unknown; after: unknown }[] = [];
  if (notesInput !== undefined && notesInput !== null) {
    if (!Array.isArray(notesInput) || notesInput.length > EDITABLE_NOTE_KEYS.length) {
      return "참고 항목 형식이 올바르지 않습니다.";
    }
    for (const item of notesInput) {
      if (typeof item !== "object" || item === null) return "참고 항목 형식이 올바르지 않습니다.";
      const r = item as Record<string, unknown>;
      raw.push({ field: r.field, before: r.before, after: r.after });
    }
  }
  if (policyInput !== undefined && policyInput !== null) {
    if (typeof policyInput !== "object") return "정책명 형식이 올바르지 않습니다.";
    const r = policyInput as Record<string, unknown>;
    if (!raw.some((x) => x.field === POLICY_NAME_FIELD)) {
      raw.push({ field: POLICY_NAME_FIELD, before: r.before, after: r.after });
    }
  }
  const seen = new Set<string>();
  const out: NoteChange[] = [];
  for (const { field, before, after } of raw) {
    if (
      typeof field !== "string" ||
      !isNoteField(field) ||
      seen.has(field) ||
      typeof before !== "string" ||
      typeof after !== "string" ||
      before.length > 600 ||
      after.length > 600
    ) {
      return "참고 항목 형식이 올바르지 않습니다.";
    }
    seen.add(field);
    const problem = noteError(field, after);
    if (problem) return problem;
    const b = cleanNote(field, before);
    const a = cleanNote(field, after);
    if (a !== b) out.push({ field, before: b, after: a });
  }
  return out;
}

/** 바꿀 칸 검사 → Apps Script 로 보낼 칸 (금액은 숫자, 글자는 '로 글자 그대로 저장) */
function parseChanges(input: unknown): ParsedChanges | string {
  if (!Array.isArray(input) || input.length === 0) {
    return "수정된 항목이 없습니다.";
  }
  if (input.length > EDITABLE.size) return "수정할 항목이 너무 많습니다.";
  const seen = new Set<string>();
  const cells: UpdateCell[] = [];
  const list: ParsedChanges["list"] = [];
  for (const item of input) {
    if (typeof item !== "object" || item === null) return "형식 오류";
    const { key, before, after } = item as Record<string, unknown>;
    if (typeof key !== "string" || !EDITABLE.has(key) || seen.has(key)) {
      return "No.·개통일은 수정할 수 없습니다.";
    }
    if (
      typeof before !== "string" ||
      typeof after !== "string" ||
      before.length > 600 ||
      after.length > 500
    ) {
      return "수정할 값이 올바르지 않습니다.";
    }
    seen.add(key);
    const columnKey = key as ColumnKey;
    const text = after.trim();
    let value: string | number;
    if (isAmountKey(columnKey)) {
      const amount = parseEditAmount(text);
      if (amount === undefined)
        return `금액 칸(${key})은 숫자만 입력할 수 있습니다.`;
      value = amount === null ? "" : amount;
    } else {
      // 앞의 ' 는 구글 시트가 글자를 숫자·날짜·계산식으로 바꾸지 않게 한다
      value = text === "" ? "" : `'${text}`;
    }
    cells.push({ col: columnIndexOf(columnKey), before, value });
    list.push({ key: columnKey, before, after: text });
  }
  return { cells, list };
}

export async function POST(request: Request) {
  // 로그인 확인이 가장 먼저 (통과 전에는 Apps Script 로 아무것도 보내지 않음)
  const denied = await requireAuth(request);
  if (denied) return denied;

  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return reply({ ok: false, message: "요청 형식이 올바르지 않습니다." }, 400);
  }
  const raw = (input ?? {}) as Record<string, unknown>;
  const target = parseTarget(raw.target);
  if (!target) {
    return reply(
      { ok: false, message: "수정할 판매 건 정보가 올바르지 않습니다." },
      400,
    );
  }
  // N·U·AB·AC(행별 수식 칸)는 화면 표시용 자동 항목 → 쓰지 않으므로 버린다
  const submitted = Array.isArray(raw.changes)
    ? raw.changes.filter((c: unknown) => {
        const key =
          typeof c === "object" && c !== null
            ? (c as Record<string, unknown>).key
            : undefined;
        return !(typeof key === "string" && isRowFormulaKey(key));
      })
    : raw.changes;
  const noteChanges = parseNoteChanges(raw.notes, raw.policyName);
  if (typeof noteChanges === "string") {
    return reply({ ok: false, message: noteChanges }, 400);
  }
  const config = raw.link !== undefined && raw.link !== null ? await getSalesConfig() : null;
  const linkPart = parseLinkPart(raw.link, config?.inflows ?? []);
  if (typeof linkPart === "string") {
    return reply({ ok: false, message: linkPart }, 400);
  }
  // 참고 항목·판매연결만 바꾼 경우: 장표 칸 변경 없이 그것만 저장
  const onlyNotes =
    (noteChanges.length > 0 || linkPart !== null) &&
    (submitted === undefined || (Array.isArray(submitted) && submitted.length === 0));
  const parsed: ParsedChanges | string = onlyNotes
    ? { cells: [], list: [] }
    : parseChanges(submitted);
  if (typeof parsed === "string") {
    return reply({ ok: false, message: parsed }, 400);
  }

  try {
    // 사용자가 바꾼 칸만 쓴다 (N·U·AB·AC 는 장표 수식이 계산)
    const cells: UpdateCell[] = parsed.cells;
    const result = await updateRowInAppsScript(
      target,
      cells,
      [],
      {
        ...(noteChanges.length > 0
          ? {
              notePatches: noteChanges.map((n) => ({
                field: n.field,
                before: n.before,
                value: n.after,
              })),
            }
          : {}),
        ...(linkPart ? { link: linkPart } : {}),
      },
    );
    const linkPending = linkPart !== null && result.linkSaved !== true;
    const notesNotSaved = noteChanges.length > 0 && result.notePatched !== true;
    const onlyPolicy =
      noteChanges.length === 1 && noteChanges[0].field === POLICY_NAME_FIELD;
    return reply(
      {
        ok: true,
        message:
          cells.length > 0
            ? "판매내역이 수정되었습니다."
            : onlyPolicy
              ? "정책명이 수정되었습니다."
              : noteChanges.length > 0
                ? "참고내용이 수정되었습니다."
                : "판매연결이 수정되었습니다.",
        row: result.row,
        no: result.no,
        values: result.values,
        ...(noteChanges.length > 0 && result.notes ? { notes: result.notes } : {}),
        ...(result.saleId && result.link ? { saleId: result.saleId, link: result.link } : {}),
        ...(linkPending ? { linkPending: true } : {}),
        ...(notesNotSaved || linkPending
          ? {
              warning: [
                notesNotSaved ? "장표 칸은 수정됐지만 참고 항목(장표 저장 안 함)은 저장하지 못했습니다. 화면을 새로고침한 뒤 다시 확인해 주세요." : "",
                linkPending ? "판매 수정은 저장됐지만 유입경로·캠페인·리본(판매연결)은 저장하지 못했습니다. '판매연결만 다시 저장'을 눌러 주세요." : "",
              ].filter(Boolean).join(" "),
            }
          : {}),
      },
      200,
    );
  } catch (error) {
    if (error instanceof AppsScriptError) {
      console.error(`[판매 수정] 실패 (${error.code}): ${error.message}`);
      const { status, message } = ERROR_REPLIES[error.code];
      return reply(
        {
          ok: false,
          message: error.code === "rejected" ? error.message : message,
        },
        status,
      );
    }
    console.error("[판매 수정] 예상하지 못한 오류");
    return reply(
      {
        ok: false,
        message: "수정 중 오류가 발생했습니다. 다시 시도해 주세요.",
      },
      500,
    );
  }
}
