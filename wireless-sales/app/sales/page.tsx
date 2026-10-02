import type { Metadata } from "next";
import { PlaceholderPage } from "@/components/placeholder-page";

export const metadata: Metadata = { title: "판매 현황" };

export default function SalesPage() {
  return (
    <PlaceholderPage
      title="판매 현황"
      description="전체 판매 내역을 조회하고 검색합니다."
    />
  );
}
