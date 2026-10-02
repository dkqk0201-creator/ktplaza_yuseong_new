import type { Metadata } from "next";
import { connection } from "next/server";
import { PageHeader } from "@/components/page-header";
import { QuickRegister } from "@/components/quick-register";
import { getStaffNames } from "@/lib/data/staff";
import { todayInKorea } from "@/lib/format";

export const metadata: Metadata = { title: "간편등록" };

export default async function QuickPage() {
  // 개통일자(MM.DD)에 붙일 연도·월을 접속 시점(한국 시간) 기준으로 정한다
  await connection();
  const staffNames = await getStaffNames();

  return (
    <>
      <PageHeader
        title="간편등록"
        description="직원 보고 양식을 붙여넣고 분석한 뒤, 확인한 건만 등록합니다."
      />
      <QuickRegister today={todayInKorea()} staffNames={staffNames} />
    </>
  );
}
