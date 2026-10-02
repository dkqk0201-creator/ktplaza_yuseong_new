import type { Metadata } from "next";
import { PlaceholderPage } from "@/components/placeholder-page";

export const metadata: Metadata = { title: "판매 등록" };

export default function SalesNewPage() {
  return (
    <PlaceholderPage
      title="판매 등록"
      description="새로운 개통 건을 입력합니다."
    />
  );
}
