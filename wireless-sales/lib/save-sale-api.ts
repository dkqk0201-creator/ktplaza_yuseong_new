/*
 * 화면 ↔ 우리 서버(/api/sales/quick) 사이의 저장 응답 약속.
 * 이 파일에는 Apps Script 주소나 비밀값을 절대 두지 않는다.
 */

export type SaveSaleResponse =
  | { ok: true; sheet: string; no: string; row: number }
  | { ok: false; message: string; errors?: string[] };

/** 간편등록 여러 건 저장 응답: 보낸 순서대로 건별 결과 */
export type QuickBatchResponse =
  | { ok: true; results: SaveSaleResponse[] }
  | { ok: false; message: string };
