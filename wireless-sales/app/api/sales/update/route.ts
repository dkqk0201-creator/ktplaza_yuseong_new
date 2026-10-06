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
import type { ColumnKey } from "@/lib/sheet-columns";
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
 * - N·U·AB·AC 는 장표의 같은 행 수식(N = SUM(O:T), U = SUM(V:Y), AB = Z−AA, AC = N+U+AB)이
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
  const parsed = parseChanges(submitted);
  if (typeof parsed === "string") {
    return reply({ ok: false, message: parsed }, 400);
  }

  try {
    // 사용자가 바꾼 칸만 쓴다 (N·U·AB·AC 는 장표 수식이 계산)
    const cells: UpdateCell[] = parsed.cells;
    const result = await updateRowInAppsScript(target, cells);
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
