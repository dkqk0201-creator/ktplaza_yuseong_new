import { todayInKorea } from "@/lib/format";
import { sheetForMonth } from "@/lib/month-sheet";
import type { SheetSale } from "@/lib/sheet-record";

/*
 * 기간에 걸친 여러 월 시트의 판매를 화면에서 불러온다 (/api/sales/list, 읽기 전용).
 * 판매마다 어느 월 시트에서 왔는지(sheet) 붙인다 → 월이 다르면 같은 판매 No. 라도 다른 판매.
 * 충청 일괄등록(spot-bulk-panel)·정책 확보 관리(policy-edit-view)가 같이 쓴다.
 */
export type SaleWithSheet = SheetSale & { sheet: string };

export async function loadSalesForMonths(months: string[]): Promise<{ sales: SaleWithSheet[]; errors: string[] }> {
  const today = todayInKorea();
  const errors: string[] = [];
  const sales: SaleWithSheet[] = [];
  await Promise.all(
    months.map(async (ym) => {
      const sheet = sheetForMonth(ym, today);
      if (!sheet) {
        errors.push(`${ym}: 최근 12개월 밖이라 월 시트로 찾을 수 없습니다.`);
        return;
      }
      try {
        const r = await fetch(`/api/sales/list?sheet=${encodeURIComponent(sheet)}`, { cache: "no-store" });
        const body = (await r.json()) as { ok?: boolean; sheet?: string; sales?: SheetSale[]; message?: string };
        if (body?.ok && body.sheet === sheet && Array.isArray(body.sales)) sales.push(...body.sales.map((s) => ({ ...s, sheet })));
        else errors.push(`${sheet}: ${body?.message || "불러오지 못했습니다."}`);
      } catch {
        errors.push(`${sheet}: 불러오지 못했습니다.`);
      }
    }),
  );
  return { sales, errors };
}
