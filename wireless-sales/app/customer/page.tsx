import type { Metadata } from "next";
import { CustomerView } from "@/components/customer-view";
import { PageHeader } from "@/components/page-header";

export const metadata: Metadata = { title: "실력지표" };

export default function CustomerPage() {
  return (
    <>
      <PageHeader
        title="실력지표"
        description="실력지표제외가 X 인 고객을 직원별로 모아 스초·필L·보험 달성 여부를 확인합니다."
      />
      <CustomerView />
    </>
  );
}
