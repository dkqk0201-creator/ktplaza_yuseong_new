import {
  SPOT_BULK_ENDPOINT,
  type SpotBulkApplyResult,
  type SpotBulkHistoryEntry,
  type SpotBulkItem,
  type SpotCondition,
} from "@/lib/spot-bulk";

/* 화면 ↔ 우리 서버(/api/spot/bulk) 약속. Apps Script 주소·비밀값은 두지 않는다. */

export type SpotBulkResponse =
  | {
      ok: true;
      message: string;
      result?: SpotBulkApplyResult;
      history?: SpotBulkHistoryEntry[];
      undo?: { restored: number; skipped: string[]; message: string };
    }
  | { ok: false; message: string; notDeployed?: boolean };

const NETWORK_FAIL = "서버와 통신하지 못했습니다. 다시 누르지 말고 스팟관리를 새로고침해 반영 여부를 먼저 확인해 주세요.";

async function call(init: RequestInit): Promise<SpotBulkResponse> {
  try {
    const response = await fetch(SPOT_BULK_ENDPOINT, { cache: "no-store", ...init });
    const data = (await response.json()) as SpotBulkResponse;
    if (typeof data?.ok !== "boolean") throw new Error("invalid");
    if (data.ok && !response.ok) return { ok: false, message: NETWORK_FAIL };
    return data;
  } catch {
    return { ok: false, message: NETWORK_FAIL };
  }
}

export const fetchSpotBulkHistory = () => call({ method: "GET" });

export function postSpotBulkApply(requestId: string, conditions: SpotCondition[], items: SpotBulkItem[]) {
  return call({
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ op: "apply", requestId, conditions, items }),
  });
}

export function postSpotBulkUndo(requestId: string) {
  return call({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ op: "undo", requestId }) });
}
