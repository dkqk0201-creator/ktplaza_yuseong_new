import type { Metadata } from "next";
import { connection } from "next/server";
import { PageHeader } from "@/components/page-header";
import { SaleForm } from "@/components/sale-form";
import { getStaffNames } from "@/lib/data/staff";
import { todayInKorea } from "@/lib/format";

export const metadata: Metadata = { title: "판매 등록" };

export default async function SalesNewPage() {
  // 개통일 기본값을 접속한 날짜(한국 시간)로 채우기 위해 요청 시점에 그린다
  await connection();
  const staffOptions = await getStaffNames();

  return (
    <>
      <PageHeader
        title="판매 등록"
        description="새로운 개통 건의 무선장표 정보를 입력합니다."
      />
      <SaleForm today={todayInKorea()} staffOptions={staffOptions} />
    </>
  );
}
