import { requireAuth } from "@/lib/server/auth";
import { AppsScriptError } from "@/lib/server/apps-script";
import {
  applySpotBulkInAppsScript,
  listSpotBulkHistoryFromAppsScript,
  undoSpotBulkInAppsScript,
} from "@/lib/server/spot-bulk";
import {
  SPOT_BULK_MAX_CONDITIONS,
  SPOT_BULK_MAX_ITEMS,
  SPOT_ID_RE,
  normalizeModel,
  parseBulkItem,
  parseCondition,
  type SpotBulkItem,
  type SpotCondition,
} from "@/lib/spot-bulk";
import type { SpotBulkResponse } from "@/lib/spot-bulk-api";

/*
 * 스팟관리 스팟예산 일괄등록 API (관리자 로그인 필요).
 * 화면 → (이 API, 비밀값은 서버에만) → Apps Script spot-bulk.gs → 월 시트 O열 값·메모 + 별도 시트 "스팟일괄등록이력".
 *   GET  /api/spot/bulk                                       → 최근 일괄등록 이력 (요청별)
 *   POST { op: "apply", requestId, conditions, items }        → 최종 등록 (Apps Script 가 잠금 안에서 판매별 재확인)
 *   POST { op: "undo", requestId }                            → 되돌리기 (등록 후 바뀌지 않은 판매만)
 * 미리보기는 화면이 판매내역 조회 결과로 계산한다 (저장 없음).
 */

function reply(body: SpotBulkResponse, status: number) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

const FAILURE: Record<AppsScriptError["code"], { status: number; message: string }> = {
  not_configured: { status: 503, message: "스프레드시트 연결 설정이 아직 완료되지 않았습니다." },
  timeout: {
    status: 504,
    message: "스프레드시트 응답이 늦어 처리 여부를 확인하지 못했습니다. 다시 누르지 말고 먼저 스팟관리를 새로고침해 반영 여부를 확인해 주세요.",
  },
  network: { status: 502, message: "스프레드시트에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요." },
  bad_response: { status: 502, message: "스프레드시트 응답을 확인하지 못했습니다. 새로고침해 확인해 주세요." },
  rejected: { status: 409, message: "스팟 일괄등록을 처리하지 못했습니다." },
};

function failure(error: unknown, what: string) {
  if (error instanceof AppsScriptError) {
    console.error(`[스팟 일괄등록] ${what} 실패 (${error.code}): ${error.message}`);
    const f = FAILURE[error.code];
    const message =
      error.code === "rejected" ? error.message || f.message : error.code === "bad_response" ? `${f.message} [원인: ${error.message}]` : f.message;
    return reply({ ok: false, message, notDeployed: error.details.notDeployed === true || undefined }, f.status);
  }
  console.error(`[스팟 일괄등록] ${what} 오류`, error);
  return reply({ ok: false, message: "스팟 일괄등록 처리 중 오류가 발생했습니다." }, 500);
}

export async function GET(request: Request) {
  // 로그인 확인이 가장 먼저 (통과 전에는 Apps Script 로 아무것도 보내지 않음)
  const denied = await requireAuth(request);
  if (denied) return denied;
  try {
    return reply({ ok: true, message: "", history: await listSpotBulkHistoryFromAppsScript() }, 200);
  } catch (error) {
    return failure(error, "이력 조회");
  }
}

/** 판매의 개통일·모델이 그 스팟 조건에 맞는지 (Apps Script 가 장표 값으로 한 번 더 확인) */
function itemMatches(item: SpotBulkItem, byId: Map<string, SpotCondition>): boolean {
  return item.adds.every((a) => {
    const c = byId.get(a.conditionId);
    if (!c || c.spot !== a.spot || c.amount !== a.amount) return false;
    if (item.activatedAt < c.from || item.activatedAt > c.to) return false;
    return c.models.length === 0 || c.models.includes(normalizeModel(item.model));
  });
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
  if (!SPOT_ID_RE.test(requestId) || (input.op !== "apply" && input.op !== "undo")) {
    return reply({ ok: false, message: "요청 형식이 올바르지 않습니다." }, 400);
  }

  if (input.op === "undo") {
    try {
      const r = await undoSpotBulkInAppsScript(requestId);
      return reply({ ok: true, message: r.message, undo: r }, 200);
    } catch (error) {
      return failure(error, "되돌리기");
    }
  }

  const rawConditions = Array.isArray(input.conditions) ? input.conditions : null;
  const rawItems = Array.isArray(input.items) ? input.items : null;
  if (!rawConditions || rawConditions.length === 0 || rawConditions.length > SPOT_BULK_MAX_CONDITIONS) {
    return reply({ ok: false, message: "적용 조건을 확인해 주세요." }, 400);
  }
  if (!rawItems || rawItems.length === 0 || rawItems.length > SPOT_BULK_MAX_ITEMS) {
    return reply({ ok: false, message: `한 번에 1~${SPOT_BULK_MAX_ITEMS}건까지 등록할 수 있습니다.` }, 400);
  }
  const conditions: SpotCondition[] = [];
  for (const raw of rawConditions) {
    const c = parseCondition(raw);
    if (!c || conditions.some((x) => x.id === c.id)) return reply({ ok: false, message: "적용 조건 형식이 올바르지 않습니다." }, 400);
    conditions.push(c);
  }
  const byId = new Map(conditions.map((c) => [c.id, c]));
  const ids = new Set(byId.keys());
  const items: SpotBulkItem[] = [];
  const seen = new Set<string>();
  for (const raw of rawItems) {
    const item = parseBulkItem(raw, ids);
    if (!item || !itemMatches(item, byId)) return reply({ ok: false, message: "적용 대상 형식이 올바르지 않습니다. 다시 조회해 주세요." }, 400);
    const key = `${item.sheet}:${item.row}`;
    if (seen.has(key)) return reply({ ok: false, message: "같은 판매가 두 번 들어 있습니다. 다시 조회해 주세요." }, 400);
    seen.add(key);
    items.push(item);
  }
  try {
    const result = await applySpotBulkInAppsScript(requestId, conditions, items);
    return reply(
      {
        ok: true,
        message: result.repeated ? "이미 처리된 요청입니다 (다시 저장하지 않음)." : `${result.applied}건 적용${result.failed ? `, ${result.failed}건 실패` : ""}`,
        result,
      },
      200,
    );
  } catch (error) {
    return failure(error, "등록");
  }
}
