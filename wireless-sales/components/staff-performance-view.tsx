"use client";

import { useState } from "react";
import { useFreshSalesData } from "@/components/sales-data-provider";
import {
  SalesDataGate,
  sheetLabel,
  sheetToYearMonth,
} from "@/components/sales-data-status";
import { EmptyBox } from "@/components/work-ui";
import { formatNumber } from "@/lib/format";
import type { SheetSale } from "@/lib/sheet-record";
import {
  aggregateStaffPerformance,
  daysOfMonth,
  filterByDay,
  staffOrderOf,
  type StaffPerformance,
} from "@/lib/staff-performance";

/* 직원 실적관리: 선택한 월 시트의 판매를 C열 개통일 기준으로 직원별 집계 (조회 전용) */

export function StaffPerformanceView() {
  useFreshSalesData();
  return (
    <SalesDataGate>
      {(data) => (
        // 월이 바뀌면 날짜 선택을 "월 전체" 로 되돌린다
        <StaffPerformanceBody
          key={data.sheet}
          sheet={data.sheet}
          sales={data.sales}
        />
      )}
    </SalesDataGate>
  );
}

const COLUMNS: {
  key: Exclude<keyof StaffPerformance, "staff">;
  label: string;
  money?: boolean;
  hint: string;
}[] = [
  { key: "postpaid", label: "후불", hint: "개통구분 신규·번이·기변 (UMNP 제외)" },
  { key: "portIn", label: "번이", hint: "개통구분 번이" },
  { key: "umnp", label: "UMNP", hint: "개통구분 UMNP" },
  { key: "scho", label: "스초", hint: "요금제에 '스초' 포함" },
  { key: "second", label: "2ND", hint: "AD열 O" },
  { key: "jeca", label: "제카", hint: "AE열 O" },
  { key: "dongpan", label: "동판", hint: "AK열 순동·신동·약동" },
  { key: "shindong", label: "신동", hint: "AK열 신동" },
  { key: "benefitSecured", label: "고혜확보", money: true, hint: "P+Q+R+S+T" },
  { key: "benefitUsed", label: "고혜사용", money: true, hint: "V+W+X+Y" },
  { key: "cash", label: "현금잔여", money: true, hint: "AB열" },
  {
    key: "totalAmount",
    label: "합계금액",
    money: true,
    hint: "고혜확보 − 고혜사용 + 현금잔여",
  },
];

function Cell({ value, money }: { value: number; money?: boolean }) {
  return (
    <span className={value < 0 ? "text-rose-600" : undefined}>
      {formatNumber(value)}
      <span className="ml-0.5 text-xs font-normal text-ink-muted">
        {money ? "원" : "건"}
      </span>
    </span>
  );
}

function StaffPerformanceBody({
  sheet,
  sales,
}: {
  sheet: string;
  sales: SheetSale[];
}) {
  const [day, setDay] = useState("");
  const yearMonth = sheetToYearMonth(sheet);
  const month = Number(yearMonth.slice(5, 7));
  const { rows, total } = aggregateStaffPerformance(
    filterByDay(sales, day),
    staffOrderOf(sales),
  );
  const title = day
    ? `${month}월 ${Number(day.slice(8, 10))}일`
    : `${sheetLabel(sheet)} 전체`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={day}
          onChange={(e) => setDay(e.target.value)}
          aria-label="날짜 선택"
          className="h-9 rounded-lg border border-line bg-white px-2.5 text-sm font-semibold text-ink"
        >
          <option value="">{month}월 전체</option>
          {daysOfMonth(yearMonth).map((d) => (
            <option key={d} value={d}>
              {month}월 {Number(d.slice(8, 10))}일
            </option>
          ))}
        </select>
        <span className="text-xs text-ink-muted">
          C열 개통일 기준 · 판매 {filterByDay(sales, day).length}건
        </span>
      </div>

      {rows.length === 0 ? (
        <EmptyBox text="이 월 시트에 판매내역이 없습니다." />
      ) : (
        <section
          aria-label={`${title} 직원별 실적`}
          className="overflow-x-auto rounded-xl border border-line bg-white"
        >
          <table className="w-full min-w-[900px] text-sm">
            <caption className="border-b border-line px-4 py-3 text-left text-sm font-bold text-ink">
              {title} 직원별 실적
            </caption>
            <thead className="bg-zinc-50 text-xs text-ink-sub">
              <tr>
                <th
                  scope="col"
                  className="sticky left-0 bg-zinc-50 px-3 py-2.5 text-left font-semibold"
                >
                  직원명
                </th>
                {COLUMNS.map((c) => (
                  <th
                    key={c.key}
                    scope="col"
                    title={c.hint}
                    className={`px-3 py-2.5 text-right font-semibold whitespace-nowrap ${
                      c.key === "totalAmount" ? "text-ink" : ""
                    }`}
                  >
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line tabular-nums">
              {rows.map((row) => (
                <tr key={row.staff}>
                  <th
                    scope="row"
                    className="sticky left-0 bg-white px-3 py-2.5 text-left font-semibold whitespace-nowrap text-ink"
                  >
                    {row.staff}
                  </th>
                  {COLUMNS.map((c) => (
                    <td
                      key={c.key}
                      className="px-3 py-2.5 text-right whitespace-nowrap text-ink"
                    >
                      <Cell value={row[c.key]} money={c.money} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t-2 border-line bg-brand-soft/40 tabular-nums">
              <tr>
                <th
                  scope="row"
                  className="sticky left-0 bg-brand-soft px-3 py-2.5 text-left font-bold text-ink"
                >
                  전체
                </th>
                {COLUMNS.map((c) => (
                  <td
                    key={c.key}
                    className="px-3 py-2.5 text-right font-bold whitespace-nowrap text-ink"
                  >
                    <Cell value={total[c.key]} money={c.money} />
                  </td>
                ))}
              </tr>
            </tfoot>
          </table>
        </section>
      )}

      <p className="text-xs leading-relaxed text-ink-muted">
        후불 = 신규·번이·기변 (UMNP 는 후불 실적이 아니라 제외, UMNP 칸에 따로) · 스초 = 요금제에 &lsquo;스초&rsquo; 포함 ·
        2ND = AD열 O · 제카 = AE열 O · 동판 = AK열 순동·신동·약동 · 고혜확보 =
        P+Q+R+S+T · 고혜사용 = V+W+X+Y (예산관리와 같은 기준) · 현금잔여 =
        AB열 (음수 포함) · 합계금액 = 고혜확보 − 고혜사용 + 현금잔여
      </p>
    </div>
  );
}
