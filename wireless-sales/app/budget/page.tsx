import type { Metadata } from "next";
import { BudgetView } from "@/components/budget-view";
import { PageHeader } from "@/components/page-header";

export const metadata: Metadata = { title: "예산관리" };

export default function BudgetPage() {
  return (
    <>
      <PageHeader
        title="예산관리"
        description="선택한 월 시트의 고객혜택·스팟·현금 예산과 무선 목표를 봅니다."
      />
      <BudgetView />
    </>
  );
}
