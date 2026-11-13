"use client";

import { useEffect, useState } from "react";
import type { SheetSale } from "@/lib/sheet-record";

/*
 * 다른 월 시트(예: 전월) 판매를 따로 읽는다 — 목표관리·분석의 전월·전주 비교용 (조회 전용).
 * sheet 가 null 이면 읽지 않는다 (그 월 시트가 없거나 최근 12개월이 아님).
 */
export function useMonthSales(sheet: string | null): { sales: SheetSale[] | null; error: string | null; loading: boolean } {
  const [state, setState] = useState<{ sheet: string | null; sales: SheetSale[] | null; error: string | null }>({
    sheet: null,
    sales: null,
    error: null,
  });
  useEffect(() => {
    if (!sheet) return;
    let cancelled = false;
    fetch(`/api/sales/list?sheet=${encodeURIComponent(sheet)}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((body: { ok?: boolean; sheet?: string; sales?: SheetSale[]; message?: string }) => {
        if (cancelled) return;
        if (body?.ok && body.sheet === sheet && Array.isArray(body.sales)) setState({ sheet, sales: body.sales, error: null });
        else setState({ sheet, sales: null, error: body?.message || "전월 판매내역을 불러오지 못했습니다." });
      })
      .catch(() => {
        if (!cancelled) setState({ sheet, sales: null, error: "전월 판매내역을 불러오지 못했습니다." });
      });
    return () => {
      cancelled = true;
    };
  }, [sheet]);
  if (!sheet) return { sales: null, error: null, loading: false };
  const ready = state.sheet === sheet;
  return { sales: ready ? state.sales : null, error: ready ? state.error : null, loading: !ready };
}
