import { getSheetSales } from "@/lib/data/sheet-sales";

/*
 * 판매내역 조회 API.
 * 화면이 먼저 열린 뒤 브라우저가 이 주소로 장표 데이터를 따로 요청한다.
 * 내용은 기존 getSheetSales() 그대로 (Apps Script 비밀값은 서버에만 있음).
 * 응답: 성공 { ok: true, sheet, sales } / 실패 { ok: false, message }
 */
export async function GET() {
  const result = await getSheetSales();
  return Response.json(result, {
    status: result.ok ? 200 : 502,
    // 장표가 바뀌었을 수 있으므로 서버·브라우저 어디에도 저장하지 않는다
    headers: { "Cache-Control": "no-store" },
  });
}
