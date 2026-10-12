import type { Metadata } from "next";
import { BudgetTabs } from "@/components/budget-tabs";
import { ModelPolicyView } from "@/components/model-policy-view";
import { PageHeader } from "@/components/page-header";

export const metadata: Metadata = { title: "모델정책 정산" };

export default function ModelPolicyPage() {
  return (
    <>
      <PageHeader
        title="예산관리"
        description="선택한 월 시트의 S열 모델정책 금액을 정책명별로 정산합니다."
      />
      <BudgetTabs active="/budget/model-policy" />
      <ModelPolicyView />
    </>
  );
}
