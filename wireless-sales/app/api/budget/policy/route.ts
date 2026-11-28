import { requireAuth } from "@/lib/server/auth";
import { AppsScriptError } from "@/lib/server/apps-script";
import {
  applyPolicyEditInAppsScript,
  listPolicyEditHistoryFromAppsScript,
  undoPolicyEditInAppsScript,
} from "@/lib/server/policy-edit";
import { POLICY_EDIT_MAX_ITEMS, POLICY_ID_RE, parseEditItem, type PolicyEditItem } from "@/lib/policy-edit";
import type { PolicyEditResponse } from "@/lib/policy-edit-api";

/*
 * 예산관리 "정책 확보 관리" API (관리자 로그인 필요).
 * 화면 → (이 API, 비밀값은 서버에만) → Apps Script policy-edit.gs → 월 시트 R·S·T 값 + 별도 시트 "정책확보수정이력".
 *   GET  /api/budget/policy                         → 최근 수정 이력 (요청별)
 *   POST { op: "apply", requestId, items }          → 수정 저장 (Apps Script 가 잠금 안에서 판매별 재확인)
 *   POST { op: "undo", requestId }                  → 되돌리기 (수정 후 바뀌지 않은 판매만)
 * 조회는 화면이 판매내역 조회 결과로 한다 (저장 없음).
 */

function reply(body: PolicyEditResponse, status: number) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

const FAILURE: Record<AppsScriptError["code"], { status: number; message: string }> = {
  not_configured: { status: 503, message: "스프레드시트 연결 설정이 아직 완료되지 않았습니다." },
  timeout: {
    status: 504,
    message: "스프레드시트 응답이 늦어 처리 여부를 확인하지 못했습니다. 다시 누르지 말고 먼저 다시 조회해 반영 여부를 확인해 주세요.",
  },
  network: { status: 502, message: "스프레드시트에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요." },
  bad_response: { status: 502, message: "스프레드시트 응답을 확인하지 못했습니다. 다시 조회해 확인해 주세요." },
  rejected: { status: 409, message: "정책 확보금액 수정을 처리하지 못했습니다." },
};

function failure(error: unknown, what: string) {
  if (error instanceof AppsScriptError) {
    console.error(`[정책 확보 관리] ${what} 실패 (${error.code}): ${error.message}`);
    const f = FAILURE[error.code];
    const message =
      error.code === "rejected" ? error.message || f.message : error.code === "bad_response" ? `${f.message} [원인: ${error.message}]` : f.message;
    return reply({ ok: false, message, notDeployed: error.details.notDeployed === true || undefined }, f.status);
  }
  console.error(`[정책 확보 관리] ${what} 오류`, error);
  return reply({ ok: false, message: "정책 확보금액 수정 처리 중 오류가 발생했습니다." }, 500);
}

export async function GET(request: Request) {
  // 로그인 확인이 가장 먼저 (통과 전에는 Apps Script 로 아무것도 보내지 않음)
  const denied = await requireAuth(request);
  if (denied) return denied;
  try {
    return reply({ ok: true, message: "", history: await listPolicyEditHistoryFromAppsScript() }, 200);
  } catch (error) {
    return failure(error, "이력 조회");
  }
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
  const requestId = typeof input.requestId === "string" ? input.requestId : "";
  if (!POLICY_ID_RE.test(requestId) || (input.op !== "apply" && input.op !== "undo")) {
    return reply({ ok: false, message: "요청 형식이 올바르지 않습니다." }, 400);
  }

  if (input.op === "undo") {
    try {
      const r = await undoPolicyEditInAppsScript(requestId);
      return reply({ ok: true, message: r.message, undo: r }, 200);
    } catch (error) {
      return failure(error, "되돌리기");
    }
  }

  const rawItems = Array.isArray(input.items) ? input.items : null;
  if (!rawItems || rawItems.length === 0 || rawItems.length > POLICY_EDIT_MAX_ITEMS) {
    return reply({ ok: false, message: `한 번에 1~${POLICY_EDIT_MAX_ITEMS}건까지 저장할 수 있습니다.` }, 400);
  }
  const items: PolicyEditItem[] = [];
  const seen = new Set<string>();
  for (const raw of rawItems) {
    const item = parseEditItem(raw);
    if (!item) return reply({ ok: false, message: "수정 내용 형식이 올바르지 않습니다. 다시 조회해 주세요." }, 400);
    const key = `${item.sheet}:${item.row}`;
    if (seen.has(key)) return reply({ ok: false, message: "같은 판매가 두 번 들어 있습니다. 다시 조회해 주세요." }, 400);
    seen.add(key);
    items.push(item);
  }
  try {
    const result = await applyPolicyEditInAppsScript(requestId, items);
    return reply(
      {
        ok: true,
        message: result.repeated ? "이미 처리된 요청입니다 (다시 저장하지 않음)." : `${result.applied}건 수정${result.failed ? `, ${result.failed}건 실패` : ""}`,
        result,
      },
      200,
    );
  } catch (error) {
    return failure(error, "수정 저장");
  }
}
