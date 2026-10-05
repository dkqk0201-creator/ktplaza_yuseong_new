import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { StaffPerformanceView } from "@/components/staff-performance-view";

export const metadata: Metadata = { title: "직원 실적관리" };

export default function StaffPerformancePage() {
  return (
    <>
      <PageHeader
        title="직원 실적관리"
        description="선택한 월의 판매를 C열 개통일 기준으로 직원별로 집계합니다. (조회 전용)"
      />
      <StaffPerformanceView />
    </>
  );
}
