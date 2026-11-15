import type { DeleteSaleRequest } from "@/lib/delete-sale-api";
import type { SaleChange } from "@/lib/sale-edit";
import type { NoteChange } from "@/lib/sale-form-layout";
import type { SaleLink, SaleLinkField } from "@/lib/sale-link";

/*
 * 화면 ↔ 우리 서버(/api/sales/update) 사이의 약속 (기존 판매 수정).
 * 이 파일에는 Apps Script 주소나 비밀값을 절대 두지 않는다.
 */

/** 수정할 판매 건: 삭제와 같은 확인용 값(화면에서 본 위치·No.·개통일·고객·CTN) */
export type UpdateSaleTarget = DeleteSaleRequest;

export interface UpdateSaleRequest {
  target: UpdateSaleTarget;
  /** 바꾼 칸 (N·U·AB·AC 자동 항목이 섞여 있어도 서버가 버림 — 장표 수식이 계산) */
  changes: SaleChange[];
  /**
   * 정책명(S열 모델정책 금액의 정책명) 변경. 장표가 아니라 웹앱참고 보조 시트에 보관.
   * before = 화면에서 본 값, after = 새 값 ("" = 지우기). 바뀌었을 때만 보낸다.
   */
  policyName?: { before: string; after: string };
  /**
   * 참고 항목(장표 저장 안 함, 웹앱참고 보관) 변경: 바꾼 항목만. before = 화면에서 본 값, after = 새 값 ("" = 지우기).
   * 바꾸지 않은 참고 항목은 그대로 남는다.
   */
  notes?: NoteChange[];
  /**
   * 판매연결(유입경로·캠페인·리본) 변경 — 판매 수정과 같은 요청·같은 잠금에서 저장 (2026-11-15 통합 저장).
   * saleId = 화면에서 본 판매 ID ("" = 예전 판매), staff = 판매 직원명(직원 ID 기록용), patches = 바꾼 항목만.
   */
  link?: { saleId: string; staff: string; patches: { field: SaleLinkField; before: string; value: string }[] };
}

export type UpdateSaleResponse =
  | {
      ok: true;
      message: string;
      row: number;
      no: string;
      values: unknown[];
      /** 정책명을 보냈을 때: 저장 후 이 판매의 참고내용 */
      notes?: Record<string, string>;
      /** 장표 칸은 수정됐지만 정책명은 저장하지 못한 경우 등 */
      warning?: string;
      /** link 를 보냈을 때: 저장된 판매연결 */
      saleId?: string;
      link?: SaleLink;
      /** link 를 보냈는데 판매연결만 저장하지 못함 (장표 수정은 완료) → 판매연결만 다시 저장 */
      linkPending?: boolean;
    }
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
