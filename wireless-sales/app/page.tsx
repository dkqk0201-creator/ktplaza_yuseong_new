import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { RecentSalesTable } from "@/components/recent-sales-table";
import { StatCard } from "@/components/stat-card";
import { getDashboardSummary, getRecentSales } from "@/lib/data/sales";
import { formatMonth, formatNumber } from "@/lib/format";

export default async function DashboardPage() {
  const [summary, recentSales] = await Promise.all([
    getDashboardSummary(),
    getRecentSales(10),
  ]);

  return (
    <>
      <PageHeader
        title="대시보드"
        description={`${formatMonth(summary.month)} 기준 무선 판매 실적`}
        aside={
          <Link
            href="/sales/new"
            className="inline-flex h-10 items-center rounded-lg bg-brand px-4 text-sm font-semibold text-white hover:bg-brand-strong"
          >
            + 판매 등록
          </Link>
        }
      />

      <section
        aria-label="이번 달 요약"
        className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4"
      >
        <StatCard
          label="총 개통 건수"
          value={formatNumber(summary.activationCount)}
          unit="건"
        />
        <StatCard
          label="총 확보금액"
          value={formatNumber(summary.securedTotal)}
          unit="원"
        />
        <StatCard
          label="총 사용금액"
          value={formatNumber(summary.usedTotal)}
          unit="원"
        />
        <StatCard
          label="가용가능금액"
          value={formatNumber(summary.availableTotal)}
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
        <RecentSalesTable sales={recentSales} />
      </section>
    </>
  );
}
