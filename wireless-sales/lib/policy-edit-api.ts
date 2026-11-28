import {
  POLICY_EDIT_ENDPOINT,
  type PolicyEditApplyResult,
  type PolicyEditHistoryEntry,
  type PolicyEditItem,
} from "@/lib/policy-edit";

/* 화면 ↔ 우리 서버(/api/budget/policy) 약속. Apps Script 주소·비밀값은 두지 않는다. */

export type PolicyEditResponse =
  | {
      ok: true;
      message: string;
      result?: PolicyEditApplyResult;
      history?: PolicyEditHistoryEntry[];
      undo?: { restored: number; skipped: string[]; message: string };
    }
  | { ok: false; message: string; notDeployed?: boolean };

const NETWORK_FAIL = "서버와 통신하지 못했습니다. 다시 누르지 말고 먼저 다시 조회해 반영 여부를 확인해 주세요.";

async function call(init: RequestInit): Promise<PolicyEditResponse> {
  try {
    const response = await fetch(POLICY_EDIT_ENDPOINT, { cache: "no-store", ...init });
    const data = (await response.json()) as PolicyEditResponse;
    if (typeof data?.ok !== "boolean") throw new Error("invalid");
    if (data.ok && !response.ok) return { ok: false, message: NETWORK_FAIL };
    return data;
  } catch {
    return { ok: false, message: NETWORK_FAIL };
  }
}

export const fetchPolicyEditHistory = () => call({ method: "GET" });

export function postPolicyEditApply(requestId: string, items: PolicyEditItem[]) {
  return call({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ op: "apply", requestId, items }) });
}

export function postPolicyEditUndo(requestId: string) {
  return call({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ op: "undo", requestId }) });
}
