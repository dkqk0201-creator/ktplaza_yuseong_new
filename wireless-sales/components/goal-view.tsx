"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useFreshSalesData, useSalesData } from "@/components/sales-data-provider";
import { SalesDataGate, sheetLabel, sheetToYearMonth } from "@/components/sales-data-status";
import { useMonthSales } from "@/components/use-month-sales";
import { EmptyBox, SummaryTile } from "@/components/work-ui";
import { STAFF, activeStaffNames, staffIdForName } from "@/lib/data/staff-list";
import { formatNumber, todayInKorea } from "@/lib/format";
import {
  achievement,
  goalKey,
  goalMap,
  parseGoalInput,
  type GoalChange,
  type GoalHistoryItem,
  type GoalItem,
  type GoalScope,
} from "@/lib/goals";
import { nextMonth, previousMonth, salesAcrossMonths, sheetForMonth } from "@/lib/month-sheet";
import {
  PRODUCT_METRICS,
  PRODUCT_METRIC_LABEL,
  UNCONFIRMED_METRICS,
  countMetrics,
  isProductMetricKey,
  type MetricCounts,
  type ProductMetricKey,
} from "@/lib/product-metrics";
import { addDays, budgetTotals, inRange, monthPeriod, weekStart } from "@/lib/sales-analysis";
import type { SheetSale } from "@/lib/sheet-record";

/*
 * 목표관리 (점장 전용): 매장·직원별 월 목표(지표별) 입력·이력, 목표 대비 실적, 전주·전월 비교, 직원별 예산.
 * 실적은 C열 개통일 기준, 지표는 lib/product-metrics.ts (직원 실적관리와 같은 숫자).
 * 목표 미설정은 "미설정"으로 보여 주고 0% 로 계산하지 않는다. 매장 목표와 직원 목표 합계는 따로 보여 준다.
 * 남은 근무일수·일평균 필요 건수는 가망고객관리 웹앱의 실제 근무 데이터 연동 후 표시한다 (지금은 추정하지 않음).
 */

interface Row {
  scope: GoalScope;
  staffId: string;
  name: string;
  sales: SheetSale[];
}

const STORE_ID = "";

export function GoalView() {
  useFreshSalesData();
  // 월 시트 목록 (전월 시트가 있는지 확인용)
  const { sheets } = useSalesData();
  return (
    <SalesDataGate>
      {(data) => <GoalBody key={data.sheet} sheet={data.sheet} sheets={sheets} sales={data.sales} />}
    </SalesDataGate>
  );
}

