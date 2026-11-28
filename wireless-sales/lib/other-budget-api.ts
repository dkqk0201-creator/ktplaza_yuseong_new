import {
  OTHER_BUDGET_ENDPOINT,
  type OtherBudgetBefore,
  type OtherBudgetInput,
  type OtherBudgetItem,
  type OtherBudgetMonth,
} from "@/lib/other-budget";

/* 화면 ↔ 우리 서버(/api/budget/other) 약속. Apps Script 주소·비밀값은 두지 않는다. */

export type OtherBudgetResponse =
  | { ok: true; message: string; data?: OtherBudgetMonth; item?: OtherBudgetItem; duplicate?: boolean }
  | { ok: false; message: string; notDeployed?: boolean };

export type OtherBudgetRequest =
  | ({ op: "create"; month: string; id: string } & OtherBudgetInput)
  | ({ op: "update"; id: string; before: OtherBudgetBefore } & OtherBudgetInput)
  | { op: "delete" | "restore"; id: string; before: OtherBudgetBefore };

const NETWORK_FAIL = "서버와 통신하지 못했습니다. 새로고침해 저장되었는지 확인한 뒤 다시 시도해 주세요.";

async function call(init: RequestInit, url = OTHER_BUDGET_ENDPOINT): Promise<OtherBudgetResponse> {
  try {
    const response = await fetch(url, { cache: "no-store", ...init });
    const data = (await response.json()) as OtherBudgetResponse;
    if (typeof data?.ok !== "boolean") throw new Error("invalid");
    if (data.ok && !response.ok) return { ok: false, message: NETWORK_FAIL };
    return data;
  } catch {
    return { ok: false, message: NETWORK_FAIL };
  }
}

export function fetchOtherBudget(month: string): Promise<OtherBudgetResponse> {
  return call({ method: "GET" }, `${OTHER_BUDGET_ENDPOINT}?month=${encodeURIComponent(month)}`);
}

export function postOtherBudget(request: OtherBudgetRequest): Promise<OtherBudgetResponse> {
  return call({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request) });
}
