import "server-only";
import type { UpdateSaleTarget } from "@/lib/update-sale-api";
import { AppsScriptError, updateRowInAppsScript } from "@/lib/server/apps-script";
import { COLUMN_INDEX } from "@/lib/sheet-columns";
import { cellText } from "@/lib/sheet-record";
import type { MarkDoneField } from "@/lib/mark-done-api";

/*
 * 판매 1건의 상태 칸 하나만 O 로 저장 (검수 G열 · 수납 H열 · 카드실적 검수 AG열).
 * - 판매 수정과 같은 식별: 같은 월 시트·같은 행 + No.·개통일·고객·CTN 이 모두 같을 때만 (Apps Script 가 확인).
 *   UMNP 처럼 No. 가 빈 판매도 No. 빈칸 + 개통일·고객·CTN 으로 확인.
 * - 그 칸의 지금 값이 화면에서 본 값(before)과 같을 때만 (그사이 바뀌었으면 거부)
 * - 그 칸 외에는 아무것도 쓰지 않는다 (keepRowFormulas: N·U·AB·AC 수식 변환·B열 번호 다시 매기기도 안 함)
 * - Apps Script 가 돌려준 저장 후 값에서 그 칸 = O 를 확인한 뒤에만 성공
 */

export type MarkDoneResult =
  | { ok: true; status: 200; row: number; no: string; values: unknown[] }
  | { ok: false; status: number; message: string };

const FAILURE: Record<AppsScriptError["code"], { status: number; message: string }> = {
  not_configured: {
    status: 503,
    message: "스프레드시트 연결 설정이 아직 완료되지 않았습니다. 관리자에게 문의해 주세요.",
  },
  timeout: {
    status: 504,
    message: "스프레드시트 응답이 늦어 저장 여부를 확인하지 못했습니다. 새로고침해 확인해 주세요.",
  },
  network: { status: 502, message: "스프레드시트에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요." },
  bad_response: { status: 502, message: "스프레드시트 응답을 확인하지 못했습니다. 새로고침해 확인해 주세요." },
  rejected: { status: 409, message: "저장하지 못했습니다." },
};

export async function markCellDone(
  target: UpdateSaleTarget,
  field: MarkDoneField,
  before: string,
  logLabel: string,
): Promise<MarkDoneResult> {
  const col = COLUMN_INDEX[field];
  try {
    const result = await updateRowInAppsScript(
      target,
      [{ col, before, value: "O" }],
      [],
      { onlyChanges: true },
    );
    // 장표에 실제로 O 가 들어갔는지 Apps Script 가 돌려준 값으로 확인
    if (cellText(result.values[col]).toUpperCase() !== "O") {
      return {
        ok: false,
        status: 502,
        message: "장표에 O 가 저장된 것을 확인하지 못했습니다. 새로고침해 확인해 주세요.",
      };
    }
    return { ok: true, status: 200, row: result.row, no: result.no, values: result.values };
  } catch (error) {
    if (error instanceof AppsScriptError) {
      console.error(`[${logLabel}] 실패 (${error.code}): ${error.message}`);
      const { status, message } = FAILURE[error.code];
      return {
        ok: false,
        status,
        message: error.code === "rejected" ? `${message} (${error.message})` : message,
      };
    }
    console.error(`[${logLabel}] 예상하지 못한 오류`);
    return { ok: false, status: 500, message: "처리 중 오류가 발생했습니다. 새로고침해 확인해 주세요." };
  }
}
