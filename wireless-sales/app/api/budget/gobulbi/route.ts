import { STAFF_NAMES } from "@/lib/data/staff-list";
import { todayInKorea } from "@/lib/format";
import {
  GOBULBI_ID_RE,
  MONTH_RE,
  gobulbiAmountError,
  gobulbiContentError,
  gobulbiSellerError,
  isCurrentMonth,
  type GobulbiBefore,
} from "@/lib/gobulbi";
import type { GobulbiResponse } from "@/lib/gobulbi-api";
import {
  AppsScriptError,
  createGobulbiInAppsScript,
  deleteGobulbiInAppsScript,
  listGobulbiFromAppsScript,
  updateGobulbiInAppsScript,
} from "@/lib/server/apps-script";

/*
 * 예산관리 고불비사용 API.
 * 화면 → (이 API, 비밀값은 서버에만) → Apps Script gobulbi.gs → 별도 시트 "고불비사용내역" 에만 저장.
 * 월별 무선장표(N·U·AB·AC 수식·판매정보)에는 아무것도 쓰지 않는다.
 *   GET  /api/budget/gobulbi?month=2026-10                      → 그 달 내역(삭제 제외)·합계
 *   POST { op: "create", month, id, content, amount, seller }  → 신규 등록 (이번 달만, 지급일 자동)
 *   POST { op: "update", id, before, content, amount, seller } → 수정 (지급일 그대로)
 *   POST { op: "delete", id, before }                          → 삭제 (행은 남기고 삭제 상태)
 * Apps Script 가 저장을 확인해 준 경우에만 ok: true 를 돌려준다.
 */

function reply(body: GobulbiResponse, status: number) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

const FAILURE: Record<AppsScriptError["code"], { status: number; message: string }> = {
  not_configured: {
    status: 503,
    message: "스프레드시트 연결 설정이 아직 완료되지 않았습니다. 관리자에게 문의해 주세요.",
  },
  timeout: {
    status: 504,
    message: "스프레드시트 응답이 늦어 처리 여부를 확인하지 못했습니다. 새로고침해 확인한 뒤 다시 시도해 주세요.",
  },
  network: { status: 502, message: "스프레드시트에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요." },
  bad_response: {
    status: 502,
    message: "스프레드시트 응답을 확인하지 못했습니다. 새로고침해 확인해 주세요.",
  },
  rejected: { status: 409, message: "고불비사용을 처리하지 못했습니다." },
};

function failure(error: unknown, what: string) {
  if (error instanceof AppsScriptError) {
    console.error(`[고불비사용] ${what} 실패 (${error.code}): ${error.message}`);
    const f = FAILURE[error.code];
    const message =
      error.code === "rejected"
        ? error.message || f.message
        : error.code === "bad_response"
          ? `${f.message} [원인: ${error.message}]`
          : f.message;
    return reply(
      { ok: false, message, notDeployed: error.details.notDeployed === true || undefined },
      f.status,
    );
  }
  console.error(`[고불비사용] ${what} 오류`, error);
  return reply({ ok: false, message: "고불비사용 처리 중 오류가 발생했습니다." }, 500);
}

export async function GET(request: Request) {
  const month = new URL(request.url).searchParams.get("month") ?? "";
  if (!MONTH_RE.test(month)) return reply({ ok: false, message: "월 형식이 올바르지 않습니다." }, 400);
  try {
    const data = await listGobulbiFromAppsScript(month);
    return reply({ ok: true, message: "", data }, 200);
  } catch (error) {
    return failure(error, "조회");
  }
}

function parseBefore(v: unknown): GobulbiBefore | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (
    typeof o.content !== "string" ||
    typeof o.amount !== "number" ||
    typeof o.seller !== "string" ||
    typeof o.updatedAt !== "string" ||
    o.content.length > 300 ||
    o.seller.length > 50 ||
    o.updatedAt.length > 40
  ) {
    return null;
  }
  return { content: o.content, amount: o.amount, seller: o.seller, updatedAt: o.updatedAt };
}

export async function POST(request: Request) {
  let input: Record<string, unknown>;
  try {
    input = ((await request.json()) ?? {}) as Record<string, unknown>;
  } catch {
    return reply({ ok: false, message: "요청 형식이 올바르지 않습니다." }, 400);
  }
  const op = input.op;
  const id = typeof input.id === "string" ? input.id : "";
  if ((op !== "create" && op !== "update" && op !== "delete") || !GOBULBI_ID_RE.test(id)) {
    return reply({ ok: false, message: "요청 형식이 올바르지 않습니다." }, 400);
  }

  let fields: { content: string; amount: number; seller: string } | null = null;
  if (op !== "delete") {
    const content = typeof input.content === "string" ? input.content.trim() : "";
    const seller = typeof input.seller === "string" ? input.seller.trim() : "";
    const problem =
      gobulbiContentError(content) ??
      gobulbiAmountError(input.amount) ??
      gobulbiSellerError(seller, STAFF_NAMES);
    if (problem) return reply({ ok: false, message: problem }, 400);
    fields = { content, amount: input.amount as number, seller };
  }

  if (op === "create") {
    const month = typeof input.month === "string" ? input.month : "";
    if (!MONTH_RE.test(month)) return reply({ ok: false, message: "월 형식이 올바르지 않습니다." }, 400);
    if (!isCurrentMonth(month, todayInKorea())) {
      return reply(
        { ok: false, message: "고불비사용 신규 등록은 이번 달 화면에서만 할 수 있습니다. 지난달은 조회·수정·삭제만 됩니다." },
        400,
      );
    }
    try {
      const r = await createGobulbiInAppsScript(month, id, fields!);
      return reply(
        { ok: true, message: r.message || "고불비사용을 등록했습니다.", item: r.item, duplicate: r.duplicate },
        200,
      );
    } catch (error) {
      return failure(error, "등록");
    }
  }

  const before = parseBefore(input.before);
  if (!before) return reply({ ok: false, message: "요청 형식이 올바르지 않습니다." }, 400);
  try {
    if (op === "update") {
      const r = await updateGobulbiInAppsScript(id, before, fields!);
      return reply({ ok: true, message: r.message || "고불비사용을 수정했습니다.", item: r.item }, 200);
    }
    const r = await deleteGobulbiInAppsScript(id, before);
    return reply({ ok: true, message: r.message || "고불비사용을 삭제했습니다." }, 200);
  } catch (error) {
    return failure(error, op === "update" ? "수정" : "삭제");
  }
}
