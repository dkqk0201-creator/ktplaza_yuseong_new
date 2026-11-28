import type { Metadata } from "next";
import { BudgetTabs } from "@/components/budget-tabs";
import { PageHeader } from "@/components/page-header";
import { PolicyEditView } from "@/components/policy-edit-view";

export const metadata: Metadata = { title: "정책 확보 관리" };

export default function PolicyEditPage() {
  return (
    <>
      <PageHeader
        title="예산관리"
        description="기간·모델로 판매를 찾아 정책 확보금액(고객혜택·그외(스팟제외)·2ND연계정책)을 확인하고 판매별로 고칩니다."
      />
      <BudgetTabs active="/budget/policy" />
      <PolicyEditView />
    </>
  );
}
