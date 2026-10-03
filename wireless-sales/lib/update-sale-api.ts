import type { DeleteSaleRequest } from "@/lib/delete-sale-api";
import type { SaleChange } from "@/lib/sale-edit";

/*
 * 화면 ↔ 우리 서버(/api/sales/update) 사이의 약속 (기존 판매 수정).
 * 이 파일에는 Apps Script 주소나 비밀값을 절대 두지 않는다.
 */

/** 수정할 판매 건: 삭제와 같은 확인용 값(화면에서 본 위치·No.·개통일·고객·CTN) */
export type UpdateSaleTarget = DeleteSaleRequest;

export interface UpdateSaleRequest {
  target: UpdateSaleTarget;
  changes: SaleChange[];
}

export type UpdateSaleResponse =
  | { ok: true; message: string; row: number; no: string; values: unknown[] }
  | { ok: false; message: string; errors?: string[] };

export const UPDATE_SALE_ENDPOINT = "/api/sales/update";

export async function postUpdateSale(
  request: UpdateSaleRequest,
): Promise<UpdateSaleResponse> {
  try {
    const response = await fetch(UPDATE_SALE_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });
    const data = (await response.json()) as UpdateSaleResponse;
    if (typeof data?.ok !== "boolean") throw new Error("invalid response");
    return data;
  } catch {
    return {
      ok: false,
      message:
        "서버와 통신하지 못했습니다. 장표에 수정되었는지 확인한 뒤 다시 시도해 주세요.",
    };
  }
}
