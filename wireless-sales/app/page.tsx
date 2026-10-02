import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { RecentSalesTable } from "@/components/recent-sales-table";
import { RetryButton } from "@/components/sales-list";
import { StatCard } from "@/components/stat-card";
import { getSheetSales } from "@/lib/data/sheet-sales";
import { formatNumber } from "@/lib/format";
import { sumAmount } from "@/lib/sale-display";
import type { SheetSale } from "@/lib/sheet-record";

const RECENT_LIMIT = 10;

export default async function DashboardPage() {
  // 판매 현황과 같은 조회: 무선장표 이번 달 시트 (Apps Script가 시트를 정한다)
  const result = await getSheetSales();

  return (
    <>
      <PageHeader
        title="대시보드"
        description={
          result.ok
            ? `${result.sheet} 시트 기준 무선 판매 실적`
            : "무선장표 이번 달 시트 기준 무선 판매 실적"
        }
        aside={
          <Link
            href="/sales/new"
            className="inline-flex h-10 items-center rounded-lg bg-brand px-4 text-sm font-semibold text-white hover:bg-brand-strong"
          >
            + 판매 등록
          </Link>
        }
      />

      {result.ok ? (
        <Dashboard sales={result.sales} />
      ) : (
        <div
          role="alert"
          className="rounded-xl border border-rose-200 bg-rose-50 px-5 py-6 text-center"
        >
          <p className="font-semibold text-rose-700">⚠ {result.message}</p>
          <RetryButton />
        </div>
      )}
    </>
  );
}

function Dashboard({ sales }: { sales: SheetSale[] }) {
  const securedTotal = sumAmount(sales, (s) => s.securedTotal); // M열 합계
  const usedTotal = sumAmount(sales, (s) => s.usedTotal); // T열 합계

  return (
    <>
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
        {/* getSheetSales()는 최근에 입력된 행이 위로 오도록 정렬되어 있다 */}
        <RecentSalesTable sales={sales.slice(0, RECENT_LIMIT)} />
      </section>
    </>
  );
}
