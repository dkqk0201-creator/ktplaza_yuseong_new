import {
  GOBULBI_ENDPOINT,
  type GobulbiBefore,
  type GobulbiItem,
  type GobulbiMonth,
} from "@/lib/gobulbi";

/*
 * 화면 ↔ 우리 서버(/api/budget/gobulbi) 약속. 이 파일에는 Apps Script 주소나 비밀값을 두지 않는다.
 */

export type GobulbiResponse =
  | { ok: true; message: string; data?: GobulbiMonth; item?: GobulbiItem; duplicate?: boolean }
  | { ok: false; message: string; notDeployed?: boolean };

export type GobulbiRequest =
  | { op: "create"; month: string; id: string; content: string; amount: number; seller: string }
  | { op: "update"; id: string; before: GobulbiBefore; content: string; amount: number; seller: string }
  | { op: "delete"; id: string; before: GobulbiBefore };

const NETWORK_FAIL = "서버와 통신하지 못했습니다. 새로고침해 저장되었는지 확인한 뒤 다시 시도해 주세요.";

async function call(init: RequestInit, url = GOBULBI_ENDPOINT): Promise<GobulbiResponse> {
  try {
    const response = await fetch(url, { cache: "no-store", ...init });
    const data = (await response.json()) as GobulbiResponse;
    if (typeof data?.ok !== "boolean") throw new Error("invalid response");
    // 서버가 실패 상태 코드인데 ok: true 라고 하면 믿지 않는다
    if (data.ok && !response.ok) return { ok: false, message: NETWORK_FAIL };
    return data;
  } catch {
    return { ok: false, message: NETWORK_FAIL };
  }
}

export function fetchGobulbi(month: string): Promise<GobulbiResponse> {
  return call({ method: "GET" }, `${GOBULBI_ENDPOINT}?month=${encodeURIComponent(month)}`);
}

export function postGobulbi(request: GobulbiRequest): Promise<GobulbiResponse> {
  return call({
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
}
