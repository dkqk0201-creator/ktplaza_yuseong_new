import "server-only";
import { AppsScriptError, postToAppsScript, shortText } from "@/lib/server/apps-script";
import {
  POLICY_EDIT_HANDLER,
  type PolicyEditApplyResult,
  type PolicyEditHistoryEntry,
  type PolicyEditItem,
  type PolicyEditItemResult,
} from "@/lib/policy-edit";

/*
 * 정책 확보 관리 — Apps Script policy-edit.gs 와 통신 (비밀값은 apps-script.ts 에서만).
 * policy-edit.gs 가 대답한 응답(handler 표시)만 믿는다. 예전 Apps Script 면 아무것도 쓰지 않고 "배포 안 됨".
 */

const NOT_DEPLOYED =
  "Apps Script에 정책 확보 관리 코드(policy-edit.gs)와 최신 update-handler.gs 가 배포되어 있지 않아 처리하지 않았습니다.";

async function postPolicyEdit(payload: Record<string, unknown>, rejected: string, timeoutMs = 60_000) {
  let data: Record<string, unknown>;
  try {
    data = await postToAppsScript({ action: "policy-edit", ...payload }, rejected, timeoutMs);
  } catch (error) {
    if (error instanceof AppsScriptError && error.code === "rejected" && error.details.handler !== POLICY_EDIT_HANDLER) {
      throw new AppsScriptError("rejected", NOT_DEPLOYED, { notDeployed: true });
    }
    throw error;
  }
  if (data.handler !== POLICY_EDIT_HANDLER) throw new AppsScriptError("rejected", NOT_DEPLOYED, { notDeployed: true });
  return data;
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

export async function applyPolicyEditInAppsScript(requestId: string, items: PolicyEditItem[]): Promise<PolicyEditApplyResult> {
  const data = await postPolicyEdit(
    { op: "apply", requestId, operator: "점장(웹앱)", items },
    "Apps Script가 정책 확보금액 수정을 거부했습니다.",
    120_000,
  );
  if (data.requestId !== requestId) throw new AppsScriptError("bad_response", "정책 확보금액 수정 응답을 확인하지 못했습니다.");
  const repeated = data.repeated === true;
  const results: PolicyEditItemResult[] = Array.isArray(data.results)
    ? data.results.map((r) => {
        const o = (r ?? {}) as Record<string, unknown>;
        return { sheet: shortText(o.sheet, 4), row: num(o.row), ok: o.ok === true, message: shortText(o.message, 200) };
      })
    : [];
  if (!repeated && results.length !== items.length) {
    throw new AppsScriptError("bad_response", "정책 확보금액 수정 응답에 건별 결과가 없습니다. 다시 조회해 반영 여부를 확인해 주세요.");
  }
  return { requestId, repeated, applied: num(data.applied), failed: num(data.failed), delta: num(data.delta), results };
}

export async function listPolicyEditHistoryFromAppsScript(): Promise<PolicyEditHistoryEntry[]> {
  const data = await postPolicyEdit({ op: "history" }, "Apps Script가 수정 이력 조회를 거부했습니다.", 30_000);
  if (!Array.isArray(data.items)) return [];
  return data.items.slice(0, 20).map((r) => {
    const o = (r ?? {}) as Record<string, unknown>;
    return {
      requestId: shortText(o.requestId, 64),
      savedAt: shortText(o.savedAt, 30),
      operator: shortText(o.operator, 20),
      sales: num(o.sales),
      delta: num(o.delta),
      second: num(o.second),
      other: num(o.other),
      benefit: num(o.benefit),
      status: shortText(o.status, 10),
    };
  });
}

export async function undoPolicyEditInAppsScript(requestId: string): Promise<{ restored: number; skipped: string[]; message: string }> {
  const data = await postPolicyEdit({ op: "undo", requestId }, "Apps Script가 되돌리기를 거부했습니다.", 120_000);
  return {
    restored: num(data.restored),
    skipped: Array.isArray(data.skipped) ? data.skipped.slice(0, 300).map((s) => shortText(s, 200)) : [],
    message: shortText(data.message),
  };
}
