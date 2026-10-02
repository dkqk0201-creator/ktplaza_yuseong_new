"use client";

import { useMemo, useState } from "react";
import { OXMark } from "@/components/inspection-view";
import { useFreshSalesData } from "@/components/sales-data-provider";
import { SalesDataGate } from "@/components/sales-data-status";
import {
  EmptyBox,
  FilterChips,
  StaffSelect,
  StatusBadge,
  SummaryTile,
} from "@/components/work-ui";
import { dateText, maskedCtn } from "@/lib/sale-display";
import { isO, type SheetSale } from "@/lib/sheet-record";

/*
 * 카드실적: 제카(AE)가 O 인 판매 중 카드실적 검수(AG)가 O 가 아닌 건을 찾는다.
 * 제카가 X 인 판매(카드 없음)는 목록에 절대 나오지 않는다.
 * 점장이 장표 AG 칸에 O 를 입력하고 새로고침하면 완료로 바뀐다.
 */

type Filter = "pending" | "all" | "done";

export function cardSales(sales: SheetSale[]): SheetSale[] {
  return sales.filter((s) => isO(s.jeca));
}

export function CardView() {
  useFreshSalesData();
  return (
    <SalesDataGate>{(data) => <CardList sales={data.sales} />}</SalesDataGate>
  );
}

function CardList({ sales }: { sales: SheetSale[] }) {
  const [filter, setFilter] = useState<Filter>("pending");
  const [staff, setStaff] = useState("");

  const cards = useMemo(() => cardSales(sales), [sales]);
  const staffNames = useMemo(
    () => [...new Set(cards.map((s) => s.staff).filter(Boolean))].sort(),
    [cards],
  );
  const byStaff = cards.filter((s) => !staff || s.staff === staff);
  const done = byStaff.filter((s) => isO(s.cardChecked));
  const pending = byStaff.filter((s) => !isO(s.cardChecked));
  const rows = (filter === "all" ? byStaff : filter === "done" ? done : pending)
    .slice()
    .sort((a, b) => a.row - b.row);

  return (
    <>
      <section aria-label="카드실적 요약" className="grid grid-cols-3 gap-3">
        <SummaryTile
          label="총 카드건수"
          value={`${byStaff.length}건`}
          active={filter === "all"}
          onClick={() => setFilter("all")}
        />
        <SummaryTile
          label="검수완료"
          value={`${done.length}건`}
          tone="good"
          active={filter === "done"}
          onClick={() => setFilter("done")}
        />
        <SummaryTile
          label="미검수"
          value={`${pending.length}건`}
          tone={pending.length ? "warn" : "default"}
          active={filter === "pending"}
          onClick={() => setFilter("pending")}
        />
      </section>

      <div className="mt-5 mb-3 flex flex-wrap items-center gap-2">
        <FilterChips
          label="카드실적 검수 상태"
          value={filter}
          onChange={setFilter}
          options={[
            { value: "pending", label: "미검수", count: pending.length },
            { value: "all", label: "전체", count: byStaff.length },
            { value: "done", label: "완료", count: done.length },
          ]}
        />
        <div className="ml-auto">
          <StaffSelect staff={staffNames} value={staff} onChange={setStaff} />
        </div>
      </div>

      {rows.length === 0 ? (
        <EmptyBox
          text={
            cards.length === 0
              ? "제카(카드)가 있는 판매가 없습니다."
              : "조건에 맞는 카드 판매가 없습니다."
          }
        />
      ) : (
        <>
          <div className="hidden overflow-x-auto rounded-xl border border-line bg-white md:block">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="border-b border-line bg-zinc-50 text-xs text-ink-sub">
                <tr>
                  {[
                    "No.",
                    "개통일",
                    "직원명",
                    "고객",
                    "CTN",
                    "카드 종류",
                    "카드실적 검수",
                    "상태",
                  ].map((h) => (
                    <th
                      key={h}
                      className="px-3 py-3 text-left font-semibold whitespace-nowrap"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((sale) => (
                  <tr key={sale.row}>
                    <td className="px-3 py-3 text-ink-muted tabular-nums">
                      {sale.no}
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap text-ink-sub tabular-nums">
                      {dateText(sale.activatedAt)}
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap text-ink">
                      {sale.staff || "-"}
                    </td>
                    <td className="px-3 py-3 font-medium whitespace-nowrap text-ink">
                      {sale.customer || "-"}
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap text-ink-sub tabular-nums">
                      {sale.ctn ? maskedCtn(sale.ctn) : "-"}
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap text-ink">
                      {sale.cardType || "-"}
                    </td>
                    <td className="px-3 py-3">
                      <OXMark value={sale.cardChecked} />
                    </td>
                    <td className="px-3 py-3">
                      <StatusBadge
                        tone={isO(sale.cardChecked) ? "good" : "warn"}
                      >
                        {isO(sale.cardChecked) ? "완료" : "미검수"}
                      </StatusBadge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <ul className="space-y-2.5 md:hidden">
            {rows.map((sale) => (
              <li
                key={sale.row}
                className="rounded-xl border border-line bg-white p-4"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-ink-muted tabular-nums">
                    No.{sale.no} · {dateText(sale.activatedAt)}
                  </span>
                  <StatusBadge tone={isO(sale.cardChecked) ? "good" : "warn"}>
                    {isO(sale.cardChecked) ? "완료" : "미검수"}
                  </StatusBadge>
                </div>
                <div className="mt-2 flex items-baseline justify-between gap-2">
                  <span className="text-base font-semibold text-ink">
                    {sale.customer || "-"}
                  </span>
                  <span className="text-sm font-semibold text-ink">
                    {sale.cardType || "-"}
                  </span>
                </div>
                <div className="mt-1 flex justify-between text-sm text-ink-sub">
                  <span>{sale.staff || "-"}</span>
                  <span className="tabular-nums">
                    {sale.ctn ? maskedCtn(sale.ctn) : ""}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="mt-3 text-xs text-ink-muted">
        장표의 카드실적 검수(AG열)에 O 를 입력한 뒤 새로고침하면 완료로
        바뀝니다.
      </p>
    </>
  );
}
