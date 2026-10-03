"use client";

import { useMemo, useState } from "react";
import { SaleDetail } from "@/components/sale-detail";
import {
  useFreshSalesData,
  useSalesData,
} from "@/components/sales-data-provider";
import { SalesDataGate } from "@/components/sales-data-status";
import {
  EmptyBox,
  FilterChips,
  Notice,
  StaffSelect,
  StatusBadge,
  SummaryTile,
} from "@/components/work-ui";
import { dateText, maskedCtn } from "@/lib/sale-display";
import { isO, type SheetSale } from "@/lib/sheet-record";

/*
 * 검수관리: 장표의 검수(G)·수납(H) 칸이 O 가 아닌 판매를 찾는다.
 * 점장은 장표에서 직접 O 를 입력하고, 웹앱은 읽기만 한다.
 */

type Filter = "pending" | "all" | "inspect" | "paid" | "both" | "done";

export type InspectionStatus = "done" | "inspect" | "paid" | "both";

export function inspectionStatus(sale: SheetSale): InspectionStatus {
  const inspected = isO(sale.inspected);
  const paid = isO(sale.paid);
  if (inspected && paid) return "done";
  if (!inspected && !paid) return "both";
  return inspected ? "paid" : "inspect";
}

const STATUS_TEXT: Record<InspectionStatus, string> = {
  done: "완료",
  inspect: "검수 미완료",
  paid: "수납 미완료",
  both: "검수/수납 모두 미완료",
};

function matchFilter(status: InspectionStatus, filter: Filter): boolean {
  switch (filter) {
    case "all":
      return true;
    case "pending":
      return status !== "done";
    case "inspect": // 검수가 O 가 아닌 모든 건 (둘 다 미완료 포함)
      return status === "inspect" || status === "both";
    case "paid": // 수납이 O 가 아닌 모든 건 (둘 다 미완료 포함)
      return status === "paid" || status === "both";
    case "both":
      return status === "both";
    case "done":
      return status === "done";
  }
}

export function InspectionView() {
  useFreshSalesData();
  return (
    <SalesDataGate>
      {(data) => <InspectionList sheet={data.sheet} sales={data.sales} />}
    </SalesDataGate>
  );
}

