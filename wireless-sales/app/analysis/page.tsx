import type { Metadata } from "next";
import { AnalysisTabs } from "@/components/analysis-tabs";
import { PageHeader } from "@/components/page-header";

export const metadata: Metadata = { title: "유입·캠페인 분석" };

export default function AnalysisPage() {
  return (
    <>
      <PageHeader
        title="유입·캠페인 분석"
        description="유입경로별·캠페인별 판매 건수·비중·예산과 캠페인 고객을 봅니다. 유입경로 항목과 캠페인도 여기서 관리합니다. (전환율 아님)"
      />
      <AnalysisTabs />
    </>
  );
}
