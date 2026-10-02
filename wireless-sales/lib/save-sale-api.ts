import type { SaleFormValues } from "@/lib/sale-form";

/*
 * 화면 ↔ 우리 서버(/api/sales) 사이의 약속.
 * 이 파일에는 Apps Script 주소나 비밀값을 절대 두지 않는다.
 */

export type SaveSaleResponse =
  | { ok: true; sheet: string; no: string; row: number }
  | { ok: false; message: string; errors?: string[] };

export const SAVE_SALE_ENDPOINT = "/api/sales";

/** 판매 1건을 우리 서버로 보낸다. 통신 실패도 { ok: false }로 돌려준다. */
export async function postSale(
  values: SaleFormValues,
): Promise<SaveSaleResponse> {
  try {
    const response = await fetch(SAVE_SALE_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values),
    });
    const data = (await response.json()) as SaveSaleResponse;
    if (typeof data?.ok !== "boolean") throw new Error("invalid response");
    return data;
  } catch {
    return {
      ok: false,
      message:
        "서버와 통신하지 못했습니다. 인터넷 연결을 확인한 뒤 다시 시도해 주세요.",
    };
  }
}
