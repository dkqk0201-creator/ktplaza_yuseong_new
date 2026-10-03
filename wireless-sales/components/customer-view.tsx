"use client";

import { useMemo, useState } from "react";
import { SaleDetail } from "@/components/sale-detail";
import { useFreshSalesData } from "@/components/sales-data-provider";
import { SalesDataGate } from "@/components/sales-data-status";
import {
  EmptyBox,
  FilterChips,
  StaffSelect,
  SummaryTile,
} from "@/components/work-ui";
import {
  customerBase,
  filterCustomers,
  hasInsurance,
  hasPilL,
  hasScho,
  summarizeCustomers,
  type CustomerFilter,
  type Tri,
} from "@/lib/customer-filter";
import { dateText, maskedCtn } from "@/lib/sale-display";
import type { SheetSale } from "@/lib/sheet-record";

/*
 * 고객조회 (읽기 전용): 선택한 월 시트에서 F열 실력지표제외 = X 인 고객만 대상으로
 * 스초(K)·필L(AI)·보험(AJ) 조건을 조합해 찾는다. 장표 값은 절대 바꾸지 않는다.
 */

const TRI_OPTIONS = (label: string) =>
  [
    { value: "all", label: "전체" },
    { value: "O", label: `${label} O` },
    { value: "X", label: `${label} X` },
  ] as const;

export function CustomerView() {
  useFreshSalesData();
  return (
    <SalesDataGate>
      {(data) => <CustomerList sheet={data.sheet} sales={data.sales} />}
    </SalesDataGate>
  );
}

function CustomerList({ sheet, sales }: { sheet: string; sales: SheetSale[] }) {
  const [filter, setFilter] = useState<CustomerFilter>({
    scho: "all",
    pilL: "all",
    insurance: "all",
  });
  const [staff, setStaff] = useState("");
  const [selectedRow, setSelectedRow] = useState<number | null>(null);

  // 기본 모수: 실력지표제외 = X 고객만 (이 화면의 모든 숫자와 결과의 바탕)
  const base = useMemo(() => customerBase(sales), [sales]);
  const staffNames = useMemo(
    () => [...new Set(base.map((s) => s.staff).filter(Boolean))].sort(),
    [base],
  );
  const byStaff = base.filter((s) => !staff || s.staff === staff);
  const summary = summarizeCustomers(byStaff);
  const rows = filterCustomers(byStaff, filter).sort((a, b) => a.row - b.row);
  const selected = base.find((s) => s.row === selectedRow) ?? null;

  const set = (key: keyof CustomerFilter, value: Tri) =>
    setFilter((prev) => ({ ...prev, [key]: value }));
  const tile = (
    label: string,
    value: number,
    key: keyof CustomerFilter,
    tri: Tri,
  ) => (
    <SummaryTile
      label={label}
      value={`${value}명`}
      active={filter[key] === tri}
      onClick={() => set(key, filter[key] === tri ? "all" : tri)}
    />
  );

  return (
    <>
      <section
        aria-label="고객조회 요약"
        className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-7"
      >
        <SummaryTile
          label="기본 모수 (실력지표제외 X)"
          value={`${summary.base}명`}
          active={
            filter.scho === "all" &&
            filter.pilL === "all" &&
            filter.insurance === "all"
          }
          onClick={() =>
            setFilter({ scho: "all", pilL: "all", insurance: "all" })
          }
        />
        {tile("스초 O", summary.schoO, "scho", "O")}
        {tile("스초 X", summary.schoX, "scho", "X")}
        {tile("필L O", summary.pilLO, "pilL", "O")}
        {tile("필L X", summary.pilLX, "pilL", "X")}
        {tile("보험 O", summary.insuranceO, "insurance", "O")}
        {tile("보험 X", summary.insuranceX, "insurance", "X")}
      </section>

      <div className="mt-5 mb-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <FilterChips
          label="스초"
          value={filter.scho}
          onChange={(v) => set("scho", v)}
          options={TRI_OPTIONS("스초")}
        />
        <FilterChips
          label="필L"
          value={filter.pilL}
          onChange={(v) => set("pilL", v)}
          options={TRI_OPTIONS("필L")}
        />
        <FilterChips
          label="보험"
          value={filter.insurance}
          onChange={(v) => set("insurance", v)}
          options={TRI_OPTIONS("보험")}
        />
        <div className="ml-auto">
          <StaffSelect staff={staffNames} value={staff} onChange={setStaff} />
        </div>
      </div>
      <p className="mb-3 text-sm text-ink-sub">
        조회 결과 <span className="font-bold text-ink">{rows.length}명</span>
        <span className="ml-2 text-xs text-ink-muted">
          ({sheet} · 실력지표제외 X 고객 {byStaff.length}명 중)
        </span>
      </p>

      {rows.length === 0 ? (
        <EmptyBox
          text={
            base.length === 0
              ? `${sheet} 시트에 실력지표제외가 X 인 고객이 없습니다.`
              : "조건에 맞는 고객이 없습니다."
          }
        />
      ) : (
        <>
          <div className="hidden overflow-x-auto rounded-xl border border-line bg-white md:block">
            <table className="w-full min-w-[860px] text-sm">
              <thead className="border-b border-line bg-zinc-50 text-xs text-ink-sub">
                <tr>
                  {[
                    "No.",
                    "개통일",
                    "직원명",
                    "고객명",
                    "CTN",
                    "요금제",
                    "부가",
                    "보험",
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
                        aria-label={`No.${sale.no} ${sale.customer} 고객 상세 보기`}
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
                    <td className="px-3 py-3 text-ink">
                      <Mark on={hasScho(sale)} />
                      {sale.plan || "-"}
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap text-ink">
                      <Mark on={hasPilL(sale)} />
                      {sale.addon || "-"}
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap text-ink">
                      <Mark on={hasInsurance(sale)} />
                      {sale.insurance || "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <ul className="space-y-2.5 md:hidden">
            {rows.map((sale) => (
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
                    <span className="text-sm text-ink-sub">
                      {sale.staff || "-"}
                    </span>
                  </div>
                  <div className="mt-2 flex items-baseline justify-between gap-2">
                    <span className="text-base font-semibold text-ink">
                      {sale.customer || "-"}
                    </span>
                    <span className="text-sm text-ink-sub tabular-nums">
                      {sale.ctn ? maskedCtn(sale.ctn) : ""}
                    </span>
                  </div>
                  <div className="mt-2 grid grid-cols-3 gap-2 text-xs text-ink-sub">
                    <span>
                      <Mark on={hasScho(sale)} />
                      {sale.plan || "-"}
                    </span>
                    <span>
                      <Mark on={hasPilL(sale)} />
                      부가 {sale.addon || "-"}
                    </span>
                    <span>
                      <Mark on={hasInsurance(sale)} />
                      보험 {sale.insurance || "-"}
                    </span>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="mt-3 text-xs text-ink-muted">
        고객조회는 장표를 읽기만 합니다. 실력지표제외(F열)가 X 인 고객만 조회
        대상입니다.
      </p>

      {selected && (
        <SaleDetail
          sheet={sheet}
          sale={selected}
          readOnly
          onClose={() => setSelectedRow(null)}
        />
      )}
    </>
  );
}

/** 조건에 해당하면 초록 점 */
function Mark({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden
      className={`mr-1.5 inline-block h-2 w-2 rounded-full align-middle ${on ? "bg-emerald-500" : "bg-zinc-300"}`}
    />
  );
}
