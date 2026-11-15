"use client";

import { useMemo, useState } from "react";
import { useSalesData } from "@/components/sales-data-provider";
import { useSalesConfig } from "@/components/use-sales-config";
import { useManyMonthSales, type SheetSaleWithSheet } from "@/components/use-many-month-sales";
import { SaleDetail } from "@/components/sale-detail";
import { EmptyBox, SummaryTile } from "@/components/work-ui";
import { formatNumber, todayInKorea } from "@/lib/format";
import { previousMonth, sheetForMonth } from "@/lib/month-sheet";
import { PRODUCT_METRICS, metricHit, saleMetrics } from "@/lib/product-metrics";
import { campaignOfLink } from "@/lib/campaigns";
import { INFLOW_CHECK } from "@/lib/inflow-options";
import { inflowOf } from "@/lib/sale-link";
import { ribbonOf } from "@/lib/ribbon";
import { campaignKeyOf, campaignRows, campaignSummary, filterCampaignSales, type CampaignFilter } from "@/lib/sales-analysis";

/*
 * 캠페인별 판매 고객 조회·실적 (점장 전용, 조회 전용 — 유입·캠페인 분석 화면의 "캠페인" 탭).
 * 캠페인 연결은 판매연결의 캠페인ID(목록과 맞춘 것)와 보고 원문(목록에 없으면 "확인 필요")으로만 정한다.
 * 행사 기간에 팔렸다는 이유만으로 캠페인 고객으로 보지 않는다. 사전예약처럼 여러 달에 걸친 판매는
 * 최근 3·6·12개월 월 시트를 함께 읽어 본다. 고객명은 이 화면(로그인한 점장)에서만 보이고 다른 곳으로 보내지 않는다.
 */

type Range = 3 | 6 | 12;

function monthsBack(today: string, count: number): string[] {
  const out: string[] = [];
  let m = today.slice(0, 7);
  for (let i = 0; i < count; i++) {
    out.push(m);
    m = previousMonth(m);
  }
  return out;
}

