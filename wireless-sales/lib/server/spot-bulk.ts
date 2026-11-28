import "server-only";
import { AppsScriptError, postToAppsScript, shortText } from "@/lib/server/apps-script";
import {
  SPOT_BULK_HANDLER,
  type SpotBulkApplyResult,
  type SpotBulkHistoryEntry,
  type SpotBulkItem,
  type SpotBulkItemResult,
  type SpotCondition,
} from "@/lib/spot-bulk";

/*
 * 스팟예산 일괄등록 — Apps Script spot-bulk.gs 와 통신 (비밀값은 apps-script.ts 에서만).
 * spot-bulk.gs 가 대답한 응답(handler 표시)만 믿는다. 예전 Apps Script 면 아무것도 쓰지 않고 "배포 안 됨".
 */

const NOT_DEPLOYED =
  "Apps Script에 충청 일괄등록 코드(spot-bulk.gs)와 최신 update-handler.gs 가 배포되어 있지 않아 처리하지 않았습니다.";

async function postSpotBulk(payload: Record<string, unknown>, rejected: string, timeoutMs = 60_000) {
  let data: Record<string, unknown>;
  try {
    data = await postToAppsScript({ action: "spot-bulk", ...payload }, rejected, timeoutMs);
  } catch (error) {
    if (error instanceof AppsScriptError && error.code === "rejected" && error.details.handler !== SPOT_BULK_HANDLER) {
      throw new AppsScriptError("rejected", NOT_DEPLOYED, { notDeployed: true });
    }
    throw error;
  }
  if (data.handler !== SPOT_BULK_HANDLER) throw new AppsScriptError("rejected", NOT_DEPLOYED, { notDeployed: true });
  return data;
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

export async function applySpotBulkInAppsScript(
  requestId: string,
  conditions: SpotCondition[],
  items: SpotBulkItem[],
): Promise<SpotBulkApplyResult> {
  const data = await postSpotBulk(
    { op: "apply", requestId, operator: "점장(웹앱)", conditions, items },
    "Apps Script가 충청 일괄등록을 거부했습니다.",
    // 판매 수만큼 읽기·쓰기가 늘어나므로 넉넉하게
    120_000,
  );
  if (data.requestId !== requestId) throw new AppsScriptError("bad_response", "충청 일괄등록 응답을 확인하지 못했습니다.");
  const repeated = data.repeated === true;
  const results: SpotBulkItemResult[] = Array.isArray(data.results)
    ? data.results.map((r) => {
        const o = (r ?? {}) as Record<string, unknown>;
        return { sheet: shortText(o.sheet, 4), row: num(o.row), ok: o.ok === true, message: shortText(o.message, 200) };
      })
    : [];
  if (!repeated && results.length !== items.length) {
    throw new AppsScriptError("bad_response", "충청 일괄등록 응답에 건별 결과가 없습니다. 충청관리에서 반영 여부를 확인해 주세요.");
  }
  return { requestId, repeated, applied: num(data.applied), failed: num(data.failed), amount: num(data.amount), results };
}

export async function listSpotBulkHistoryFromAppsScript(): Promise<SpotBulkHistoryEntry[]> {
  const data = await postSpotBulk({ op: "history" }, "Apps Script가 일괄등록 이력 조회를 거부했습니다.", 30_000);
  if (!Array.isArray(data.items)) return [];
  return data.items.slice(0, 20).map((r) => {
    const o = (r ?? {}) as Record<string, unknown>;
    return {
      requestId: shortText(o.requestId, 64),
      appliedAt: shortText(o.appliedAt, 30),
      operator: shortText(o.operator, 20),
      conditions: shortText(o.conditions, 1000),
      sales: num(o.sales),
      amount: num(o.amount),
      status: shortText(o.status, 10),
    };
  });
}

export async function undoSpotBulkInAppsScript(requestId: string): Promise<{ restored: number; skipped: string[]; message: string }> {
  const data = await postSpotBulk({ op: "undo", requestId }, "Apps Script가 되돌리기를 거부했습니다.", 120_000);
  return {
    restored: num(data.restored),
    skipped: Array.isArray(data.skipped) ? data.skipped.slice(0, 300).map((s) => shortText(s, 200)) : [],
    message: shortText(data.message),
  };
}
