import { connection } from "next/server";
import { todayInKorea } from "@/lib/format";
import type { DashboardSummary, Sale } from "@/lib/types";
import { createMockSales } from "./mock-sales";

/*
 * 판매 데이터 조회 창구.
 * 화면은 이 파일의 함수만 사용한다. 나중에 Google 스프레드시트를 연결할 때는
 * 이 파일의 내부 구현만 바꾸면 화면 코드는 그대로 둘 수 있다.
 */

/** 전체 판매 내역 (최신 개통일 순) */
export async function getSales(): Promise<Sale[]> {
  // 요청 시점의 날짜를 기준으로 계산하도록 미리 만들어 두지 않는다
  await connection();
  const sales = createMockSales(todayInKorea());
  return sales.sort(
    (a, b) =>
      b.activatedAt.localeCompare(a.activatedAt) || b.id.localeCompare(a.id),
  );
}

/** 최근 판매 내역 */
export async function getRecentSales(limit = 10): Promise<Sale[]> {
  const sales = await getSales();
  return sales.slice(0, limit);
}

/** 이번 달 기준 대시보드 요약 */
export async function getDashboardSummary(): Promise<DashboardSummary> {
  const sales = await getSales();
  const month = todayInKorea().slice(0, 7);
  const monthSales = sales.filter((s) => s.activatedAt.startsWith(month));

  const securedTotal = monthSales.reduce((sum, s) => sum + s.securedAmount, 0);
  const usedTotal = monthSales.reduce((sum, s) => sum + s.usedAmount, 0);

  return {
    month,
    activationCount: monthSales.length,
    securedTotal,
    usedTotal,
    availableTotal: securedTotal - usedTotal,
  };
}
