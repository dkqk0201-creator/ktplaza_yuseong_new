import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { SpotView } from "@/components/spot-view";

export const metadata: Metadata = { title: "스팟관리" };

export default function SpotPage() {
  return (
    <>
      <PageHeader
        title="스팟관리"
        description="선택한 월 시트 O열(SPOT정책) 메모를 SPOT 번호별로 집계합니다. (조회 전용)"
      />
      <SpotView />
    </>
  );
}