function InspectionList({
  sheet,
  sales,
}: {
  sheet: string;
  sales: SheetSale[];
}) {
  const { invalidate } = useSalesData();
  const [filter, setFilter] = useState<Filter>("pending");
  const [staff, setStaff] = useState("");
  const [selectedRow, setSelectedRow] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const staffNames = useMemo(
    () => [...new Set(sales.map((s) => s.staff).filter(Boolean))].sort(),
    [sales],
  );
  const byStaff = sales.filter((s) => !staff || s.staff === staff);
  const statuses = byStaff.map((s) => inspectionStatus(s));
  const count = (f: Filter) =>
    statuses.filter((st) => matchFilter(st, f)).length;
  const rows = byStaff
    .filter((s) => matchFilter(inspectionStatus(s), filter))
    .sort((a, b) => a.row - b.row);
  const selected = sales.find((s) => s.row === selectedRow) ?? null;

  return (
    <>
      {notice && <Notice message={notice} onClose={() => setNotice(null)} />}

      <section
        aria-label="검수 요약"
        className="grid grid-cols-2 gap-3 lg:grid-cols-4"
      >
        <SummaryTile
          label="전체 판매건"
          value={`${byStaff.length}건`}
          active={filter === "all"}
          onClick={() => setFilter("all")}
        />
        <SummaryTile
          label="검수 미완료"
          value={`${count("inspect")}건`}
          tone={count("inspect") ? "warn" : "default"}
          active={filter === "inspect"}
          onClick={() => setFilter("inspect")}
        />
        <SummaryTile
          label="수납 미완료"
          value={`${count("paid")}건`}
          tone={count("paid") ? "warn" : "default"}
          active={filter === "paid"}
          onClick={() => setFilter("paid")}
        />
        <SummaryTile
          label="모두 완료"
          value={`${count("done")}건`}
          tone="good"
          active={filter === "done"}
          onClick={() => setFilter("done")}
        />
      </section>

      <div className="mt-5 mb-3 flex flex-wrap items-center gap-2">
        <FilterChips
          label="검수 상태"
          value={filter}
          onChange={setFilter}
          options={[
            { value: "pending", label: "미처리 전체", count: count("pending") },
            { value: "all", label: "전체", count: count("all") },
            { value: "inspect", label: "검수 미완료", count: count("inspect") },
            { value: "paid", label: "수납 미완료", count: count("paid") },
            { value: "both", label: "둘 다 미완료", count: count("both") },
            { value: "done", label: "완료", count: count("done") },
          ]}
        />
        <div className="ml-auto">
          <StaffSelect staff={staffNames} value={staff} onChange={setStaff} />
        </div>
      </div>

      {rows.length === 0 ? (
        <EmptyBox
          text={
            sales.length === 0
              ? `${sheet} 시트에 등록된 판매가 없습니다.`
              : "조건에 맞는 판매가 없습니다."
          }
        />
      ) : (
        <>
          {/* PC: 표 */}
          <div className="hidden overflow-x-auto rounded-xl border border-line bg-white md:block">
            <table className="w-full min-w-[820px] text-sm">
              <thead className="border-b border-line bg-zinc-50 text-xs text-ink-sub">
                <tr>
                  {[
                    "No.",
                    "개통일",
                    "직원명",
                    "고객",
                    "CTN",
                    "개통구분",
                    "검수",
                    "수납",
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
                {rows.map((sale) => {
                  const status = inspectionStatus(sale);
                  return (
                    <tr
                      key={sale.row}
                      onClick={() => setSelectedRow(sale.row)}
                      className="cursor-pointer hover:bg-zinc-50"
                    >
                      <td className="px-3 py-3 text-ink-muted tabular-nums">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedRow(sale.row);
                          }}
                          aria-label={`No.${sale.no} ${sale.customer} 상세 보기`}
                          className="font-medium text-ink-sub hover:underline"
                        >
                          {sale.no}
                        </button>
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
                      <td className="px-3 py-3 whitespace-nowrap text-ink-sub">
                        {sale.category || "-"}
                      </td>
                      <td className="px-3 py-3">
                        <OXMark value={sale.inspected} />
                      </td>
                      <td className="px-3 py-3">
                        <OXMark value={sale.paid} />
                      </td>
                      <td className="px-3 py-3">
                        <StatusBadge tone={status === "done" ? "good" : "warn"}>
                          {STATUS_TEXT[status]}
                        </StatusBadge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* 모바일: 카드 */}
          <ul className="space-y-2.5 md:hidden">
            {rows.map((sale) => {
              const status = inspectionStatus(sale);
              return (
                <li key={sale.row}>
                  <button
                    type="button"
                    onClick={() => setSelectedRow(sale.row)}
                    className="w-full rounded-xl border border-line bg-white p-4 text-left active:bg-zinc-50"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs text-ink-muted tabular-nums">
                        No.{sale.no} · {dateText(sale.activatedAt)}
                      </span>
                      <StatusBadge tone={status === "done" ? "good" : "warn"}>
                        {STATUS_TEXT[status]}
                      </StatusBadge>
                    </div>
                    <div className="mt-2 flex items-baseline justify-between gap-2">
                      <span className="text-base font-semibold text-ink">
                        {sale.customer || "-"}
                      </span>
                      <span className="text-sm text-ink-sub">
                        {sale.staff || "-"}
                      </span>
                    </div>
                    <div className="mt-2 flex gap-4 text-sm text-ink-sub">
                      <span>
                        검수 <OXMark value={sale.inspected} />
                      </span>
                      <span>
                        수납 <OXMark value={sale.paid} />
                      </span>
                      <span className="ml-auto tabular-nums">
                        {sale.ctn ? maskedCtn(sale.ctn) : ""}
                      </span>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {selected && (
        <SaleDetail
          sheet={sheet}
          sale={selected}
          onClose={() => setSelectedRow(null)}
          onDeleted={(message) => {
            setSelectedRow(null);
            setNotice(message);
            void invalidate();
          }}
          onUpdated={(message) => {
            // 상세창은 열어 둔 채 목록·상단 건수를 장표에서 다시 읽는다
            setNotice(message);
            void invalidate();
          }}
        />
      )}
    </>
  );
}

export function OXMark({ value }: { value: string }) {
  const o = isO(value);
  return (
    <span
      className={`font-bold ${o ? "text-emerald-600" : "text-rose-600"}`}
      aria-label={o ? "O" : value || "빈칸"}
    >
      {o ? "O" : value || "·"}
    </span>
  );
}
