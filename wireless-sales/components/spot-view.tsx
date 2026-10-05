"use client";

import { useState } from "react";
import { useFreshSalesData } from "@/components/sales-data-provider";
import { SalesDataGate, sheetLabel } from "@/components/sales-data-status";
import { EmptyBox } from "@/components/work-ui";
import { formatCtn, formatNumber } from "@/lib/format";
import { monthDayText } from "@/lib/sale-display";
import type { SheetSale } from "@/lib/sheet-record";
import {
  buildSpotReport,
  type SpotCheck,
  type SpotSummary,
} from "@/lib/spot";

/*
 * 스팟관리: 선택한 월 시트 O열(SPOT정책) 메모를 SPOT 번호별로 집계 (조회 전용).
 * SPOT별 금액은 메모에 적힌 금액만 더한다. O열 값과 메모 합계가 다르면 경고만 보여준다.
 */

export function SpotView() {
  useFreshSalesData();
  return (
    <SalesDataGate>
      {(data) => (
        // 월이 바뀌면 펼친 상세를 닫는다
        <SpotBody key={data.sheet} sheet={data.sheet} sales={data.sales} />
      )}
    </SalesDataGate>
  );
}

function Won({ value }: { value: number }) {
  return (
    <span className={value < 0 ? "text-rose-600" : undefined}>
      {formatNumber(value)}
      <span className="ml-0.5 text-xs font-normal text-ink-muted">원</span>
    </span>
  );
}

