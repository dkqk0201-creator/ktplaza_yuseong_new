"use client";

import Link from "next/link";
import { RecentSalesTable } from "@/components/recent-sales-table";
import { useFreshSalesData } from "@/components/sales-data-provider";
import {
  SalesDataBar,
  SalesDataError,
  SalesDataLoading,
} from "@/components/sales-data-status";
import { StatCard } from "@/components/stat-card";
import { formatNumber } from "@/lib/format";
import { sumAmount } from "@/lib/sale-display";

const RECENT_LIMIT = 10;

/* 대시보드 본문: 판매 현황과 같은 공유 데이터(이번 달 시트)를 사용한다 */
export function DashboardView() {
  const { data, error } = useFreshSalesData();

  if (!data) {
    return error ? <SalesDataError message={error} /> : <SalesDataLoading />;
  }

  const { sales } = data;
  const securedTotal = sumAmount(sales, (s) => s.securedTotal); // M열 합계
  const usedTotal = sumAmount(sales, (s) => s.usedTotal); // T열 합계

  return (
    <>
      <SalesDataBar />

      <section
        aria-label="이번 달 요약"
        className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4"
      >
        <StatCard
          label="총 개통 건수"
          value={formatNumber(sales.length)}
          unit="건"
        />
        <StatCard
          label="총 확보금액"
          value={formatNumber(securedTotal)}
          unit="원"
        />
        <StatCard
          label="총 사용금액"
          value={formatNumber(usedTotal)}
          unit="원"
        />
        <StatCard
          label="가용가능금액"
          value={formatNumber(securedTotal - usedTotal)}
          unit="원"
          hint="총 확보금액 − 총 사용금액"
          emphasis
        />
      </section>

      <section aria-labelledby="recent-sales-title" className="mt-8">
        <div className="mb-3 flex items-center justify-between">
          <h2 id="recent-sales-title" className="text-lg font-bold text-ink">
            최근 판매 내역
          </h2>
          <Link
            href="/sales"
            className="text-sm font-medium text-ink-sub hover:text-brand"
          >
            전체 보기 →
          </Link>
        </div>
        {/* 공유 데이터는 최근에 입력된 행이 위로 오도록 정렬되어 있다 */}
        <RecentSalesTable sales={sales.slice(0, RECENT_LIMIT)} />
      </section>
    </>
  );
}
