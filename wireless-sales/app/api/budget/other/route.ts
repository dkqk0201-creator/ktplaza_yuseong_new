import { requireAuth } from "@/lib/server/auth";
import { AppsScriptError } from "@/lib/server/apps-script";
import {
  changeOtherBudgetStatusInAppsScript,
  createOtherBudgetInAppsScript,
  listOtherBudgetFromAppsScript,
  updateOtherBudgetInAppsScript,
} from "@/lib/server/other-budget";
import { OTHER_ID_RE, OTHER_MONTH_RE, otherInputError, type OtherBudgetBefore, type OtherKind } from "@/lib/other-budget";
import type { OtherBudgetResponse } from "@/lib/other-budget-api";

/*
 * 예산관리 기타 예산 API (관리자 로그인 필요).
 * 화면 → (이 API) → Apps Script other-budget.gs → 별도 시트 "기타예산내역"·"기타예산변경이력" 에만 저장.
 *   GET  /api/budget/other?month=2026-11                               → 그 달 항목·삭제 항목·확보/차감/순증감
 *   POST { op: "create", month, id, name, kind, amount, memo }         → 등록 (같은 ID 재전송은 중복 저장 안 함)
 *   POST { op: "update", id, before, name, kind, amount, memo }        → 수정 (화면에서 본 값과 같을 때만)
 *   POST { op: "delete" | "restore", id, before }                      → 삭제(행은 남김) / 복구
 */

function reply(body: OtherBudgetResponse, status: number) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

const FAILURE: Record<AppsScriptError["code"], { status: number; message: string }> = {
  not_configured: { status: 503, message: "스프레드시트 연결 설정이 아직 완료되지 않았습니다." },
  timeout: { status: 504, message: "스프레드시트 응답이 늦어 처리 여부를 확인하지 못했습니다. 새로고침해 확인한 뒤 다시 시도해 주세요." },
  network: { status: 502, message: "스프레드시트에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요." },
  bad_response: { status: 502, message: "스프레드시트 응답을 확인하지 못했습니다. 새로고침해 확인해 주세요." },
  rejected: { status: 409, message: "기타 예산을 처리하지 못했습니다." },
};

function failure(error: unknown, what: string) {
  if (error instanceof AppsScriptError) {
    console.error(`[기타 예산] ${what} 실패 (${error.code}): ${error.message}`);
    const f = FAILURE[error.code];
    const message =
      error.code === "rejected" ? error.message || f.message : error.code === "bad_response" ? `${f.message} [원인: ${error.message}]` : f.message;
    return reply({ ok: false, message, notDeployed: error.details.notDeployed === true || undefined }, f.status);
  }
  console.error(`[기타 예산] ${what} 오류`, error);
  return reply({ ok: false, message: "기타 예산 처리 중 오류가 발생했습니다." }, 500);
}

export async function GET(request: Request) {
  const denied = await requireAuth(request);
  if (denied) return denied;
  const month = new URL(request.url).searchParams.get("month") ?? "";
  if (!OTHER_MONTH_RE.test(month)) return reply({ ok: false, message: "월 형식이 올바르지 않습니다." }, 400);
  try {
    return reply({ ok: true, message: "", data: await listOtherBudgetFromAppsScript(month) }, 200);
  } catch (error) {
    return failure(error, "조회");
  }
}

function parseBefore(v: unknown): OtherBudgetBefore | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (
    typeof o.name !== "string" ||
    (o.kind !== "gain" && o.kind !== "deduct") ||
    typeof o.amount !== "number" ||
    typeof o.memo !== "string" ||
    typeof o.updatedAt !== "string" ||
    o.name.length > 100 ||
    o.memo.length > 200 ||
    o.updatedAt.length > 40
  ) {
    return null;
  }
  return { name: o.name, kind: o.kind as OtherKind, amount: o.amount, memo: o.memo, updatedAt: o.updatedAt };
}

export async function POST(request: Request) {
  const denied = await requireAuth(request);
  if (denied) return denied;
  let input: Record<string, unknown>;
  try {
    input = ((await request.json()) ?? {}) as Record<string, unknown>;
  } catch {
    return reply({ ok: false, message: "요청 형식이 올바르지 않습니다." }, 400);
  }
  const op = input.op;
  const id = typeof input.id === "string" ? input.id : "";
  if ((op !== "create" && op !== "update" && op !== "delete" && op !== "restore") || !OTHER_ID_RE.test(id)) {
    return reply({ ok: false, message: "요청 형식이 올바르지 않습니다." }, 400);
  }
  let fields: { name: string; kind: OtherKind; amount: number; memo: string } | null = null;
  if (op === "create" || op === "update") {
    const memo = input.memo === undefined ? "" : input.memo;
    const problem = otherInputError({ name: input.name, kind: input.kind, amount: input.amount, memo });
    if (problem) return reply({ ok: false, message: problem }, 400);
    fields = {
      name: (input.name as string).trim(),
      kind: input.kind as OtherKind,
      amount: input.amount as number,
      memo: (memo as string).trim(),
    };
  }
  if (op === "create") {
    const month = typeof input.month === "string" ? input.month : "";
    if (!OTHER_MONTH_RE.test(month) || month < "2024-01" || month > "2099-12") {
      return reply({ ok: false, message: "적용 월 형식이 올바르지 않습니다." }, 400);
    }
    try {
      const r = await createOtherBudgetInAppsScript(month, id, fields!);
      return reply({ ok: true, message: r.message || "기타 예산을 등록했습니다.", item: r.item, duplicate: r.duplicate }, 200);
    } catch (error) {
      return failure(error, "등록");
    }
  }
  const before = parseBefore(input.before);
  if (!before) return reply({ ok: false, message: "요청 형식이 올바르지 않습니다." }, 400);
  try {
    if (op === "update") {
      const r = await updateOtherBudgetInAppsScript(id, before, fields!);
      return reply({ ok: true, message: r.message || "기타 예산을 수정했습니다.", item: r.item }, 200);
    }
    const r = await changeOtherBudgetStatusInAppsScript(op, id, before);
    return reply({ ok: true, message: r.message, item: r.item }, 200);
  } catch (error) {
    return failure(error, op === "update" ? "수정" : op === "delete" ? "삭제" : "복구");
  }
}
