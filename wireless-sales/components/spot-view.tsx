"use client";

import { useState } from "react";
import { useFreshSalesData, useSalesData } from "@/components/sales-data-provider";
import { SalesDataGate, sheetLabel, sheetToYearMonth } from "@/components/sales-data-status";
import { SpotBulkPanel } from "@/components/spot-bulk-panel";
import { CURRENT_SPOT_TERM, spotTerm, type SpotTerm } from "@/lib/spot-term";
import { EmptyBox, Notice } from "@/components/work-ui";
import { formatCtn, formatNumber } from "@/lib/format";
import { monthDayText } from "@/lib/sale-display";
import { copyText } from "@/components/copy-text";
import {
  ADDON_STATE_LABEL,
  addonMessage,
  buildAddonOverview,
  checkAddon,
  type AddonOverview,
  type AddonOverviewItem,
  type AddonCheck,
  type AddonMessageSale,
  type AddonState,
} from "@/lib/spot-addon";
import type { SheetSale } from "@/lib/sheet-record";
import {
  buildSpotReport,
  spotLabel,
  type SpotCheck,
  type SpotSummary,
} from "@/lib/spot";

/*
 * 스팟관리: 선택한 월 시트 O열(SPOT정책) 메모를 SPOT 번호별로 집계.
 * SPOT별 금액은 메모에 적힌 금액만 더한다. O열 값과 메모 합계가 다르면 경고만 보여준다.
 * 상단 [스팟 일괄등록] 을 누르면 같은 화면 안에 일괄등록 영역이 펼쳐진다 (2026-11-28, components/spot-bulk-panel.tsx).
 * 일괄등록 저장 후에는 판매내역을 다시 읽어 아래 집계가 자동으로 갱신된다.
 */

