import {
  EDITABLE_KEYS,
  SUM_FORMULA_KEYS,
  columnIndexOf,
  USED_PHONE_RECALC_KEYS,
  isAmountKey,
  parseEditAmount,
  planUsedPhoneRecalc,
  type RecalcBase,
} from "@/lib/sale-edit";
import {
  AppsScriptError,
  listRowsFromAppsScript,
  updateRowInAppsScript,
  type UpdateCell,
  type UpdateCheckCell,
} from "@/lib/server/apps-script";
import { COLUMN_INDEX, type ColumnKey } from "@/lib/sheet-columns";
import { cellText } from "@/lib/sheet-record";
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
 * - AB·AC 는 서버가 계산한다: AB = Z − AA, AC = N + U + AB (최종값 기준, "-"·빈칸은 0, 음수 그대로).
 *   화면이 보낸 AB·AC 는 쓰지 않고, 계산값이 장표 값과 다를 때만 함께 저장한다
 *   (이미 틀어져 있던 AB·AC 도 바로잡는다. 틀어져 있다는 이유로 거부하지 않는다).
 * - N·U 는 장표의 같은 행 합계 수식(SUM(O:T)·SUM(V:Y))이라 쓰지 않는다. 화면이 보낸 N·U 자동 항목은 버리고,
 *   AC 계산의 N·U 는 O~T·V~Y 최종값의 합으로 구한다 (Apps Script 가 숫자로 남아 있던 N·U 는 수식으로 바꿈).
 * - 계산 기준: 화면에서 본 값(base). 예전 화면이라 base 가 없으면 장표에서 그 행을 방금 읽은 값.
 * - AB·AC 를 쓸 때는 계산에 쓴 N·U·Z·AA 중 바꾸지 않는 칸을 "확인만 하는 칸"으로 보내,
 *   그사이 다른 사람이 고쳤으면 Apps Script 가 아무것도 쓰지 않고 거부한다.
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
    !no ||
    activatedAt === null ||
    customer === null ||
    ctn === null ||
    (customer === "" && ctn === "")
  ) {
    return null;
  }
  return { sheet, row, no, activatedAt, customer, ctn };
}

interface ParsedChanges {
  cells: UpdateCell[];
  list: { key: ColumnKey; before: string; after: string }[];
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

/** 화면에서 본 O~T·V~Y·Z·AA·AB·AC. 모든 칸이 올바른 글자여야 쓰고, 아니면 null */
function parseBase(input: unknown): RecalcBase | null {
  if (typeof input !== "object" || input === null) return null;
  const raw = input as Record<string, unknown>;
  const base: Record<string, string> = {};
  for (const key of USED_PHONE_RECALC_KEYS) {
    const value = raw[key];
    if (typeof value !== "string" || value.length > 600) return null;
    base[key] = value;
  }
  return base as RecalcBase;
}

/** 예전 화면(base 없음): 장표에서 그 행의 O~T·V~Y·Z·AA·AB·AC 를 방금 읽은 값 */
async function readBase(
  target: UpdateSaleTarget,
): Promise<RecalcBase | null> {
  const list = await listRowsFromAppsScript(target.sheet);
  const found = list.rows.find((r) => r.row === target.row);
  if (!found) return null;
  return Object.fromEntries(
    USED_PHONE_RECALC_KEYS.map((key) => [
      key,
      cellText(found.values[COLUMN_INDEX[key]]),
    ]),
  ) as RecalcBase;
}

export async function POST(request: Request) {
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
  // N·U(행별 합계 수식)는 화면 표시용 자동 항목 → 쓰지 않으므로 버린다
  const sumKeys = new Set<unknown>(SUM_FORMULA_KEYS);
  const submitted = Array.isArray(raw.changes)
    ? raw.changes.filter(
        (c: unknown) =>
          !(typeof c === "object" && c !== null && sumKeys.has((c as Record<string, unknown>).key)),
      )
    : raw.changes;
  const parsed = parseChanges(submitted);
  if (typeof parsed === "string") {
    return reply({ ok: false, message: parsed }, 400);
  }

  try {
    // AB·AC 는 서버가 계산한다 (화면이 보낸 AB·AC 칸은 버림)
    const derived = new Set<number>([
      columnIndexOf("usedPhoneRemaining"),
      columnIndexOf("finalTotal"),
    ]);
    const userCells = parsed.cells.filter((c) => !derived.has(c.col));
    const userList = parsed.list.filter(
      (c) => c.key !== "usedPhoneRemaining" && c.key !== "finalTotal",
    );
    const base = parseBase(raw.base) ?? (await readBase(target));
    if (!base) {
      return reply(
        {
          ok: false,
          message:
            "장표에서 해당 판매 행을 찾지 못했습니다. 화면을 새로고침해 주세요.",
        },
        409,
      );
    }
    const plan = planUsedPhoneRecalc(userList, base);
    const cells: UpdateCell[] = [
      ...userCells,
      ...plan.writes.map((w) => ({
        col: columnIndexOf(w.key),
        before: w.before,
        value: w.after,
      })),
    ];
    if (cells.length === 0) {
      return reply({ ok: false, message: "수정된 항목이 없습니다." }, 400);
    }
    const checkCells: UpdateCheckCell[] = plan.checks.map((c) => ({
      col: columnIndexOf(c.key),
      before: c.before,
      check: true,
    }));

    const result = await updateRowInAppsScript(target, cells, checkCells);
    return reply(
      {
        ok: true,
        message: "판매내역이 수정되었습니다.",
        row: result.row,
        no: result.no,
        values: result.values,
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
