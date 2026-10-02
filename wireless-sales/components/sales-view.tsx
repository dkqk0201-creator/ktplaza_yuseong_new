"use client";

import { useFreshSalesData } from "@/components/sales-data-provider";
import {
  SalesDataBar,
  SalesDataError,
  SalesDataLoading,
} from "@/components/sales-data-status";
import { SalesList } from "@/components/sales-list";

/* 판매 현황 본문: 대시보드와 같은 공유 데이터(이번 달 시트)를 사용한다 */
export function SalesView() {
  const { data, error } = useFreshSalesData();

  if (!data) {
    return error ? <SalesDataError message={error} /> : <SalesDataLoading />;
  }
  return (
    <>
      <SalesDataBar />
      <SalesList sheet={data.sheet} sales={data.sales} />
    </>
  );
}
