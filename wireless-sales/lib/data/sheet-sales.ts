import "server-only";
import { connection } from "next/server";
import {
  AppsScriptError,
  listRowsFromAppsScript,
  monthSheetNames,
} from "@/lib/server/apps-script";
import { parseSheetRow, type SheetSale } from "@/lib/sheet-record";

/*
 * 무선장표 월 시트에 저장된 판매내역 조회 창구.
 * 검수관리·카드실적·예산관리·간편등록(중복 확인)이 모두 이 함수를 사용한다.
 */

export type SheetSalesResult =
  | { ok: true; sheet: string; sales: SheetSale[]; sheets: string[] }
  | { ok: false; message: string; sheets: string[] };

const FAILURE_MESSAGES: Record<AppsScriptError["code"], string> = {
  not_configured:
    "스프레드시트 연결 설정이 아직 완료되지 않았습니다. 관리자에게 문의해 주세요.",
  timeout: "스프레드시트 응답이 늦습니다. 잠시 후 다시 시도해 주세요.",
  network: "스프레드시트에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.",
  bad_response:
    "스프레드시트 응답을 읽지 못했습니다. Apps Script 코드가 최신으로 배포되었는지 확인해 주세요.",
  rejected: "스프레드시트에서 판매내역을 불러오지 못했습니다.",
};

/** 월 시트의 판매내역 (최근에 입력된 행이 위로). sheet 가 없으면 이번 달 시트 */
export async function getSheetSales(sheet?: string): Promise<SheetSalesResult> {
  // 매 요청마다 장표의 최신 내용을 읽는다
  await connection();
  try {
    const result = await listRowsFromAppsScript(sheet);
    const sales = result.rows
      .map(({ row, no, values }) => parseSheetRow(row, no, values))
      .sort((a, b) => b.row - a.row);
    return { ok: true, sheet: result.sheet, sales, sheets: result.sheets };
  } catch (error) {
    if (error instanceof AppsScriptError) {
      // 관리자 확인용 기록. 비밀값·고객 정보는 남기지 않는다.
      console.error(`[판매 조회] 실패 (${error.code}): ${error.message}`);
      const base = FAILURE_MESSAGES[error.code];
      return {
        ok: false,
        message:
          error.code === "rejected" ? `${base} (${error.message})` : base,
        sheets: monthSheetNames(error.details.sheets),
      };
    }
    console.error("[판매 조회] 예상하지 못한 오류");
    return {
      ok: false,
      message: "판매내역을 불러오는 중 오류가 발생했습니다.",
      sheets: [],
    };
  }
}
