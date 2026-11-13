"use client";

import { useMemo, useState } from "react";
import { useFreshSalesData, useSalesData } from "@/components/sales-data-provider";
import { SalesDataGate, sheetLabel, sheetToYearMonth } from "@/components/sales-data-status";
import { useMonthSales } from "@/components/use-month-sales";
import { EmptyBox, SummaryTile } from "@/components/work-ui";
import { formatNumber, todayInKorea } from "@/lib/format";
import { previousMonth, sheetForMonth } from "@/lib/month-sheet";
import { PRODUCT_METRICS } from "@/lib/product-metrics";
import { INFLOW_MISSING, inflowOf } from "@/lib/sale-link";
import {
  INFLOW_ROWS,
  addDays,
  campaignRows,
  crossCount,
  dayPeriod,
  groupCount,
  inRange,
  inflowInputRate,
  inflowRows,
  metricByInflow,
  monthPeriod,
  weekPeriod,
  weekStart,
  weeklyInflowTrend,
  type Period,
} from "@/lib/sales-analysis";
import type { SheetSale } from "@/lib/sheet-record";
import { daysOfMonth } from "@/lib/staff-performance";

/*
 * 고객 유입경로 분석 (점장 전용, 조회 전용).
 * 판매 건수·판매 비중만 보여 준다. 상담 후 구매하지 않은 고객 데이터가 없으므로 구매 전환율은 계산하지 않는다
 * (판매 비중 = 전체 판매 중 그 경로의 판매 비율이며 전환율이 아니다).
 * 유입경로가 저장되지 않은 판매는 "미입력" (직접 고른 "미확인"과 구분). 예전 판매를 추정해 채우지 않는다.
 */

type PeriodKind = "month" | "week" | "day";

export function InflowAnalysisView() {
  useFreshSalesData();
  // 월 시트 목록 (전월 시트가 있는지 확인용)
  const { sheets } = useSalesData();
  return (
    <SalesDataGate>
      {(data) => <AnalysisBody key={data.sheet} sheet={data.sheet} sheets={sheets} sales={data.sales} />}
    </SalesDataGate>
  );
}