export function CampaignView() {
  const today = todayInKorea();
  const { sheets } = useSalesData();
  const { config } = useSalesConfig();
  const [range, setRange] = useState<Range>(3);
  const wanted = useMemo(
    () =>
      monthsBack(today, range)
        .map((m) => sheetForMonth(m, today))
        .filter((s): s is string => !!s && sheets.includes(s)),
    [today, range, sheets],
  );
  const { sales, loading, errors } = useManyMonthSales(wanted);
  const rows = useMemo(() => campaignRows(sales, config.campaigns, config.inflows), [sales, config]);
  const [filter, setFilter] = useState<CampaignFilter>({ campaign: "" });
  const [opened, setOpened] = useState<SheetSaleWithSheet | null>(null);
  const campaignKey = filter.campaign || rows[0]?.key || "";
  const f = { ...filter, campaign: campaignKey };
  const inCampaign = useMemo(
    () => sales.filter((s) => campaignKeyOf(s, config.campaigns) === campaignKey),
    [sales, config.campaigns, campaignKey],
  );
  const selected = (filterCampaignSales(sales, f, config.campaigns, config.inflows) as SheetSaleWithSheet[]).sort(
    (a, b) => a.activatedAt.localeCompare(b.activatedAt) || a.row - b.row,
  );
  const summary = campaignSummary(selected, config.inflows);
  const choice = rows.find((r) => r.key === campaignKey);
  const info = choice?.state === "linked" ? config.campaigns.find((c) => c.id === choice.key) : undefined;
  const distinct = (values: string[]) => [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, "ko"));
  const staffList = distinct(inCampaign.map((s) => s.staff || "(직원명 없음)"));
  const inflowList = distinct(inCampaign.map((s) => inflowOf(s, config.inflows)));
  const categoryList = distinct(inCampaign.map((s) => (s.category || "").trim()));
  const set = (patch: Partial<CampaignFilter>) => setFilter((prev) => ({ ...prev, campaign: campaignKey, ...patch }));
  const select = "h-9 rounded-lg border border-line bg-white px-2.5 text-sm text-ink";

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <select aria-label="조회 기간" value={range} onChange={(e) => setRange(Number(e.target.value) as Range)} className={select}>
          <option value={3}>최근 3개월 장표</option>
          <option value={6}>최근 6개월 장표</option>
          <option value={12}>최근 12개월 장표</option>
        </select>
        <select
          aria-label="캠페인"
          value={campaignKey}
          onChange={(e) => setFilter({ campaign: e.target.value })}
          className={`${select} min-w-56 font-semibold`}
        >
          {rows.length === 0 && <option value="">캠페인으로 판매된 고객이 없습니다</option>}
          {rows.map((r) => (
            <option key={r.key} value={r.key}>
              {r.state === "check" ? `${INFLOW_CHECK} · ${r.campaign}` : r.campaign} ({r.sales}건)
            </option>
          ))}
        </select>
        <span className="text-xs text-ink-muted">
          {loading ? "장표를 불러오는 중…" : `${wanted.join("·")} 장표 · 판매 ${formatNumber(sales.length)}건 중`}
        </span>
      </div>
      {errors.length > 0 && (
        <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">
          일부 장표를 불러오지 못했습니다: {errors.join(" / ")}
        </p>
      )}
      {choice?.state === "check" && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
          캠페인 목록에 없는 이름으로 보고된 판매입니다. &ldquo;항목 관리&rdquo;에서 캠페인을 만들거나 별칭으로 넣은 뒤 &ldquo;원문이 같은 판매 연결&rdquo;을 누르면 이 판매들이 그 캠페인으로 묶입니다.
        </p>
      )}
      {info && (
        <p className="text-xs text-ink-sub">
          {info.type} · {info.start || "시작일 없음"} ~ {info.end || "종료일 없음"} · {info.status}
          {!info.active && " · 사용 안 함"} {info.aliases.length > 0 && `· 별칭: ${info.aliases.join(", ")}`}
        </p>
      )}

      {rows.length === 0 ? (
        <EmptyBox text="이 기간 장표에 캠페인이 입력된 판매가 없습니다. 카톡 보고에 '캠페인 : 행사명'을 적으면 여기에 모입니다." />
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-2 rounded-xl border border-line bg-white p-3">
            <label className="text-xs text-ink-sub">
              판매 시작일
              <input type="date" aria-label="판매 시작일" value={f.start ?? ""} onChange={(e) => set({ start: e.target.value })} className={`${select} mt-1 block`} />
            </label>
            <label className="text-xs text-ink-sub">
              판매 종료일
              <input type="date" aria-label="판매 종료일" value={f.end ?? ""} onChange={(e) => set({ end: e.target.value })} className={`${select} mt-1 block`} />
            </label>
            <label className="text-xs text-ink-sub">
              담당 직원
              <select aria-label="담당 직원" value={f.staff ?? ""} onChange={(e) => set({ staff: e.target.value })} className={`${select} mt-1 block`}>
                <option value="">전체</option>
                {staffList.map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            </label>
            <label className="text-xs text-ink-sub">
              유입경로
              <select aria-label="유입경로" value={f.inflow ?? ""} onChange={(e) => set({ inflow: e.target.value })} className={`${select} mt-1 block`}>
                <option value="">전체</option>
                {inflowList.map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            </label>
            <label className="text-xs text-ink-sub">
              개통구분
              <select aria-label="개통구분" value={f.category ?? ""} onChange={(e) => set({ category: e.target.value })} className={`${select} mt-1 block`}>
                <option value="">전체</option>
                {categoryList.map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            </label>
            <label className="text-xs text-ink-sub">
              모델
              <input aria-label="모델" value={f.model ?? ""} onChange={(e) => set({ model: e.target.value })} placeholder="모델명 일부" className={`${select} mt-1 block w-32`} />
            </label>
            <button type="button" onClick={() => setFilter({ campaign: campaignKey })} className="h-9 rounded-lg border border-line px-3 text-xs font-semibold text-ink-sub">
              조건 지우기
            </button>
          </div>

          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <SummaryTile label="총 판매" value={`${formatNumber(summary.sales)}건`} />
            <SummaryTile label="후불" value={`${formatNumber(summary.metrics.postpaid)}건`} />
            <SummaryTile label="번호이동" value={`${formatNumber(summary.metrics.portIn)}건`} />
            <SummaryTile label="리본" value={`${formatNumber(summary.metrics.goodbye)}건`} />
            <SummaryTile label="확보 예산" value={`${formatNumber(summary.budget.secured)}원`} />
            <SummaryTile label="사용 예산" value={`${formatNumber(summary.budget.used)}원`} />
            <SummaryTile label="현금 (AB)" value={`${formatNumber(summary.budget.cash)}원`} />
            <SummaryTile label="최종 잔여" value={`${formatNumber(summary.budget.remaining)}원`} tone={summary.budget.remaining < 0 ? "warn" : "default"} />
          </div>
          {summary.ribbonUnknown > 0 && (
            <p className="text-xs text-ink-muted">리본 판정 불가(중고폰&amp;현물 판매 원본 없음) {summary.ribbonUnknown}건은 리본에 세지 않았습니다.</p>
          )}

          <SimpleTable
            title="상품별 실적 (지표끼리 더하지 않음)"
            head={["지표", "건수"]}
            rows={PRODUCT_METRICS.map((m) => [m.label, `${formatNumber(summary.metrics[m.key])}건`])}
          />
          <SimpleTable
            title="직원별 판매"
            head={["직원", "판매", "후불"]}
            rows={summary.byStaff.map((r) => [r.staff, `${r.sales}건`, `${r.postpaid}건`])}
          />
          <SimpleTable title="유입경로별 판매" head={["유입경로", "판매"]} rows={summary.byInflow.map((r) => [r.inflow, `${r.sales}건`])} />

          <section aria-label="캠페인 판매 고객" className="overflow-x-auto rounded-xl border border-line bg-white">
            <h2 className="border-b border-line px-4 py-3 text-sm font-bold text-ink">판매 고객 {selected.length}명 (행을 누르면 판매 상세)</h2>
            {selected.length === 0 ? (
              <p className="px-4 py-3 text-sm text-ink-muted">조건에 맞는 판매가 없습니다.</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-zinc-50 text-xs text-ink-sub">
                  <tr>
                    {["고객명", "판매일", "담당 직원", "모델", "개통구분", "유입경로", "캠페인", "리본", "상품별 실적"].map((h) => (
                      <th key={h} scope="col" className="px-3 py-2.5 text-left font-semibold whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {selected.map((s) => {
                    const m = saleMetrics(s);
                    const c = campaignOfLink(s.link, config.campaigns);
                    const r = ribbonOf(s);
                    return (
                      <tr key={`${s.sheet}-${s.row}`} onClick={() => setOpened(s)} className="cursor-pointer hover:bg-zinc-50">
                        <th scope="row" className="px-3 py-2.5 text-left font-semibold whitespace-nowrap text-ink">{s.customer || "(고객명 없음)"}</th>
                        <td className="px-3 py-2.5 whitespace-nowrap tabular-nums">{s.activatedAt}</td>
                        <td className="px-3 py-2.5 whitespace-nowrap">{s.staff || "-"}</td>
                        <td className="px-3 py-2.5 whitespace-nowrap">{s.model || "-"}</td>
                        <td className="px-3 py-2.5 whitespace-nowrap">{s.category || "-"}</td>
                        <td className="px-3 py-2.5 whitespace-nowrap">{inflowOf(s, config.inflows)}</td>
                        <td className="px-3 py-2.5 whitespace-nowrap">{c.state === "linked" ? c.name : c.state === "check" ? `${INFLOW_CHECK} · ${c.raw}` : "-"}</td>
                        <td className="px-3 py-2.5 whitespace-nowrap">{r.value === "판정불가" ? "판정 불가" : r.value}</td>
                        <td className="px-3 py-2.5 text-xs text-ink-sub">
                          {PRODUCT_METRICS.filter((x) => metricHit(m, x.key)).map((x) => x.label).join(" · ") || "-"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </section>
        </>
      )}
      {opened && <SaleDetail sheet={opened.sheet} sale={opened} readOnly onClose={() => setOpened(null)} />}
    </div>
  );
}

function SimpleTable({ title, head, rows }: { title: string; head: string[]; rows: string[][] }) {
  return (
    <section aria-label={title} className="overflow-x-auto rounded-xl border border-line bg-white">
      <h2 className="border-b border-line px-4 py-3 text-sm font-bold text-ink">{title}</h2>
      {rows.length === 0 ? (
        <p className="px-4 py-3 text-sm text-ink-muted">자료가 없습니다.</p>
      ) : (
        <table className="w-full text-sm tabular-nums">
          <thead className="bg-zinc-50 text-xs text-ink-sub">
            <tr>
              {head.map((h, i) => (
                <th key={h} scope="col" className={`px-3 py-2.5 font-semibold whitespace-nowrap ${i === 0 ? "text-left" : "text-right"}`}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((r, j) => (
              <tr key={`${r[0]}-${j}`}>
                {r.map((cell, i) =>
                  i === 0 ? (
                    <th key={i} scope="row" className="px-3 py-2.5 text-left font-semibold whitespace-nowrap text-ink">{cell}</th>
                  ) : (
                    <td key={i} className="px-3 py-2.5 text-right whitespace-nowrap text-ink">{cell}</td>
                  ),
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
