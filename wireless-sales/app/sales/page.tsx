import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { RetryButton, SalesList } from "@/components/sales-list";
import { getSheetSales } from "@/lib/data/sheet-sales";

export const metadata: Metadata = { title: "판매 현황" };

export default async function SalesPage() {
  const result = await getSheetSales();

  return (
    <>
      <PageHeader
        title="판매 현황"
        description="무선장표 이번 달 시트에 저장된 판매내역입니다. 한 건을 누르면 상세 내용을 볼 수 있습니다."
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
        <SalesList sheet={result.sheet} sales={result.sales} />
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
