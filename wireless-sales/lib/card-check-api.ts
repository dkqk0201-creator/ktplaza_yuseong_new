import type { UpdateSaleTarget } from "@/lib/update-sale-api";

/*
 * 화면 ↔ 우리 서버(/api/sales/card-check) 약속: 카드실적 "등록완료" (AG열 = O).
 * 이 파일에는 Apps Script 주소나 비밀값을 두지 않는다.
 */

export interface CardCheckRequest {
  /** 화면에서 본 판매 건 (No.·개통일·고객·CTN 이 장표와 모두 같아야 저장) */
  target: UpdateSaleTarget;
  /** 화면에서 본 AG열 값 (빈칸·X 등). 장표의 지금 값과 다르면 저장하지 않는다 */
  before: string;
}

export type CardCheckResponse =
  | { ok: true; message: string; row: number; values: unknown[] }
  | { ok: false; message: string };

export const CARD_CHECK_ENDPOINT = "/api/sales/card-check";

export async function postCardCheck(
  request: CardCheckRequest,
): Promise<CardCheckResponse> {
  try {
    const response = await fetch(CARD_CHECK_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });
    const data = (await response.json()) as CardCheckResponse;
    if (typeof data?.ok !== "boolean") throw new Error("invalid response");
    return data;
  } catch {
    return {
      ok: false,
      message:
        "서버와 통신하지 못했습니다. 장표에 저장되었는지 새로고침해 확인한 뒤 다시 시도해 주세요.",
    };
  }
}
