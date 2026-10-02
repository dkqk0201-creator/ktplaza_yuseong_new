import type { Metadata } from "next";
import { PlaceholderPage } from "@/components/placeholder-page";

export const metadata: Metadata = { title: "예산 관리" };

export default function BudgetPage() {
  return (
    <PlaceholderPage
      title="예산 관리"
      description="확보금액과 사용금액을 관리합니다."
    />
  );
}
