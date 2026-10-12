import type { SaleReview } from "@/lib/inspection-review";
import type { UpdateSaleTarget } from "@/lib/update-sale-api";

/*
 * 화면 ↔ 우리 서버(/api/sales/review) 약속: 검수관리 판매 상세의 "보완 요청 저장"·"보완 요청 취소".
 * 이 파일에는 Apps Script 주소나 비밀값을 두지 않는다.
 */

export interface ReviewRequest {
  /** 화면에서 본 판매 건 (No.·개통일·고객·CTN 이 장표와 모두 같아야 저장) */
  target: UpdateSaleTarget;
  op: "save" | "cancel";
  /** 화면에서 본 진행 중 미비내용 (없으면 ""). 저장된 값과 다르면 저장하지 않는다 */
  before: string;
  /** 새 미비내용 (save) */
  content: string;
}

export type ReviewResponse =
  | { ok: true; message: string; review: SaleReview | null }
  | { ok: false; message: string };

export const REVIEW_ENDPOINT = "/api/sales/review";

export async function postReview(request: ReviewRequest): Promise<ReviewResponse> {
  try {
    const response = await fetch(REVIEW_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });
    const data = (await response.json()) as ReviewResponse;
    if (typeof data?.ok !== "boolean") throw new Error("invalid response");
    return data;
  } catch {
    return {
      ok: false,
      message: "서버와 통신하지 못했습니다. 새로고침해 저장되었는지 확인한 뒤 다시 시도해 주세요.",
    };
  }
}
