import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { SalesView } from "@/components/sales-view";

export const metadata: Metadata = { title: "판매 현황" };

/*
 * 판매 현황: 화면 틀은 바로 보여주고, 장표 데이터는 화면이 열린 뒤
 * 공유 저장소(SalesDataProvider)를 통해 불러온다.
 */
export default function SalesPage() {
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
      <SalesView />
    </>
  );
}
