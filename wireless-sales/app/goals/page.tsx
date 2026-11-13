import type { Metadata } from "next";
import { GoalView } from "@/components/goal-view";
import { PageHeader } from "@/components/page-header";

export const metadata: Metadata = { title: "목표관리" };

export default function GoalsPage() {
  return (
    <>
      <PageHeader
        title="목표관리"
        description="매장·직원별 월 목표(지표별)를 정하고, C열 개통일 기준 실적·달성률·전주·전월 비교·직원별 예산을 봅니다."
      />
      <GoalView />
    </>
  );
}
