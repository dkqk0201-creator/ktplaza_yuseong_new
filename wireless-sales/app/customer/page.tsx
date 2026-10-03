import type { Metadata } from "next";
import { CustomerView } from "@/components/customer-view";
import { PageHeader } from "@/components/page-header";

export const metadata: Metadata = { title: "고객조회" };

export default function CustomerPage() {
  return (
    <>
      <PageHeader
        title="고객조회"
        description="실력지표제외가 X 인 고객 중에서 스초·필L·보험 조건으로 고객을 찾습니다."
      />
      <CustomerView />
    </>
  );
}