function AnalysisBody({ sheet, sheets, sales }: { sheet: string; sheets: string[]; sales: SheetSale[] }) {
  const today = todayInKorea();
  const month = sheetToYearMonth(sheet);
  const mp = monthPeriod(month);
  const refDay = today >= mp.start && today <= mp.end ? today : mp.end;
  const [kind, setKind] = useState<PeriodKind>("month");
  const [day, setDay] = useState(refDay);
  const [week, setWeek] = useState(weekStart(refDay));
  const prevMonth = previousMonth(month);
  const prevSheet = sheetForMonth(prevMonth, today);
  const prev = useMonthSales(prevSheet && sheets.includes(prevSheet) ? prevSheet : null);

  const weeks = useMemo(() => {
    const set = new Set(daysOfMonth(month).map(weekStart));
    return [...set].sort();
  }, [month]);
  const period: Period = kind === "month" ? mp : kind === "week" ? weekPeriod(week) : dayPeriod(day);
  // 주가 지난 달에 걸치면 전월 판매도 함께 (불러온 경우)
  const pool = useMemo(() => [...sales, ...(prev.sales ?? [])], [sales, prev.sales]);
  const selected = useMemo(() => (kind === "month" ? sales : inRange(pool, period.start, period.end)), [kind, sales, pool, period.start, period.end]);

  const rate = inflowInputRate(selected);
  const rows = inflowRows(selected);
  const shown = rows.filter((r) => r.sales > 0);
  const byStaff = crossCount(selected, (s) => s.staff || "(직원명 없음)");
  const byMetric = metricByInflow(selected);
  const campaigns = campaignRows(selected);
  const trend = weeklyInflowTrend(sales);
  const usedInflows = INFLOW_ROWS.filter((i) => selected.some((s) => inflowOf(s) === i));
  const prevByInflow = groupCount(prev.sales ?? [], inflowOf);
  const curByInflow = groupCount(sales, inflowOf);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <select aria-label="기간 단위" value={kind} onChange={(e) => setKind(e.target.value as PeriodKind)} className="h-9 rounded-lg border border-line bg-white px-2.5 text-sm font-semibold text-ink">
          <option value="month">월간</option>
          <option value="week">주간</option>
          <option value="day">일간</option>
        </select>
        {kind === "week" && (
          <select aria-label="주 선택" value={week} onChange={(e) => setWeek(e.target.value)} className="h-9 rounded-lg border border-line bg-white px-2.5 text-sm font-semibold text-ink">
            {weeks.map((w) => (
              <option key={w} value={w}>
                {w} ~ {addDays(w, 6)}
              </option>
            ))}
          </select>
        )}
        {kind === "day" && (
          <select aria-label="날짜 선택" value={day} onChange={(e) => setDay(e.target.value)} className="h-9 rounded-lg border border-line bg-white px-2.5 text-sm font-semibold text-ink">
            {daysOfMonth(month).map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        )}
        <span className="text-xs text-ink-muted">
          {kind === "month" ? sheetLabel(sheet) : period.label} · C열 개통일 기준 · 판매 {formatNumber(selected.length)}건
        </span>
      </div>

      <p className="rounded-lg bg-zinc-50 px-3 py-2 text-xs text-ink-sub">
        판매 건수와 판매 비중(전체 판매 중 비율)만 보여 줍니다. 상담 후 구매하지 않은 고객 데이터가 없어 유입경로별 구매 전환율은 계산하지 않습니다.
      </p>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <SummaryTile label="판매" value={`${formatNumber(rate.total)}건`} />
        <SummaryTile label="유입경로 입력률" value={`${rate.rate}%`} tone={rate.rate < 100 ? "warn" : "good"} />
        <SummaryTile label="미입력" value={`${formatNumber(rate.missing)}건`} tone={rate.missing ? "warn" : "default"} />
        <SummaryTile label="미확인 (직접 선택)" value={`${formatNumber(rate.unknown)}건`} />
      </div>

      {selected.length === 0 ? (
        <EmptyBox text="이 기간에 판매가 없습니다." />
      ) : (
        <>
          <Table
            title="유입경로별 판매 건수 · 비중 · 예산"
            head={["유입경로", "판매", "판매 비중", "후불", "확보 예산", "사용 예산", "최종 잔여"]}
            rows={shown.map((r) => [
              r.inflow,
              `${formatNumber(r.sales)}건`,
              `${r.share}%`,
              `${formatNumber(r.metrics.postpaid)}건`,
              `${formatNumber(r.budget.secured)}원`,
              `${formatNumber(r.budget.used)}원`,
              `${formatNumber(r.budget.remaining)}원`,
            ])}
            note="예산은 직원 실적관리와 같은 기준 (확보 = P+Q+R+S+T, 사용 = V+W+X+Y, 최종 잔여 = 확보 − 사용 + AB 현금잔여)."
          />
          <Table
            title="직원별 유입경로 판매 건수"
            head={["직원", ...usedInflows, "합계"]}
            rows={byStaff.rows.map((name) => {
              const cells = byStaff.cells.get(name)!;
              const total = [...cells.values()].reduce((a, b) => a + b, 0);
              return [name, ...usedInflows.map((i) => formatNumber(cells.get(i) ?? 0)), formatNumber(total)];
            })}
          />
          <Table
            title="상품 지표별 유입경로 (지표에 해당하는 판매만, 지표끼리 더하지 않음)"
            head={["지표", ...usedInflows, "합계"]}
            rows={PRODUCT_METRICS.map((m) => {
              const cells = byMetric.get(m.key)!;
              const total = [...cells.values()].reduce((a, b) => a + b, 0);
              return [m.label, ...usedInflows.map((i) => formatNumber(cells.get(i) ?? 0)), formatNumber(total)];
            })}
          />
          <Table
            title="캠페인별 판매"
            head={["캠페인", "판매", "유입경로"]}
            rows={campaigns.map((c) => [
              c.campaign,
              `${formatNumber(c.sales)}건`,
              [...c.inflows.entries()].map(([i, n]) => `${i} ${n}`).join(", "),
            ])}
            empty="캠페인이 입력된 판매가 없습니다."
          />
        </>
      )}

      <Table
        title={`${sheetLabel(sheet)} 주별 유입경로 변화 (월요일 시작 주)`}
        head={["주", "판매", ...INFLOW_ROWS.filter((i) => sales.some((s) => inflowOf(s) === i))]}
        rows={trend.map((t) => [
          `${t.week} ~`,
          formatNumber(t.total),
          ...INFLOW_ROWS.filter((i) => sales.some((s) => inflowOf(s) === i)).map((i) => formatNumber(t.inflows.get(i) ?? 0)),
        ])}
        empty="판매가 없습니다."
      />
      <Table
        title={`월간 유입경로 변화 (${month} / 전월 ${prevMonth})`}
        head={["유입경로", "이번 달", "전월", "차이"]}
        rows={INFLOW_ROWS.filter((i) => (curByInflow.get(i) ?? 0) + (prevByInflow.get(i) ?? 0) > 0).map((i) => {
          const c = curByInflow.get(i) ?? 0;
          const p = prevByInflow.get(i) ?? 0;
          return [i, formatNumber(c), prev.sales ? formatNumber(p) : "-", prev.sales ? (c - p > 0 ? `+${c - p}` : String(c - p)) : "-"];
        })}
        note={
          prev.sales === null
            ? prev.loading
              ? "전월 장표를 불러오는 중입니다."
              : "전월 장표가 없거나 불러오지 못했습니다."
            : `전월 판매 중 유입경로 미입력 ${formatNumber(prevByInflow.get(INFLOW_MISSING) ?? 0)}건 (기능 도입 전 판매는 미입력으로 셉니다)`
        }
        empty="판매가 없습니다."
      />
    </div>
  );
}

function Table({ title, head, rows, note, empty }: { title: string; head: string[]; rows: string[][]; note?: string; empty?: string }) {
  return (
    <section aria-label={title} className="overflow-x-auto rounded-xl border border-line bg-white">
      <h2 className="border-b border-line px-4 py-3 text-sm font-bold text-ink">{title}</h2>
      {rows.length === 0 ? (
        <p className="px-4 py-3 text-sm text-ink-muted">{empty ?? "자료가 없습니다."}</p>
      ) : (
        <table className="w-full text-sm tabular-nums">
          <thead className="bg-zinc-50 text-xs text-ink-sub">
            <tr>
              {head.map((h, i) => (
                <th key={`${h}-${i}`} scope="col" className={`px-3 py-2.5 font-semibold whitespace-nowrap ${i === 0 ? "text-left" : "text-right"}`}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((r, j) => (
              <tr key={`${r[0]}-${j}`}>
                {r.map((cell, i) =>
                  i === 0 ? (
                    <th key={i} scope="row" className="px-3 py-2.5 text-left font-semibold whitespace-nowrap text-ink">
                      {cell}
                    </th>
                  ) : (
                    <td key={i} className="px-3 py-2.5 text-right whitespace-nowrap text-ink">
                      {cell}
                    </td>
                  ),
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {note && <p className="border-t border-line px-4 py-2 text-xs text-ink-muted">{note}</p>}
    </section>
  );
}
