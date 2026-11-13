import type { Metadata } from "next";
import { InflowAnalysisView } from "@/components/inflow-analysis-view";
import { PageHeader } from "@/components/page-header";

export const metadata: Metadata = { title: "유입경로 분석" };

export default function AnalysisPage() {
  return (
    <>
      <PageHeader
        title="유입경로 분석"
        description="고객 유입경로별 판매 건수·비중·예산을 일·주·월 단위로 봅니다. (조회 전용, 전환율 아님)"
      />
      <InflowAnalysisView />
    </>
  );
}
