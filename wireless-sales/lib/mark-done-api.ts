import type { UpdateSaleTarget } from "@/lib/update-sale-api";

/*
 * 화면 ↔ 우리 서버(/api/sales/mark-done) 약속: 검수관리 판매 상세의 "검수완료"(G열)·"수납완료"(H열).
 * 이 파일에는 Apps Script 주소나 비밀값을 두지 않는다.
 */

/** O 로 바꿀 수 있는 상태 칸: 검수(G) · 수납(H) · 카드실적 검수(AG) */
export type MarkDoneField = "inspected" | "paid" | "cardChecked";
export const MARK_DONE_FIELDS: readonly MarkDoneField[] = ["inspected", "paid"];

export const MARK_DONE_LABEL: Record<"inspected" | "paid", string> = {
  inspected: "검수완료",
  paid: "수납완료",
};

export interface MarkDoneRequest {
  /** 화면에서 본 판매 건 (No.·개통일·고객·CTN 이 장표와 모두 같아야 저장) */
  target: UpdateSaleTarget;
  field: "inspected" | "paid";
  /** 화면에서 본 그 칸의 값 (빈칸·X 등). 장표의 지금 값과 다르면 저장하지 않는다 */
  before: string;
}

export type MarkDoneResponse =
  | { ok: true; message: string; row: number; no: string; values: unknown[] }
  | { ok: false; message: string };

export const MARK_DONE_ENDPOINT = "/api/sales/mark-done";

export async function postMarkDone(request: MarkDoneRequest): Promise<MarkDoneResponse> {
  try {
    const response = await fetch(MARK_DONE_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });
    const data = (await response.json()) as MarkDoneResponse;
    if (typeof data?.ok !== "boolean") throw new Error("invalid response");
    return data;
  } catch {
    return {
      ok: false,
      message: "서버와 통신하지 못했습니다. 장표에 저장되었는지 새로고침해 확인한 뒤 다시 시도해 주세요.",
    };
  }
}
