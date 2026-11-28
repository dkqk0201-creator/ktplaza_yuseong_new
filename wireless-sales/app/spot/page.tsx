import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { SpotView } from "@/components/spot-view";

export const metadata: Metadata = { title: "충청관리" };

export default function SpotPage() {
  return (
    <>
      <PageHeader
        title="충청관리"
        description="선택한 월 시트 O열(SPOT정책) 메모를 번호별로 집계합니다. 기간·모델별 충청 일괄등록도 이 화면에서 합니다. (2026년 10월까지는 '스팟', 11월부터 '충청' — 같은 예산 항목)"
      />
      <SpotView />
    </>
  );
}