function SpotBody({ sheet, sales }: { sheet: string; sales: SheetSale[] }) {
  const report = buildSpotReport(sales);
  const [selected, setSelected] = useState<number | null>(null);
  const [showProblems, setShowProblems] = useState(false);
  const selectedSpot = report.spots.find((s) => s.spot === selected) ?? null;
  const mismatch = report.problems.filter((p) => p.status === "mismatch");
  const missing = report.problems.filter((p) => p.status === "missingNote");

  const toggle = (spot: number) =>
    setSelected((cur) => (cur === spot ? null : spot));

  return (
    <div className="space-y-4">
      {report.problems.length > 0 && (
        <button
          type="button"
          onClick={() => setShowProblems((v) => !v)}
          aria-expanded={showProblems}
          className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-left text-sm font-semibold text-amber-900"
        >
          <span aria-hidden>⚠</span>
          {mismatch.length > 0 && <span>금액 불일치 {mismatch.length}건</span>}
          {missing.length > 0 && <span>메모 미입력 {missing.length}건</span>}
          <span className="ml-auto text-xs font-medium underline underline-offset-2">
            {showProblems ? "닫기" : "확인하기"}
          </span>
        </button>
      )}

      {showProblems && report.problems.length > 0 && (
        <ProblemTable problems={report.problems} />
      )}

      {report.spots.length === 0 ? (
        <EmptyBox text="이 월 시트 O열 메모에 SPOT 내역이 없습니다." />
      ) : (
        <section
          aria-label={`${sheetLabel(sheet)} SPOT별 집계`}
          className="overflow-x-auto rounded-xl border border-line bg-white"
        >
          <table className="w-full min-w-[360px] text-sm">
            <caption className="border-b border-line px-4 py-3 text-left text-sm font-bold text-ink">
              {sheetLabel(sheet)} SPOT별 집계
              <span className="ml-2 text-xs font-normal text-ink-muted">
                항목을 누르면 고객 목록
              </span>
            </caption>
            <thead className="bg-zinc-50 text-xs text-ink-sub">
              <tr>
                <th scope="col" className="px-4 py-2.5 text-left font-semibold">
                  SPOT
                </th>
                <th scope="col" className="px-4 py-2.5 text-right font-semibold">
                  건수
                </th>
                <th scope="col" className="px-4 py-2.5 text-right font-semibold">
                  합계금액
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line tabular-nums">
              {report.spots.map((s) => {
                const active = s.spot === selected;
                return (
                  <tr key={s.spot} className={active ? "bg-brand-soft/40" : undefined}>
                    <th scope="row" className="px-4 py-2.5 text-left">
                      <button
                        type="button"
                        onClick={() => toggle(s.spot)}
                        aria-expanded={active}
                        className="font-semibold text-brand underline-offset-2 hover:underline"
                      >
                        {s.label}
                      </button>
                    </th>
                    <td className="px-4 py-2.5 text-right text-ink">
                      {formatNumber(s.count)}
                      <span className="ml-0.5 text-xs text-ink-muted">건</span>
                    </td>
                    <td className="px-4 py-2.5 text-right font-semibold text-ink">
                      <button
                        type="button"
                        onClick={() => toggle(s.spot)}
                        aria-label={`${s.label} 고객 목록`}
                        className="underline-offset-2 hover:underline"
                      >
                        <Won value={s.amount} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="border-t-2 border-line bg-brand-soft/40 tabular-nums">
              <tr>
                <th scope="row" className="px-4 py-2.5 text-left font-bold text-ink">
                  메모 합계
                </th>
                <td />
                <td className="px-4 py-2.5 text-right font-bold text-ink">
                  <Won value={report.noteTotal} />
                </td>
              </tr>
            </tfoot>
          </table>
        </section>
      )}

      {selectedSpot && <SpotCustomers spot={selectedSpot} />}

      <p className="text-xs leading-relaxed text-ink-muted">
        SPOT별 합계 = O열 메모에 적힌 SPOT별 금액의 합 (O열 값을 나누지 않음) ·
        건수 = 그 SPOT을 받은 판매 수 · 메모 형식: 줄마다 &ldquo;스팟1 3만&rdquo;
        · O열 값과 메모 합계가 다르면 위 경고에만 표시하며 장표는 수정하지
        않습니다.
      </p>
    </div>
  );
}

function SpotCustomers({ spot }: { spot: SpotSummary }) {
  return (
    <section
      aria-label={`${spot.label} 고객 목록`}
      className="overflow-x-auto rounded-xl border border-line bg-white"
    >
      <table className="w-full min-w-[320px] text-sm">
        <caption className="border-b border-line px-4 py-3 text-left text-sm font-bold text-ink">
          {spot.label} 고객 {spot.count}건
        </caption>
        <thead className="bg-zinc-50 text-xs text-ink-sub">
          <tr>
            <th scope="col" className="px-4 py-2.5 text-left font-semibold">개통일</th>
            <th scope="col" className="px-4 py-2.5 text-left font-semibold">고객명</th>
            <th scope="col" className="px-4 py-2.5 text-left font-semibold">CTN</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line tabular-nums text-ink">
          {spot.customers.map((c) => (
            <tr key={c.row}>
              <td className="px-4 py-2.5 whitespace-nowrap">{monthDayText(c.activatedAt)}</td>
              <td className="px-4 py-2.5 whitespace-nowrap">{c.customer || "-"}</td>
              <td className="px-4 py-2.5 whitespace-nowrap">{formatCtn(c.ctn) || "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function problemLabel(p: SpotCheck): string {
  if (p.status === "missingNote") return "메모 미입력";
  if (p.diff !== 0) return `${formatNumber(Math.abs(p.diff))}원 불일치`;
  return "해석 못한 줄";
}

function ProblemTable({ problems }: { problems: SpotCheck[] }) {
  return (
    <section
      aria-label="금액 확인 필요"
      className="overflow-x-auto rounded-xl border border-amber-300 bg-white"
    >
      <table className="w-full min-w-[760px] text-sm">
        <caption className="border-b border-amber-200 bg-amber-50/60 px-4 py-3 text-left text-sm font-bold text-ink">
          금액 확인 필요 {problems.length}건
          <span className="ml-2 text-xs font-normal text-ink-muted">
            차액 = O열 금액 − 메모 합계 · 차액은 어느 SPOT에도 나누지 않습니다
          </span>
        </caption>
        <thead className="bg-zinc-50 text-xs text-ink-sub">
          <tr>
            <th scope="col" className="px-3 py-2.5 text-left font-semibold">개통일</th>
            <th scope="col" className="px-3 py-2.5 text-left font-semibold">고객명</th>
            <th scope="col" className="px-3 py-2.5 text-left font-semibold">CTN</th>
            <th scope="col" className="px-3 py-2.5 text-right font-semibold">O열 금액</th>
            <th scope="col" className="px-3 py-2.5 text-right font-semibold">메모 합계</th>
            <th scope="col" className="px-3 py-2.5 text-right font-semibold">차액</th>
            <th scope="col" className="px-3 py-2.5 text-left font-semibold">원본 Note</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line tabular-nums text-ink">
          {problems.map((p) => (
            <tr key={p.sale.row} className="align-top">
              <td className="px-3 py-2.5 whitespace-nowrap">{monthDayText(p.sale.activatedAt)}</td>
              <td className="px-3 py-2.5 whitespace-nowrap">{p.sale.customer || "-"}</td>
              <td className="px-3 py-2.5 whitespace-nowrap">{formatCtn(p.sale.ctn) || "-"}</td>
              <td className="px-3 py-2.5 text-right whitespace-nowrap"><Won value={p.oAmount} /></td>
              <td className="px-3 py-2.5 text-right whitespace-nowrap"><Won value={p.noteTotal} /></td>
              <td className="px-3 py-2.5 text-right whitespace-nowrap">
                <span className="font-semibold text-rose-600">{problemLabel(p)}</span>
                {p.status !== "missingNote" && p.diff !== 0 && (
                  <span className="block text-xs text-ink-muted">
                    {p.diff > 0 ? "+" : "−"}
                    {formatNumber(Math.abs(p.diff))}
                  </span>
                )}
              </td>
              <td className="px-3 py-2.5">
                {p.note ? (
                  <pre className="font-sans text-xs whitespace-pre-wrap text-ink-sub">{p.note}</pre>
                ) : (
                  <span className="text-xs text-ink-muted">(메모 없음)</span>
                )}
                {p.unparsed.length > 0 && (
                  <span className="mt-1 block text-xs text-rose-600">
                    해석 못한 줄: {p.unparsed.join(" / ")}
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
