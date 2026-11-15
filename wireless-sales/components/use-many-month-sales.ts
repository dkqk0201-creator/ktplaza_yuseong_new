"use client";

import { useEffect, useMemo, useState } from "react";
import type { SheetSale } from "@/lib/sheet-record";

/*
 * 여러 월 시트 판매를 함께 읽는다 (캠페인 조회 — 사전예약처럼 여러 달에 걸친 판매, 조회 전용).
 * 결과 판매에는 어느 월 시트에서 왔는지(sheet)를 붙인다 (판매 상세를 열 때 사용).
 */
export type SheetSaleWithSheet = SheetSale & { sheet: string };

export function useManyMonthSales(sheets: readonly string[]): {
  sales: SheetSaleWithSheet[];
  loading: boolean;
  errors: string[];
} {
  const key = sheets.join(",");
  const [state, setState] = useState<{ key: string; sales: SheetSaleWithSheet[]; errors: string[] }>({ key: "", sales: [], errors: [] });
  useEffect(() => {
    const list = key ? key.split(",") : [];
    if (list.length === 0) return;
    let cancelled = false;
    Promise.all(
      list.map((sheet) =>
        fetch(`/api/sales/list?sheet=${encodeURIComponent(sheet)}`, { cache: "no-store" })
          .then((r) => r.json())
          .then((body: { ok?: boolean; sheet?: string; sales?: SheetSale[]; message?: string }) =>
            body?.ok && body.sheet === sheet && Array.isArray(body.sales)
              ? { sales: body.sales.map((s) => ({ ...s, sheet })), error: null }
              : { sales: [], error: `${sheet}: ${body?.message || "불러오지 못했습니다."}` },
          )
          .catch(() => ({ sales: [], error: `${sheet}: 불러오지 못했습니다.` })),
      ),
    ).then((parts) => {
      if (cancelled) return;
      setState({
        key,
        sales: parts.flatMap((p) => p.sales),
        errors: parts.map((p) => p.error).filter((e): e is string => !!e),
      });
    });
    return () => {
      cancelled = true;
    };
  }, [key]);
  const ready = state.key === key;
  return useMemo(
    () => ({ sales: ready ? state.sales : [], loading: !!key && !ready, errors: ready ? state.errors : [] }),
    [ready, state, key],
  );
}
