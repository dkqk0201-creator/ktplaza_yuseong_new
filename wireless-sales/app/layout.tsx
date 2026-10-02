import type { Metadata, Viewport } from "next";
import { AppShell } from "@/components/app-shell";
import { SalesDataProvider } from "@/components/sales-data-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "무선 판매 관리",
    template: "%s | 무선 판매 관리",
  },
  description: "휴대폰 매장 무선 판매 실적 입력 및 관리",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#ffffff",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ko" className="h-full antialiased">
      <body className="flex min-h-full flex-col">
        {/* 대시보드·판매 현황이 함께 쓰는 판매 데이터 저장소 (화면 이동 시에도 유지) */}
        <SalesDataProvider>
          <AppShell>{children}</AppShell>
        </SalesDataProvider>
      </body>
    </html>
  );
}
