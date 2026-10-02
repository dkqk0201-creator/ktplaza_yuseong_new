import type { Metadata } from "next";
import { PlaceholderPage } from "@/components/placeholder-page";

export const metadata: Metadata = { title: "설정" };

export default function SettingsPage() {
  return (
    <PlaceholderPage
      title="설정"
      description="직원, 요금제 등 기본 정보를 관리합니다."
    />
  );
}
