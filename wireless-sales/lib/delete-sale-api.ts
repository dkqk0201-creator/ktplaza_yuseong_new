/*
 * 화면 ↔ 우리 서버(/api/sales/delete) 사이의 약속.
 * 이 파일에는 Apps Script 주소나 비밀값을 절대 두지 않는다.
 */

/** 삭제할 판매 건: 화면에서 본 위치와, 장표와 대조할 확인용 값 */
export interface DeleteSaleRequest {
  sheet: string;
  row: number;
  no: string;
  activatedAt: string;
  customer: string;
  ctn: string;
}

export type DeleteSaleResponse =
  | { ok: true; message: string }
  | { ok: false; message: string };

export const DELETE_SALE_ENDPOINT = "/api/sales/delete";

export async function postDeleteSale(
  target: DeleteSaleRequest,
): Promise<DeleteSaleResponse> {
  try {
    const response = await fetch(DELETE_SALE_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(target),
    });
    const data = (await response.json()) as DeleteSaleResponse;
    if (typeof data?.ok !== "boolean") throw new Error("invalid response");
    return data;
  } catch {
    return {
      ok: false,
      message:
        "서버와 통신하지 못했습니다. 장표에서 삭제되었는지 확인한 뒤 다시 시도해 주세요.",
    };
  }
}
