import type { Metadata } from "next";
import { CardView } from "@/components/card-view";
import { PageHeader } from "@/components/page-header";

export const metadata: Metadata = { title: "카드실적" };

export default function CardsPage() {
  return (
    <>
      <PageHeader
        title="카드실적"
        description="제카(카드)가 O 인 판매의 카드실적 검수 여부를 확인합니다."
      />
      <CardView />
    </>
  );
}