export function SpotView() {
  useFreshSalesData();
  // [부가 미입력 고객 조회] 보기는 월을 바꿔도 유지 → 바꾼 월의 결과로 다시 계산된다
  const [addonView, setAddonView] = useState(false);
  return (
    <SalesDataGate>
      {(data) => (
        // 월이 바뀌면 펼친 상세를 닫는다
        <SpotBody key={data.sheet} sheet={data.sheet} sales={data.sales} addonView={addonView} setAddonView={setAddonView} />
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

function SpotBody({
  sheet,
  sales,
  addonView,
  setAddonView,
}: {
  sheet: string;
  sales: SheetSale[];
  addonView: boolean;
  setAddonView: (v: boolean) => void;
}) {
  const { invalidate } = useSalesData();
  // 보는 월의 명칭: 2026년 10월까지 "스팟", 11월부터 "충청" (같은 예산 항목, 메모의 스팟1·충청1 은 같은 1번)
  const term = spotTerm(sheetToYearMonth(sheet));
  const report = buildSpotReport(sales, term);
  const [selected, setSelected] = useState<number | null>(null);
  const [showProblems, setShowProblems] = useState(false);
  const [showBulk, setShowBulk] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const models = [...new Set(sales.map((s) => s.model).filter(Boolean))];
  const selectedSpot = report.spots.find((s) => s.spot === selected) ?? null;
  const mismatch = report.problems.filter((p) => p.status === "mismatch");
  const missing = report.problems.filter((p) => p.status === "missingNote");

  const toggle = (spot: number) =>
    setSelected((cur) => (cur === spot ? null : spot));

  return (
    <div className="space-y-4">
      {notice && <Notice message={notice} onClose={() => setNotice(null)} />}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setShowBulk((v) => !v)}
          aria-expanded={showBulk}
          className={`rounded-lg px-4 py-2 text-sm font-semibold ${
            showBulk ? "border border-brand bg-brand-soft/40 text-brand" : "bg-brand text-white hover:bg-brand-strong"
          }`}
        >
          {showBulk ? `${CURRENT_SPOT_TERM} 일괄등록 닫기 ▲` : `${CURRENT_SPOT_TERM} 일괄등록 ▼`}
        </button>
        <button
          type="button"
          onClick={() => setAddonView(!addonView)}
          aria-pressed={addonView}
          className={`rounded-lg px-4 py-2 text-sm font-semibold ${
            addonView ? "border border-rose-300 bg-rose-50 text-rose-700" : "border border-line bg-white text-ink hover:border-brand/50"
          }`}
        >
          부가 미입력 고객 조회
        </button>
        <span className="text-xs text-ink-muted">기간·모델별 {CURRENT_SPOT_TERM} 금액을 한 번에 등록 (미리보기 후 최종 등록 · 10월 이전 개통 판매는 &lsquo;스팟&rsquo;으로 기록)</span>
      </div>

      {showBulk && (
        <SpotBulkPanel
          modelSuggestions={models}
          defaultMonth={sheetToYearMonth(sheet)}
          onApplied={(message) => {
            setNotice(message);
            void invalidate();
          }}
          onClose={() => setShowBulk(false)}
        />
      )}

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
        <ProblemTable problems={report.problems} term={term} />
      )}

      {addonView ? (
        <AddonOverviewSection
          sheet={sheet}
          term={term}
          overview={buildAddonOverview(report.spots, new Map(report.checks.map((c) => [c.sale.row, c.oAmount])))}
          onBack={() => setAddonView(false)}
        />
      ) : report.spots.length === 0 ? (
        <EmptyBox text={`이 월 시트 O열 메모에 ${term} 내역이 없습니다.`} />
      ) : (
        <section
          aria-label={`${sheetLabel(sheet)} ${term}번호별 집계`}
          className="overflow-x-auto rounded-xl border border-line bg-white"
        >
          <table className="w-full min-w-[360px] text-sm">
            <caption className="border-b border-line px-4 py-3 text-left text-sm font-bold text-ink">
              {sheetLabel(sheet)} {term}번호별 집계
              <span className="ml-2 text-xs font-normal text-ink-muted">
                항목을 누르면 고객 목록
              </span>
            </caption>
            <thead className="bg-zinc-50 text-xs text-ink-sub">
              <tr>
                <th scope="col" className="px-4 py-2.5 text-left font-semibold">
                  {term}
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

      {!addonView && selectedSpot && <SpotCustomers spot={selectedSpot} />}

      <p className="text-xs leading-relaxed text-ink-muted">
        {term}번호별 합계 = O열 메모에 적힌 번호별 금액의 합 (O열 값을 나누지 않음) ·
        건수 = 그 번호를 받은 판매 수 · 메모 형식: 줄마다 &ldquo;{term}1 3만&rdquo;
        · 금액 없이 &ldquo;{term}11&rdquo;처럼 번호만 한 줄이면 O열 금액(다른 줄 금액 제외)을 그 번호 금액으로 봅니다
        · 2026년 10월까지는 &lsquo;스팟&rsquo;, 11월부터 &lsquo;충청&rsquo;으로 부르며 같은 예산 항목입니다 (메모의 스팟1·충청1 은 같은 1번으로 한 번만 집계)
        · O열 값과 메모 합계가 다르면 위 경고에만 표시하며 장표는 수정하지
        않습니다.
      </p>
    </div>
  );
}

/** 요금제·모델명: 장표 값 그대로, 비어 있으면 '미입력' (추정하지 않음) */
function TextOrMissing({ value }: { value?: string }) {
  const v = (value ?? "").trim();
  return v ? <>{v}</> : <span className="text-ink-muted">미입력</span>;
}

const TH = "px-3 py-2.5 text-left font-semibold whitespace-nowrap";
const TD = "px-3 py-2.5 whitespace-nowrap";

function rowTone(state: AddonState) {
  return state === "missing" ? "bg-rose-50/60" : state === "unclear" ? "bg-amber-50/60" : undefined;
}

function SpotCustomers({ spot }: { spot: SpotSummary }) {
  const checks = spot.customers.map((c) => ({ c, check: checkAddon(c.addon) }));
  const missingCount = checks.filter((x) => x.check.state === "missing").length;
  const unclearCount = checks.filter((x) => x.check.state === "unclear").length;
  return (
    <section
      aria-label={`${spot.label} 고객 목록`}
      className="overflow-x-auto rounded-xl border border-line bg-white"
    >
      <table className="w-full min-w-[1040px] text-sm">
        <caption className="border-b border-line px-4 py-3 text-left text-sm font-bold text-ink">
          {spot.label} 고객 {spot.count}건
          <span className="ml-2 text-xs font-semibold">
            {missingCount > 0 && <span className="text-rose-600">부가 미입력 {missingCount}건</span>}
            {missingCount > 0 && unclearCount > 0 && <span className="text-ink-muted"> · </span>}
            {unclearCount > 0 && <span className="text-amber-700">확인 필요 {unclearCount}건</span>}
            {missingCount === 0 && unclearCount === 0 && <span className="text-emerald-700">부가 모두 입력됨</span>}
          </span>
          <span className="mt-0.5 block text-xs font-normal text-ink-muted">
            부가서비스 = 장표 AI열(필L/필S) 기록 여부 검수 · 통신사 실제 가입 완료 여부는 아님 · 조회만 하며 장표는 바꾸지 않음
          </span>
        </caption>
        <thead className="bg-zinc-50 text-xs text-ink-sub">
          <tr>
            <th scope="col" className={TH}>개통일</th>
            <th scope="col" className={TH}>고객명</th>
            <th scope="col" className={TH}>CTN</th>
            <th scope="col" className={TH}>담당 직원</th>
            <th scope="col" className={TH}>부가서비스</th>
            <th scope="col" className={TH}>개통 요금제</th>
            <th scope="col" className={TH}>모델명</th>
            <th scope="col" className={TH}>조치</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line tabular-nums text-ink">
          {checks.map(({ c, check }) => (
            <tr key={c.row} className={rowTone(check.state)}>
              <td className={TD}>{monthDayText(c.activatedAt)}</td>
              <td className={TD}>{c.customer || "-"}</td>
              <td className={TD}>{formatCtn(c.ctn) || "-"}</td>
              <td className={TD}>{c.staff?.trim() || <span className="text-ink-muted">미기재</span>}</td>
              <td className={TD}><AddonBadge check={check} /></td>
              <td className={`${TD} max-w-[16rem] truncate`} title={c.plan}><TextOrMissing value={c.plan} /></td>
              <td className={TD}><TextOrMissing value={c.model} /></td>
              <td className={TD}>
                <AddonCopyButton
                  state={check.state}
                  sale={{ activatedAt: c.activatedAt, customer: c.customer, ctn: c.ctn, staff: c.staff ?? "" }}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/** [부가 미입력 고객 조회]: 선택한 월의 모든 번호를 판매별로 합쳐 미입력·확인 필요만 (조회용, 예산에 반영하지 않음) */
function AddonOverviewSection({
  sheet,
  term,
  overview,
  onBack,
}: {
  sheet: string;
  term: SpotTerm;
  overview: AddonOverview;
  onBack: () => void;
}) {
  const { missing, unclear } = overview;
  return (
    <section aria-label={`${sheetLabel(sheet)} 부가 미입력 고객`} className="space-y-3">
      <div className="rounded-xl border border-rose-200 bg-white p-4">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <h2 className="text-sm font-bold text-ink">{sheetLabel(sheet)} 부가 미입력 고객 ({term}번호 전체)</h2>
          <button
            type="button"
            onClick={onBack}
            className="ml-auto rounded-lg border border-line bg-white px-3 py-1.5 text-xs font-semibold text-ink hover:border-brand/50"
          >
            ← 번호별 집계로 돌아가기
          </button>
        </div>
        <dl className="mt-3 grid grid-cols-1 gap-2 text-sm tabular-nums sm:grid-cols-3">
          <div className="rounded-lg bg-rose-50 px-3 py-2">
            <dt className="text-xs text-rose-700">부가 미입력</dt>
            <dd className="text-lg font-bold text-rose-700">총 {missing.length}건</dd>
          </div>
          <div className="rounded-lg bg-zinc-50 px-3 py-2">
            <dt className="text-xs text-ink-sub">미입력 판매의 {term}예산 적용 금액 합계 (O열)</dt>
            <dd className="text-lg font-bold text-ink"><Won value={overview.missingAmount} /></dd>
          </div>
          <div className="rounded-lg bg-amber-50 px-3 py-2">
            <dt className="text-xs text-amber-800">확인 필요</dt>
            <dd className="text-lg font-bold text-amber-800">{unclear.length}건</dd>
          </div>
        </dl>
        <p className="mt-2 text-xs text-ink-muted">
          대상 = O열 메모에 {term}번호가 있는 판매 (같은 판매는 한 번만, 번호는 모두 표시) · 입력됨 {overview.enteredCount}건 제외 ·
          금액은 조회용이며 매장 예산에 더하거나 빼지 않습니다
        </p>
      </div>

      {missing.length === 0 ? (
        <EmptyBox text="부가 미입력 고객이 없습니다." />
      ) : (
        <OverviewTable label="부가 미입력 고객" items={missing} />
      )}

      {unclear.length > 0 && (
        <details className="rounded-xl border border-amber-300 bg-amber-50/40">
          <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-amber-900">
            확인 필요 {unclear.length}건 (장표 AI열 값을 해석할 수 없음 — 미입력으로 단정하지 않음) · 펼쳐 보기
          </summary>
          <div className="px-2 pb-2">
            <OverviewTable label="확인 필요 고객" items={unclear} />
          </div>
        </details>
      )}
    </section>
  );
}

function OverviewTable({ label, items }: { label: string; items: AddonOverviewItem[] }) {
  return (
    <div aria-label={label} className="overflow-x-auto rounded-xl border border-line bg-white">
      <table className="w-full min-w-[1180px] text-sm">
        <thead className="bg-zinc-50 text-xs text-ink-sub">
          <tr>
            <th scope="col" className={TH}>개통일</th>
            <th scope="col" className={TH}>고객명</th>
            <th scope="col" className={TH}>CTN</th>
            <th scope="col" className={TH}>담당 직원</th>
            <th scope="col" className={TH}>번호</th>
            <th scope="col" className={`${TH} text-right`}>적용 금액(O열)</th>
            <th scope="col" className={TH}>부가서비스</th>
            <th scope="col" className={TH}>개통 요금제</th>
            <th scope="col" className={TH}>모델명</th>
            <th scope="col" className={TH}>조치</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line tabular-nums text-ink">
          {items.map((i) => (
            <tr key={i.row} className={rowTone(i.check.state)}>
              <td className={TD}>{monthDayText(i.activatedAt)}</td>
              <td className={TD}>{i.customer || "-"}</td>
              <td className={TD}>{formatCtn(i.ctn) || "-"}</td>
              <td className={TD}>{i.staff.trim() || <span className="text-ink-muted">미기재</span>}</td>
              <td className={TD}>{i.spots.map((x) => x.label).join(", ")}</td>
              <td className={`${TD} text-right font-semibold`}><Won value={i.oAmount} /></td>
              <td className={TD}><AddonBadge check={i.check} /></td>
              <td className={`${TD} max-w-[16rem] truncate`} title={i.plan}><TextOrMissing value={i.plan} /></td>
              <td className={TD}><TextOrMissing value={i.model} /></td>
              <td className={TD}>
                <AddonCopyButton
                  state={i.check.state}
                  sale={{ activatedAt: i.activatedAt, customer: i.customer, ctn: i.ctn, staff: i.staff }}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AddonBadge({ check }: { check: AddonCheck }) {
  if (check.state === "entered") {
    return (
      <span className="inline-flex items-center gap-1.5">
        <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-200">
          {ADDON_STATE_LABEL.entered}
        </span>
        <span className="font-semibold text-ink">{check.names.join(", ")}</span>
      </span>
    );
  }
  if (check.state === "missing") {
    return (
      <span className="rounded-full bg-rose-100 px-2 py-0.5 text-xs font-bold text-rose-700 ring-1 ring-rose-300">
        {ADDON_STATE_LABEL.missing}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-800 ring-1 ring-amber-300">
        {ADDON_STATE_LABEL.unclear}
      </span>
      {check.raw && <span className="max-w-[12rem] truncate text-xs text-ink-sub" title={check.raw}>장표: {check.raw}</span>}
    </span>
  );
}

/** 미입력 → [카톡용 복사], 확인 필요 → [확인 요청 복사], 입력됨 → 버튼 없음. 복사만 하고 전송·저장은 하지 않는다 */
function AddonCopyButton({ state, sale }: { state: AddonState; sale: AddonMessageSale }) {
  const [result, setResult] = useState<"idle" | "done" | "failed">("idle");
  const message = addonMessage(sale, state);
  if (!message) return <span className="text-xs text-ink-muted">-</span>;
  const label = state === "missing" ? "카톡용 복사" : "확인 요청 복사";
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button
        type="button"
        onClick={async () => {
          const ok = await copyText(message);
          setResult(ok ? "done" : "failed");
          if (ok) setTimeout(() => setResult((r) => (r === "done" ? "idle" : r)), 2500);
        }}
        className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${
          result === "done"
            ? "border border-emerald-300 bg-emerald-50 text-emerald-700"
            : state === "missing"
              ? "bg-brand text-white hover:bg-brand-strong"
              : "border border-amber-300 bg-white text-amber-800 hover:bg-amber-50"
        }`}
      >
        {result === "done" ? "✓ 복사 완료" : label}
      </button>
      {result === "failed" && (
        <span className="w-64 whitespace-normal text-xs text-rose-600">
          복사하지 못했습니다. 아래 문구를 길게 눌러 직접 복사해 주세요.
          <textarea readOnly value={message} rows={6} className="mt-1 block w-full rounded border border-line p-1 text-xs text-ink" />
        </span>
      )}
    </span>
  );
}

function problemLabel(p: SpotCheck, term: SpotTerm): string {
  if (p.status === "missingNote") return "메모 미입력";
  if (p.unsplit.length > 0) return `${term} 금액 미기재`;
  if (p.diff !== 0) return `${formatNumber(Math.abs(p.diff))}원 불일치`;
  return "해석 못한 줄";
}

function ProblemTable({ problems, term }: { problems: SpotCheck[]; term: SpotTerm }) {
  return (
    <section
      aria-label="금액 확인 필요"
      className="overflow-x-auto rounded-xl border border-amber-300 bg-white"
    >
      <table className="w-full min-w-[760px] text-sm">
        <caption className="border-b border-amber-200 bg-amber-50/60 px-4 py-3 text-left text-sm font-bold text-ink">
          금액 확인 필요 {problems.length}건
          <span className="ml-2 text-xs font-normal text-ink-muted">
            차액 = O열 금액 − 메모 합계 · 차액은 어느 번호에도 나누지 않습니다
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
                <span className="font-semibold text-rose-600">{problemLabel(p, term)}</span>
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
                {p.unsplit.length > 0 && (
                  <span className="mt-1 block text-xs text-rose-600">
                    금액 없이 번호만 적힌 {term}: {p.unsplit.map((n) => spotLabel(n, term)).join(" · ")} — O열 금액을 어느 번호에 얼마씩
                    나눌지 알 수 없어 번호별 합계에 넣지 않았습니다. 메모에 번호별 금액을 적어 주세요 (예: {term}10 3만)
                  </span>
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
