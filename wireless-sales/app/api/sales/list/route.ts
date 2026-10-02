import { getSheetSales } from "@/lib/data/sheet-sales";

/*
 * 판매내역 조회 API. 예: /api/sales/list?sheet=10월 (없으면 이번 달 시트)
 * 화면이 먼저 열린 뒤 브라우저가 이 주소로 장표 데이터를 따로 요청한다.
 * 응답: 성공 { ok: true, sheet, sales, sheets } / 실패 { ok: false, message, sheets }
 */
export async function GET(request: Request) {
  const param = new URL(request.url).searchParams.get("sheet") ?? "";
  if (param && !/^(1[0-2]|[1-9])월$/.test(param)) {
    return Response.json(
      { ok: false, message: "시트 이름이 올바르지 않습니다.", sheets: [] },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
  const result = await getSheetSales(param || undefined);
  return Response.json(result, {
    status: result.ok ? 200 : 502,
    // 장표가 바뀌었을 수 있으므로 서버·브라우저 어디에도 저장하지 않는다
    headers: { "Cache-Control": "no-store" },
  });
}