function GoalBody({ sheet, sheets, sales }: { sheet: string; sheets: string[]; sales: SheetSale[] }) {
  const today = todayInKorea();
  const month = sheetToYearMonth(sheet);
  const prevMonth = previousMonth(month);
  const prevSheet = sheetForMonth(prevMonth, today);
  const prev = useMonthSales(prevSheet && sheets.includes(prevSheet) ? prevSheet : null);
  // 다음 달 시트 (지난 달을 볼 때 월말 주가 다음 달에 걸치면 두 달을 합산)
  const nextSheet = sheetForMonth(nextMonth(month), today);
  const next = useMonthSales(nextSheet && sheets.includes(nextSheet) ? nextSheet : null);

  const [goals, setGoals] = useState<GoalItem[] | null>(null);
  const [history, setHistory] = useState<GoalHistoryItem[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const r = await fetch(`/api/goals/board?month=${month}`, { cache: "no-store" });
      const body = (await r.json()) as { ok?: boolean; goals?: GoalItem[]; history?: GoalHistoryItem[]; message?: string };
      if (body.ok && Array.isArray(body.goals)) {
        setGoals(body.goals);
        setHistory(Array.isArray(body.history) ? body.history : []);
      } else {
        setLoadError(body.message || "목표를 불러오지 못했습니다.");
      }
    } catch {
      setLoadError("서버와 통신하지 못했습니다.");
    }
  }, [month]);
  useEffect(() => {
    void load();
  }, [load]);

  // 행: 매장 + 그 달 근무 직원(목록) + 장표에 나오는 직원 (예전 직원 실적도 그대로 보임)
  const rows: Row[] = useMemo(() => {
    const names = new Set<string>(activeStaffNames(month));
    for (const s of sales) if (s.staff) names.add(s.staff);
    const staffRows = [...names]
      .sort((a, b) => a.localeCompare(b, "ko"))
      .map((name) => ({ scope: "staff" as const, staffId: staffIdForName(name) ?? "", name, sales: sales.filter((s) => s.staff === name) }));
    return [{ scope: "store", staffId: STORE_ID, name: "매장 전체", sales }, ...staffRows];
  }, [sales, month]);

  const map = useMemo(() => goalMap(goals ?? []), [goals]);
  const goalOf = (row: Row, metric: ProductMetricKey) => map.get(goalKey(row.scope, row.staffId, metric)) ?? null;
  const draftKey = (row: Row, metric: ProductMetricKey) => goalKey(row.scope, row.staffId, metric);

  function startEdit(source: Map<string, number> = map) {
    const next: Record<string, string> = {};
    for (const row of rows) {
      if (row.scope === "staff" && !row.staffId) continue;
      for (const { key } of PRODUCT_METRICS) {
        const v = source.get(draftKey(row, key));
        next[draftKey(row, key)] = v === undefined ? "" : String(v);
      }
    }
    setDraft(next);
    setEditing(true);
    setNotice(null);
  }

  async function copyPrevious() {
    try {
      const r = await fetch(`/api/goals/board?month=${prevMonth}`, { cache: "no-store" });
      const body = (await r.json()) as { ok?: boolean; goals?: GoalItem[]; message?: string };
      if (!body.ok || !Array.isArray(body.goals)) {
        setNotice({ tone: "error", text: body.message || "전월 목표를 불러오지 못했습니다." });
        return;
      }
      if (body.goals.length === 0) {
        setNotice({ tone: "error", text: `${prevMonth} 에 저장된 목표가 없습니다.` });
        return;
      }
      startEdit(goalMap(body.goals));
      setNotice({ tone: "ok", text: `${prevMonth} 목표를 입력칸에 불러왔습니다. 확인 후 저장해야 반영됩니다.` });
    } catch {
      setNotice({ tone: "error", text: "서버와 통신하지 못했습니다." });
    }
  }

  const problems: string[] = [];
  const changes: GoalChange[] = [];
  if (editing) {
    for (const row of rows) {
      if (row.scope === "staff" && !row.staffId) continue;
      for (const { key } of PRODUCT_METRICS) {
        const parsed = parseGoalInput(draft[draftKey(row, key)] ?? "");
        if (parsed === undefined) {
          problems.push(`${row.name} ${PRODUCT_METRIC_LABEL[key]}: 0 이상의 정수 또는 빈칸`);
          continue;
        }
        const before = goalOf(row, key);
        if (parsed !== before) {
          changes.push({ scope: row.scope, staffId: row.staffId, staffName: row.scope === "staff" ? row.name : "", metric: key, before, value: parsed });
        }
      }
    }
  }

  async function save() {
    if (problems.length || changes.length === 0) return;
    setSaving(true);
    setNotice(null);
    try {
      const r = await fetch("/api/goals/board", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ month, items: changes }),
      });
      const body = (await r.json()) as { ok?: boolean; goals?: GoalItem[]; message?: string };
      if (body.ok && Array.isArray(body.goals)) {
        setGoals(body.goals);
        setEditing(false);
        setNotice({ tone: "ok", text: `목표 ${changes.length}건을 저장했습니다.` });
        void load();
      } else {
        setNotice({ tone: "error", text: body.message || "목표를 저장하지 못했습니다." });
      }
    } catch {
      setNotice({ tone: "error", text: "서버와 통신하지 못했습니다. 저장되었는지 새로고침해 확인해 주세요." });
    }
    setSaving(false);
  }

  // 전주·전월 비교 (기준일: 이번 달이면 오늘, 지난 달이면 그 달 말일)
  // 주 = 월요일~일요일. 월말·월초에 걸친 주는 앞뒤 달 장표를 함께 합산한다
  const period = monthPeriod(month);
  const current = today >= period.start && today <= period.end;
  const refDay = current ? today : period.end;
  const thisWeek = weekStart(refDay);
  const thisWeekEnd = current ? today : addDays(thisWeek, 6);
  const lastWeek = addDays(thisWeek, -7);
  const pool = useMemo(() => salesAcrossMonths(prev.sales, sales, next.sales), [sales, prev.sales, next.sales]);
  const staffSum = (metric: ProductMetricKey): number | null => {
    let sum: number | null = null;
    for (const row of rows) {
      if (row.scope !== "staff") continue;
      const g = goalOf(row, metric);
      if (g !== null) sum = (sum ?? 0) + g;
    }
    return sum;
  };

  const storeCounts = countMetrics(sales);
  const storePostpaid = achievement(goalOf(rows[0], "postpaid"), storeCounts.postpaid);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <SummaryTile label={`${sheetLabel(sheet)} 개통 (판매 행)`} value={`${formatNumber(storeCounts.sales)}건`} />
        <SummaryTile label="후불 실적" value={`${formatNumber(storeCounts.postpaid)}건`} />
        <SummaryTile label="매장 후불 목표" value={storePostpaid.goal === null ? "미설정" : `${formatNumber(storePostpaid.goal)}건`} />
        <SummaryTile label="후불 달성률" value={rateText(storePostpaid.goal, storePostpaid.rate)} />
      </div>

      {loadError && <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">{loadError}</p>}
      {notice && (
        <p role={notice.tone === "error" ? "alert" : "status"} className={`rounded-lg px-3 py-2 text-sm font-semibold ${notice.tone === "error" ? "bg-rose-50 text-rose-700" : "bg-emerald-50 text-emerald-800"}`}>
          {notice.text}
        </p>
      )}

      <section aria-label="목표 대비 실적" className="overflow-x-auto rounded-xl border border-line bg-white">
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
          <h2 className="text-sm font-bold text-ink">{sheetLabel(sheet)} 목표 대비 실적</h2>
          <span className="text-xs text-ink-muted">실적 / 목표 · 달성률 · 남은 목표 (C열 개통일 기준)</span>
          <div className="ml-auto flex gap-2">
            {!editing ? (
              <>
                <button type="button" disabled={goals === null} onClick={() => startEdit()} className="rounded-lg bg-brand px-3 py-1.5 text-sm font-bold text-white disabled:opacity-50">
                  목표 입력·수정
                </button>
                <button type="button" disabled={goals === null} onClick={() => void copyPrevious()} className="rounded-lg border border-line px-3 py-1.5 text-sm font-semibold text-ink disabled:opacity-50">
                  전월 목표 불러오기
                </button>
              </>
            ) : (
              <>
                <button type="button" disabled={saving || problems.length > 0 || changes.length === 0} onClick={() => void save()} className="rounded-lg bg-brand px-3 py-1.5 text-sm font-bold text-white disabled:opacity-50">
                  {saving ? "저장 중…" : `저장 (${changes.length}건 변경)`}
                </button>
                <button type="button" disabled={saving} onClick={() => setEditing(false)} className="rounded-lg border border-line px-3 py-1.5 text-sm font-semibold text-ink">
                  취소
                </button>
              </>
            )}
          </div>
        </div>
        {editing && (
          <p className="border-b border-line bg-amber-50 px-4 py-2 text-xs text-amber-800">
            빈칸 = 미설정 (달성률 계산 안 함), 0 = 목표 0건. 매장 후불 목표는 예산관리 화면의 월 목표와 같은 값입니다.
            {problems.length > 0 && <span className="mt-1 block font-semibold text-rose-700">{problems.slice(0, 3).join(" / ")}</span>}
          </p>
        )}
        <table className="w-full min-w-[1000px] text-sm">
          <thead className="bg-zinc-50 text-xs text-ink-sub">
            <tr>
              <th scope="col" className="sticky left-0 bg-zinc-50 px-3 py-2.5 text-left font-semibold">대상</th>
              <th scope="col" className="px-3 py-2.5 text-right font-semibold">개통</th>
              <th scope="col" className="px-3 py-2.5 text-right font-semibold whitespace-nowrap" title="UMNP 는 후불 실적이 아니며 목표 대상이 아님 (직원 실적관리와 같은 기준)">
                UMNP<span className="ml-1 font-normal text-ink-muted">(후불 아님)</span>
              </th>
              {PRODUCT_METRICS.map((m) => (
                <th key={m.key} scope="col" className="px-3 py-2.5 text-right font-semibold whitespace-nowrap">
                  {m.label}
                  {UNCONFIRMED_METRICS.has(m.key) && <span className="ml-1 font-normal text-amber-700">(기준 미확정)</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line tabular-nums">
            {rows.map((row) => {
              const counts = countMetrics(row.sales);
              const noId = row.scope === "staff" && !row.staffId;
              return (
                <tr key={`${row.scope}-${row.name}`} className={row.scope === "store" ? "bg-brand-soft/30" : undefined}>
                  <th scope="row" className="sticky left-0 bg-white px-3 py-2.5 text-left font-semibold whitespace-nowrap text-ink">
                    {row.name}
                    {noId && <span className="block text-xs font-normal text-amber-700">직원 ID 없음 (목표 입력 불가)</span>}
                  </th>
                  <td className="px-3 py-2.5 text-right text-ink">{formatNumber(counts.sales)}</td>
                  <td className="px-3 py-2.5 text-right text-ink-sub">{formatNumber(counts.umnp)}</td>
                  {PRODUCT_METRICS.map(({ key }) => (
                    <td key={key} className="px-3 py-2 text-right align-top whitespace-nowrap">
                      {editing && !noId ? (
                        <input
                          aria-label={`${row.name} ${PRODUCT_METRIC_LABEL[key]} 목표`}
                          inputMode="numeric"
                          value={draft[draftKey(row, key)] ?? ""}
                          placeholder="미설정"
                          onChange={(e) => setDraft((d) => ({ ...d, [draftKey(row, key)]: e.target.value }))}
                          className="h-8 w-16 rounded border border-line px-1.5 text-right text-sm"
                        />
                      ) : (
                        <GoalCell actual={counts[key]} goal={goalOf(row, key)} />
                      )}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
          <tfoot className="border-t-2 border-line text-xs text-ink-sub tabular-nums">
            <tr>
              <th scope="row" className="sticky left-0 bg-white px-3 py-2 text-left font-semibold">직원 목표 합계 (참고)</th>
              <td />
              <td />
              {PRODUCT_METRICS.map(({ key }) => {
                const sum = staffSum(key);
                const store = goalOf(rows[0], key);
                return (
                  <td key={key} className="px-3 py-2 text-right whitespace-nowrap">
                    {sum === null ? "미설정" : `${formatNumber(sum)}건`}
                    {sum !== null && store !== null && sum !== store && <span className="block text-amber-700">매장 목표 {formatNumber(store)}와 다름</span>}
                  </td>
                );
              })}
            </tr>
          </tfoot>
        </table>
      </section>

      <CompareSection
        title={`주간 비교 (${current ? "이번 주" : "마지막 주"} ${thisWeek} ~ ${thisWeekEnd} / 그 전 주 ${lastWeek} ~ ${addDays(lastWeek, 6)})`}
        rows={rows}
        current={(r) => inRange(r.scope === "store" ? pool : pool.filter((s) => s.staff === r.name), thisWeek, thisWeekEnd)}
        previous={(r) => inRange(r.scope === "store" ? pool : pool.filter((s) => s.staff === r.name), lastWeek, addDays(lastWeek, 6))}
        note={
          (lastWeek < period.start && prev.sales === null) || (thisWeekEnd > period.end && next.sales === null && !!nextSheet && sheets.includes(nextSheet))
            ? "앞뒤 달 장표를 불러오지 못해 달에 걸친 주는 불러온 달 판매만 셉니다."
            : undefined
        }
      />
      <CompareSection
        title={`월간 비교 (${month} / 전월 ${prevMonth})`}
        rows={rows}
        current={(r) => r.sales}
        previous={(r) => (prev.sales ?? []).filter((s) => r.scope === "store" || s.staff === r.name)}
        note={
          prev.sales === null
            ? prev.loading
              ? "전월 장표를 불러오는 중입니다."
              : `전월(${prevMonth}) 장표가 없거나 불러오지 못해 전월 실적은 0 으로 보입니다.`
            : undefined
        }
      />

      <section aria-label="직원별 예산" className="overflow-x-auto rounded-xl border border-line bg-white">
        <h2 className="border-b border-line px-4 py-3 text-sm font-bold text-ink">{sheetLabel(sheet)} 직원별 예산 (직원 실적관리와 같은 기준)</h2>
        <table className="w-full min-w-[640px] text-sm tabular-nums">
          <thead className="bg-zinc-50 text-xs text-ink-sub">
            <tr>
              <th scope="col" className="px-3 py-2.5 text-left font-semibold">대상</th>
              <th scope="col" className="px-3 py-2.5 text-right font-semibold">확보 (고혜확보)</th>
              <th scope="col" className="px-3 py-2.5 text-right font-semibold">사용 (고혜사용)</th>
              <th scope="col" className="px-3 py-2.5 text-right font-semibold">현금잔여 (AB)</th>
              <th scope="col" className="px-3 py-2.5 text-right font-semibold">최종 잔여</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((row) => {
              const b = budgetTotals(row.sales);
              return (
                <tr key={`b-${row.name}`}>
                  <th scope="row" className="px-3 py-2.5 text-left font-semibold text-ink">{row.name}</th>
                  <td className="px-3 py-2.5 text-right">{formatNumber(b.secured)}원</td>
                  <td className="px-3 py-2.5 text-right">{formatNumber(b.used)}원</td>
                  <td className={`px-3 py-2.5 text-right ${b.cash < 0 ? "text-rose-600" : ""}`}>{formatNumber(b.cash)}원</td>
                  <td className={`px-3 py-2.5 text-right font-semibold ${b.remaining < 0 ? "text-rose-600" : "text-ink"}`}>{formatNumber(b.remaining)}원</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <section aria-label="목표 변경 이력" className="rounded-xl border border-line bg-white">
        <h2 className="border-b border-line px-4 py-3 text-sm font-bold text-ink">{month} 목표 변경 이력</h2>
        {history.length === 0 ? (
          <div className="p-4">
            <EmptyBox text="변경 이력이 없습니다." />
          </div>
        ) : (
          <ul className="divide-y divide-line text-sm">
            {history.map((h, i) => (
              <li key={`${h.at}-${i}`} className="flex flex-wrap gap-x-3 px-4 py-2">
                <span className="text-ink-muted tabular-nums">{h.at}</span>
                <span className="font-semibold text-ink">
                  {h.scope === "store" ? "매장" : (STAFF.find((s) => s.id === h.staffId)?.name ?? h.staffId)} ·{" "}
                  {isProductMetricKey(h.metric) ? PRODUCT_METRIC_LABEL[h.metric] : h.metric}
                </span>
                <span className="text-ink-sub">
                  {h.before === null ? "미설정" : h.before} → {h.after === null ? "미설정" : h.after}
                </span>
                <span className="text-ink-muted">{h.by}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="text-xs leading-relaxed text-ink-muted">
        지표 기준: 후불 = 신규·번이·기변 (UMNP 제외) · 번호이동 · 초스/스초 = 요금제에 &lsquo;초스&rsquo; 또는 &lsquo;스초&rsquo; · 디초/삼초 = 판매보고 &lsquo;디초/삼초 : O&rsquo; ·
        2ND = AD열 O · 제휴카드 = AE열 O · 동판 = AK열 순동·신동·약동으로 시작 · 굿바이 = 판매연결 굿바이 O (인정 기준 미확정). 지표끼리 더하지 않으며,
        개통 = 판매 행 수입니다. 실력지표제외(F열 O) 판매도 포함합니다. 남은 근무일수·일평균 필요 건수는 가망고객관리의 실제 근무 데이터를 연동한 뒤 표시합니다.
      </p>
    </div>
  );
}

function rateText(goal: number | null, rate: number | null): string {
  if (goal === null) return "미설정";
  if (rate === null) return "목표 0건";
  return `${rate}%`;
}

function GoalCell({ actual, goal }: { actual: number; goal: number | null }) {
  const a = achievement(goal, actual);
  return (
    <div className="leading-tight">
      <span className="font-semibold text-ink">{formatNumber(actual)}</span>
      <span className="text-ink-muted"> / {goal === null ? "미설정" : formatNumber(goal)}</span>
      {goal !== null && (
        <span className="block text-xs text-ink-sub">
          {rateText(a.goal, a.rate)} · 남음 {formatNumber(a.remaining ?? 0)}
        </span>
      )}
    </div>
  );
}

function CompareSection({
  title,
  rows,
  current,
  previous,
  note,
}: {
  title: string;
  rows: Row[];
  current: (r: Row) => SheetSale[];
  previous: (r: Row) => SheetSale[];
  note?: string;
}) {
  return (
    <section aria-label={title} className="overflow-x-auto rounded-xl border border-line bg-white">
      <h2 className="border-b border-line px-4 py-3 text-sm font-bold text-ink">{title}</h2>
      {note && <p className="border-b border-line bg-zinc-50 px-4 py-2 text-xs text-ink-sub">{note}</p>}
      <table className="w-full min-w-[900px] text-sm tabular-nums">
        <thead className="bg-zinc-50 text-xs text-ink-sub">
          <tr>
            <th scope="col" className="px-3 py-2.5 text-left font-semibold">대상</th>
            <th scope="col" className="px-3 py-2.5 text-right font-semibold">개통</th>
            {PRODUCT_METRICS.map((m) => (
              <th key={m.key} scope="col" className="px-3 py-2.5 text-right font-semibold whitespace-nowrap">{m.label}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((row) => {
            const c: MetricCounts = countMetrics(current(row));
            const p: MetricCounts = countMetrics(previous(row));
            return (
              <tr key={`c-${row.name}`}>
                <th scope="row" className="px-3 py-2.5 text-left font-semibold whitespace-nowrap text-ink">{row.name}</th>
                <td className="px-3 py-2.5 text-right whitespace-nowrap"><Delta current={c.sales} previous={p.sales} /></td>
                {PRODUCT_METRICS.map(({ key }) => (
                  <td key={key} className="px-3 py-2.5 text-right whitespace-nowrap"><Delta current={c[key]} previous={p[key]} /></td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

function Delta({ current, previous }: { current: number; previous: number }) {
  const diff = current - previous;
  return (
    <span>
      <span className="font-semibold text-ink">{formatNumber(current)}</span>
      <span className="text-ink-muted"> / {formatNumber(previous)}</span>
      <span className={`ml-1 text-xs ${diff > 0 ? "text-emerald-700" : diff < 0 ? "text-rose-600" : "text-ink-muted"}`}>
        {diff > 0 ? `+${diff}` : diff}
      </span>
    </span>
  );
}
