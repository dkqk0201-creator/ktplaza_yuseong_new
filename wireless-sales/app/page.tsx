import Link from "next/link";
import { DashboardView } from "@/components/dashboard-view";
import { PageHeader } from "@/components/page-header";

/*
 * 대시보드: 화면 틀은 바로 보여주고, 장표 데이터는 화면이 열린 뒤
 * 공유 저장소(SalesDataProvider)를 통해 불러온다.
 */
export default function DashboardPage() {
  return (
    <>
      <PageHeader
        title="대시보드"
        description="무선장표 이번 달 시트 기준 무선 판매 실적"
        aside={
          <Link
            href="/sales/new"
            className="inline-flex h-10 items-center rounded-lg bg-brand px-4 text-sm font-semibold text-white hover:bg-brand-strong"
          >
            + 판매 등록
          </Link>
        }
      />
      <DashboardView />
    </>
  );
}
