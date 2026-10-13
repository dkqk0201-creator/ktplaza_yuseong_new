"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { GobulbiPanel, type GobulbiLoad } from "@/components/gobulbi-panel";
import { SaleDetail } from "@/components/sale-detail";
import { useFreshSalesData, useSalesData } from "@/components/sales-data-provider";
import {
  SalesDataGate,
  sheetLabel,
  sheetToYearMonth,
} from "@/components/sales-data-status";
import {
  BUDGET_COLUMNS,
  budgetUsageRows,
  calculateBudget,
  type UsageKind,
  type UsageRow,
} from "@/lib/budget";
import { Notice } from "@/components/work-ui";
import { formatNumber } from "@/lib/format";
import type { SheetSale } from "@/lib/sheet-record";
import { isUmnpSale, postpaidCount } from "@/lib/umnp";
import { oldWRuleSuspects, vMismatches, wonText } from "@/lib/v-split";
import { formatCtn, todayInKorea } from "@/lib/format";
import { applyGobulbi, checkAgainstSheetAc, isCurrentMonth } from "@/lib/gobulbi";
import { fetchGobulbi } from "@/lib/gobulbi-api";
import { monthDayText } from "@/lib/sale-display";

/* 예산관리 + 무선 목표 (선택한 월 시트의 실제 장표 데이터 기준) */

export function BudgetView() {
  useFreshSalesData();
  return (
    <SalesDataGate>
      {(data) => <BudgetBody sheet={data.sheet} sales={data.sales} />}
    </SalesDataGate>
  );
}

function Money({ value, big = false }: { value: number; big?: boolean }) {
  return (
    <span
      className={`font-bold tabular-nums ${big ? "text-4xl sm:text-5xl" : "text-2xl"} ${
        value < 0 ? "text-rose-600" : ""
      }`}
    >
      {formatNumber(value)}
      <span
        className={`ml-0.5 font-semibold text-ink-sub ${big ? "text-xl" : "text-base"}`}
      >
        원
      </span>
    </span>
  );
}

interface BudgetCard {
  label: string;
  value: number;
  hint: string;
  /** 있으면 눌러서 내역을 펼치는 카드 (고객별 사용내역 / 고불비사용 내역) */
  kind?: Panel;
  /** 금액 옆 경고 (예: 고불비사용 미반영) */
  warn?: string;
}

type Panel = UsageKind | "gobulbi";

/** 선택한 월의 고불비사용 불러오기 (월이 바뀌면 이전 응답은 버림) */
function useGobulbi(month: string) {
  const [load, setLoad] = useState<GobulbiLoad>({ status: "loading" });
  const seq = useRef(0);
  const reload = useCallback(async () => {
    const my = ++seq.current;
    setLoad({ status: "loading" });
    const res = await fetchGobulbi(month);
    if (my !== seq.current) return;
    if (res.ok && res.data && res.data.month === month) setLoad({ status: "ok", data: res.data });
    else
      setLoad({
        status: "error",
        message: res.ok ? "고불비사용 응답을 확인하지 못했습니다." : res.message,
        notDeployed: !res.ok && res.notDeployed === true,
      });
  }, [month]);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { load, reload };
}

function BudgetBody({ sheet, sales }: { sheet: string; sales: SheetSale[] }) {
  const { invalidate } = useSalesData();
  const b = calculateBudget(sales);
  // 펼친 카드 (한 번에 하나: 같은 카드를 다시 누르면 닫힘, 다른 카드를 누르면 그 목록으로 바뀜)
  const [usage, setUsage] = useState<Panel | null>(null);
  const [detailRow, setDetailRow] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const usageRows = usage && usage !== "gobulbi" ? budgetUsageRows(sales, usage) : [];
  // 고불비사용 (별도 시트, 지급일 기준): 현금예산에서 한 번만 차감
  const month = sheetToYearMonth(sheet);
  const { load: gobulbi, reload: reloadGobulbi } = useGobulbi(month);
  const applied = gobulbi.status === "ok" ? applyGobulbi(b, gobulbi.data.total) : null;
  // 장표 AC열(최종 남은 예산) 합계 = AC8. 웹앱 총 매장 예산과의 차이는 고불비사용 합계와 같아야 한다
  const acTotal = sales.reduce((t, s) => t + (s.finalTotal ?? 0), 0);
  const acCheck = applied ? checkAgainstSheetAc(acTotal, applied) : null;
  const gobulbiWarn =
    gobulbi.status === "loading"
      ? "고불비사용 확인 중 (아직 차감 전)"
      : gobulbi.status === "error"
        ? "고불비사용 미반영 (불러오기 실패)"
        : undefined;
  const detail = detailRow === null ? null : sales.find((s) => s.row === detailRow) ?? null;
  const cards: BudgetCard[] = [
    {
      label: "고객혜택 확보금액",
      value: b.benefitSecured,
      hint: `${BUDGET_COLUMNS.benefitSecured}열 합계`,
    },
    {
      label: "고객혜택 사용금액",
      value: b.customerBenefitUsed,
      hint: `${BUDGET_COLUMNS.customerBenefitUsed}열 합계 · 누르면 고객별 내역`,
      kind: "customerBenefit",
    },
    {
      label: "추가지원금 사용금액",
      value: b.extraSupportUsed,
      hint: `${BUDGET_COLUMNS.extraSupportUsed}열 합계 · 누르면 고객별 내역`,
      kind: "extraSupport",
    },
    {
      label: "고객혜택 잔여금액",
      value: b.benefitRemaining,
      hint: "확보금액 − 고객혜택 사용금액 − 추가지원금 사용금액",
    },
    { label: "스팟예산", value: b.spot, hint: `${BUDGET_COLUMNS.spot}열(SPOT정책) 합계` },
    {
      label: "기존 현금예산",
      value: b.cash,
      hint: `${BUDGET_COLUMNS.cash}열(중고판매 잔여) 합계 · 고불비사용 차감 전`,
    },
    {
      label: "고불비사용",
      value: applied ? applied.gobulbi : 0,
      hint:
        gobulbi.status === "ok"
          ? `${month.slice(5).replace(/^0/, "")}월 지급일 기준 ${gobulbi.data.items.length}건 합계 · 누르면 사용내역`
          : "누르면 사용내역",
      kind: "gobulbi",
      warn: gobulbiWarn,
    },
    {
      label: "현금예산 (고불비 차감 후)",
      value: applied ? applied.cash : b.cash,
      hint: `${BUDGET_COLUMNS.cash}열 합계 − 고불비사용`,
      warn: gobulbiWarn,
    },
  ];
  return (
    <div className="space-y-6">
      {notice && <Notice message={notice} onClose={() => setNotice(null)} />}
      <section
        aria-label="총 매장 예산"
        className="rounded-2xl border border-brand/30 bg-white p-6 ring-1 ring-brand/10"
      >
        <p className="text-sm font-semibold text-brand">
          {sheetLabel(sheet)} 총 매장 예산
        </p>
        <p className="mt-2 text-brand">
          <Money value={applied ? applied.total : b.total} big />
        </p>
        <p className="mt-2 text-xs text-ink-muted">
          고객혜택 잔여금액 + 스팟예산 + 현금예산(고불비 차감 후) · 고불비사용은 현금예산에서 한 번만 차감
        </p>
        {gobulbiWarn && (
          <p role="status" className="mt-2 text-xs font-semibold text-amber-700">
            ⚠ {gobulbiWarn}
            {gobulbi.status === "error" && <> — {gobulbi.message}</>}
          </p>
        )}
        {acCheck && (
          <p
            className={`mt-2 text-xs tabular-nums ${acCheck.ok ? "text-ink-sub" : "font-semibold text-rose-600"}`}
          >
            장표 AC열 합계 {formatNumber(acTotal)}원 − 고불비사용 {formatNumber(applied!.gobulbi)}원 ={" "}
            {formatNumber(acCheck.expected)}원 {acCheck.ok ? "✓ 일치" : `≠ 총 매장 예산 (차이 ${formatNumber(acCheck.expected - applied!.total)}원, 장표 AC열 수식 확인 필요)`}
          </p>
        )}
      </section>

      <section
        aria-label="예산 내역"
        className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4"
      >
        {cards.map((card) => {
          const body = (
            <>
              <p className="flex items-center justify-between gap-2 text-sm font-medium text-ink-sub">
                {card.label}
                {card.kind && (
                  <span
                    aria-hidden
                    className={`text-xs font-semibold ${usage === card.kind ? "text-brand" : "text-ink-muted"}`}
                  >
                    {card.kind === "gobulbi"
                      ? usage === card.kind
                        ? "내역 닫기 ▲"
                        : "사용내역 ▼"
                      : usage === card.kind
                        ? "고객 목록 닫기 ▲"
                        : "고객 목록 ▼"}
                  </span>
                )}
              </p>
              <p className="mt-1.5">
                <Money value={card.value} />
              </p>
              <p className="mt-1.5 text-xs text-ink-muted">{card.hint}</p>
              {card.warn && (
                <p className="mt-1 text-xs font-semibold text-amber-700">⚠ {card.warn}</p>
              )}
            </>
          );
          if (!card.kind) {
            return (
              <div key={card.label} className="rounded-xl border border-line bg-white p-5">
                {body}
              </div>
            );
          }
          const kind = card.kind;
          const active = usage === kind;
          return (
            <button
              key={card.label}
              type="button"
              onClick={() => setUsage((cur) => (cur === kind ? null : kind))}
              aria-expanded={active}
              aria-controls="budget-usage-list"
              className={`rounded-xl border bg-white p-5 text-left transition hover:border-brand/50 hover:bg-brand-soft/20 focus-visible:outline-2 focus-visible:outline-brand ${
                active ? "border-brand ring-1 ring-brand/30 bg-brand-soft/30" : "border-line"
              }`}
            >
              {body}
            </button>
          );
        })}
      </section>

      {usage === "gobulbi" && (
        <GobulbiPanel
          month={month}
          monthLabel={sheetLabel(sheet)}
          isCurrentMonth={isCurrentMonth(month, todayInKorea())}
          load={gobulbi}
          onChanged={(message) => {
            setNotice(message);
            void reloadGobulbi();
          }}
          onClose={() => setUsage(null)}
          onRetry={() => void reloadGobulbi()}
        />
      )}

      {usage && usage !== "gobulbi" && (
        <UsageList
          kind={usage}
          rows={usageRows}
          cardTotal={usage === "customerBenefit" ? b.customerBenefitUsed : b.extraSupportUsed}
          onClose={() => setUsage(null)}
          onOpen={setDetailRow}
        />
      )}

      {detail && (
        <SaleDetail
          sheet={sheet}
          sale={detail}
          onClose={() => setDetailRow(null)}
          onDeleted={(message) => {
            setDetailRow(null);
            setNotice(message);
            void invalidate();
          }}
          onUpdated={(message) => {
            setNotice(message);
            void invalidate();
          }}
        />
      )}

      <UsedCheckSection sales={sales} />

      {/* 현재 실적 = 후불 실적 건수 (UMNP 제외). 위 예산 금액은 UMNP 포함 */}
      <GoalSection sheet={sheet} achieved={postpaidCount(sales)} />
    </div>
  );
}

/**
 * 고객혜택 사용금액 확인 (예산 금액은 장표 U열 = SUM(V:Y) 기준 그대로, 여기서는 확인만 — 자동으로 고치지 않음)
 *  1) V열(고혜(요금)+고혜(기존할부금) 합계)과 웹앱 세부 합계가 다른 판매 (구글시트에서 V열을 직접 고친 경우 등)
 *  2) 이전에 잘못 적용했던 규칙(W열에 고혜(기존할부금) 합산)으로 입력된 금액이 현재 W열에 그대로 남아 있는 판매
 *     (과거 웹앱참고 기록만 남고 W열은 이미 바로잡은 판매는 표시하지 않음 — oldWRuleSuspect 기준)
 */
function UsedCheckSection({ sales }: { sales: SheetSale[] }) {
  const mismatches = vMismatches(sales);
  const suspects = oldWRuleSuspects(sales);
  if (mismatches.length === 0 && suspects.length === 0) return null;
  const rows: { key: string; sale: SheetSale; kind: string; detail: string }[] = [
    ...mismatches.map(({ sale, split }) => ({
      key: `v${sale.row}`,
      sale,
      kind: "V열 세부 불일치",
      detail: `V열 ${wonText(split.v)} ≠ 세부 합계 ${wonText(split.detailSum ?? 0)} (고혜(요금) ${wonText(split.plan ?? 0)} + 고혜(기존할부금) ${wonText(split.installment ?? 0)})`,
    })),
    ...suspects.map(({ sale, suspect }) => ({
      key: `w${sale.row}`,
      sale,
      kind: "이전 규칙 의심 (W열 합산)",
      detail: `W열 ${wonText(suspect.w)} = 이전 규칙 합계 그대로 (추가지원금 ${wonText(suspect.extra ?? 0)} + 고혜(기존할부금) ${wonText(suspect.installment)}) · V열 ${wonText(sale.usedModelPlan ?? 0)}`,
    })),
  ];
  return (
    <section
      aria-label="고객혜택 사용금액 확인"
      className="overflow-x-auto rounded-xl border border-amber-300 bg-white"
    >
      <p className="border-b border-amber-200 bg-amber-50/60 px-4 py-3 text-sm font-bold text-amber-900">
        ⚠ 고객혜택 사용금액 확인 필요 {rows.length}건
        <span className="mt-0.5 block text-xs font-normal text-amber-800">
          예산 금액은 장표 V·W열(U열 합계) 기준입니다. 검수관리 → 판매 상세 → 판매 수정에서 확인 후 직접 고쳐 주세요.
          (자동으로 옮기거나 고치지 않음 · 규칙: V열 = 고혜(요금)+고혜(기존할부금), W열 = 추가지원금)
        </span>
      </p>
      <table className="w-full min-w-[640px] text-sm">
        <thead className="bg-zinc-50 text-xs text-ink-sub">
          <tr>
            {["행", "개통일", "고객명", "CTN", "구분", "내용"].map((h) => (
              <th key={h} className="px-3 py-2 text-left font-semibold">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line tabular-nums text-ink">
          {rows.map(({ key, sale, kind, detail }) => (
            <tr key={key} className="align-top">
              <td className="px-3 py-2 whitespace-nowrap text-ink-muted">{sale.row}행</td>
              <td className="px-3 py-2 whitespace-nowrap">{monthDayText(sale.activatedAt)}</td>
              <td className="px-3 py-2 whitespace-nowrap">{sale.customer || "-"}</td>
              <td className="px-3 py-2 whitespace-nowrap">{formatCtn(sale.ctn) || "-"}</td>
              <td className="px-3 py-2 whitespace-nowrap font-semibold text-rose-600">{kind}</td>
              <td className="px-3 py-2 text-xs">{detail}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function GoalSection({ sheet, achieved }: { sheet: string; achieved: number }) {
  const month = sheetToYearMonth(sheet);
  // 월이 바뀌면 key 로 새로 그려 다른 달의 목표와 섞이지 않게 한다
  return (
    <GoalEditor
      key={month}
      month={month}
      label={sheetLabel(sheet)}
      achieved={achieved}
    />
  );
}

function GoalEditor({
  month,
  label,
  achieved,
}: {
  month: string;
  label: string;
  achieved: number;
}) {
  const [goal, setGoal] = useState<number | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [input, setInput] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/goals?month=${month}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((body) => {
        if (cancelled) return;
        if (body?.ok) setGoal(body.goal ?? null);
        else setError(body?.message || "목표를 불러오지 못했습니다.");
      })
      .catch(() => !cancelled && setError("목표를 불러오지 못했습니다."))
      .finally(() => !cancelled && setLoaded(true));
    return () => {
      cancelled = true;
    };
  }, [month]);

  async function save() {
    const value = Number(input.replace(/[^\d]/g, ""));
    if (!input.trim() || !Number.isInteger(value)) {
      setError("목표 건수를 숫자로 입력해 주세요.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/goals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ month, goal: value }),
      });
      const body = await response.json();
      if (body?.ok) {
        setGoal(body.goal);
        setEditing(false);
      } else {
        setError(body?.message || "목표를 저장하지 못했습니다.");
      }
    } catch {
      setError("목표를 저장하지 못했습니다.");
    }
    setSaving(false);
  }

  const remaining = goal === null ? null : goal - achieved;

  return (
    <section
      aria-label="무선 목표"
      className="rounded-xl border border-line bg-white p-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-bold text-ink">{label} 무선 목표</h2>
        {!editing && (
          <button
            type="button"
            onClick={() => {
              setInput(goal === null ? "" : String(goal));
              setEditing(true);
              setError(null);
            }}
            disabled={!loaded}
            className="h-9 rounded-lg border border-line px-3 text-sm font-semibold text-ink-sub hover:bg-zinc-50 disabled:opacity-60"
          >
            {goal === null ? "목표 입력" : "목표 수정"}
          </button>
        )}
      </div>

      {editing && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <label
            htmlFor="goal-input"
            className="text-sm font-medium text-ink-sub"
          >
            총 무선 목표
          </label>
          <input
            id="goal-input"
            inputMode="numeric"
            value={input}
            onChange={(e) =>
              setInput(e.target.value.replace(/[^\d]/g, "").slice(0, 6))
            }
            className="h-10 w-28 rounded-lg border border-line px-3 text-right text-base tabular-nums outline-none focus:border-brand"
            placeholder="85"
          />
          <span className="text-sm text-ink-sub">건</span>
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="h-10 rounded-lg bg-brand px-4 text-sm font-semibold text-white disabled:opacity-60"
          >
            {saving ? "저장 중..." : "저장"}
          </button>
          <button
            type="button"
            onClick={() => setEditing(false)}
            disabled={saving}
            className="h-10 rounded-lg border border-line px-3 text-sm font-semibold text-ink-sub"
          >
            취소
          </button>
        </div>
      )}

      {error && (
        <p
          role="alert"
          className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700"
        >
          ⚠ {error}
        </p>
      )}

      <div className="mt-4 grid grid-cols-3 gap-3">
        {[
          [
            "총 무선 목표",
            goal === null
              ? loaded
                ? "미입력"
                : "…"
              : `${formatNumber(goal)}건`,
          ],
          ["현재 실적", `${formatNumber(achieved)}건`],
          [
            "잔여 목표",
            remaining === null ? "-" : `${formatNumber(remaining)}건`,
          ],
        ].map(([title, value]) => (
          <div key={title} className="rounded-lg bg-zinc-50 px-3 py-3">
            <p className="text-xs text-ink-muted">{title}</p>
            <p
              className={`mt-1 text-xl font-bold tabular-nums ${
                title === "잔여 목표" && remaining !== null && remaining <= 0
                  ? "text-emerald-700"
                  : "text-ink"
              }`}
            >
              {value}
            </p>
          </div>
        ))}
      </div>
      <p className="mt-2 text-xs text-ink-muted">
        현재 실적 = 선택한 월 시트에서 개통일·고객·CTN 중 하나라도 입력된 실제
        판매 행 수 (개통구분 UMNP 는 후불 실적이 아니므로 제외 — 예산 금액에는
        포함)
      </p>
    </section>
  );
}

const USAGE_TITLE: Record<UsageKind, string> = {
  customerBenefit: "고객혜택 사용금액",
  extraSupport: "추가지원금 사용금액",
};

function UsageWon({ value, strong = false }: { value: number; strong?: boolean }) {
  return (
    <span className={`${strong ? "font-semibold" : ""} ${value < 0 ? "text-rose-600" : ""}`}>
      {formatNumber(value)}
      <span className="ml-0.5 text-xs font-normal text-ink-muted">원</span>
    </span>
  );
}

/** 예산관리 카드 → 고객별 사용내역 (금액 0원 제외, 합계 = 카드 금액) */
function UsageList({
  kind,
  rows,
  cardTotal,
  onClose,
  onOpen,
}: {
  kind: UsageKind;
  rows: UsageRow[];
  cardTotal: number;
  onClose: () => void;
  onOpen: (row: number) => void;
}) {
  const total = rows.reduce((t, r) => t + r.amount, 0);
  const ref = useRef<HTMLElement>(null);
  // 카드를 누르면 목록이 화면에 보이도록 (모바일에서는 카드 아래 멀리 열리므로). 이미 보이면 움직이지 않음
  useEffect(() => {
    ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [kind]);
  const showParts = kind === "customerBenefit";
  const partCols = showParts ? (rows[0]?.parts ?? []) : [];
  const totals = partCols.map((_, i) => rows.reduce((t, r) => t + r.parts[i].amount, 0));
  const title = USAGE_TITLE[kind];
  const formula = kind === "customerBenefit" ? "V+X+Y" : "W";
  return (
    <section
      id="budget-usage-list"
      ref={ref}
      tabIndex={-1}
      aria-label={`${title} 고객별 내역`}
      className="overflow-hidden rounded-xl border border-brand/30 bg-white"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line bg-brand-soft/30 px-4 py-3">
        <h3 className="text-sm font-bold text-ink">
          {title} 고객별 내역 · {formatNumber(rows.length)}건
        </h3>
        <span className="text-xs text-ink-muted">{formula}열 · 0원 제외 · 고객을 누르면 판매 상세</span>
        <button
          type="button"
          onClick={onClose}
          className="ml-auto text-xs font-medium text-ink-sub underline underline-offset-2"
        >
          닫기
        </button>
      </div>

      {rows.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-ink-sub">사용금액이 있는 판매가 없습니다.</p>
      ) : (
        <>
          {/* PC·태블릿: 표 */}
          <div className="hidden overflow-x-auto sm:block">
            <table className="w-full min-w-[560px] text-sm">
              <thead className="bg-zinc-50 text-xs text-ink-sub">
                <tr>
                  <th scope="col" className="px-3 py-2.5 text-left font-semibold">개통일</th>
                  <th scope="col" className="px-3 py-2.5 text-left font-semibold">고객명</th>
                  <th scope="col" className="px-3 py-2.5 text-left font-semibold">CTN</th>
                  {partCols.map((p) => (
                    <th key={p.column} scope="col" className="px-3 py-2.5 text-right font-semibold">
                      {p.column} {p.label}
                    </th>
                  ))}
                  <th scope="col" className="px-3 py-2.5 text-right font-semibold">
                    {title} ({formula})
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line tabular-nums text-ink">
                {rows.map((r) => (
                  <tr
                    key={r.sale.row}
                    onClick={() => onOpen(r.sale.row)}
                    className="cursor-pointer hover:bg-zinc-50"
                  >
                    <td className="px-3 py-2.5 whitespace-nowrap">{monthDayText(r.sale.activatedAt) || "-"}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpen(r.sale.row);
                        }}
                        className="font-semibold text-ink underline-offset-2 hover:underline"
                      >
                        {r.sale.customer || "(고객명 없음)"}
                      </button>
                      {isUmnpSale(r.sale) && (
                        <span className="ml-1.5 rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-semibold text-amber-800">
                          UMNP
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap">{formatCtn(r.sale.ctn) || "-"}</td>
                    {r.parts.slice(0, partCols.length).map((p) => (
                      <td key={p.column} className="px-3 py-2.5 text-right whitespace-nowrap text-ink-sub">
                        {p.amount === 0 ? "-" : <UsageWon value={p.amount} />}
                      </td>
                    ))}
                    <td className="px-3 py-2.5 text-right whitespace-nowrap">
                      <UsageWon value={r.amount} strong />
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t-2 border-line bg-brand-soft/40 tabular-nums">
                <tr>
                  <th scope="row" colSpan={3} className="px-3 py-2.5 text-left font-bold text-ink">
                    전체 합계 ({formatNumber(rows.length)}건)
                  </th>
                  {totals.map((t, i) => (
                    <td key={partCols[i].column} className="px-3 py-2.5 text-right whitespace-nowrap font-semibold">
                      <UsageWon value={t} />
                    </td>
                  ))}
                  <td className="px-3 py-2.5 text-right whitespace-nowrap font-bold">
                    <UsageWon value={total} strong />
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* 모바일: 고객별 카드 목록 */}
          <ul className="divide-y divide-line sm:hidden">
            {rows.map((r) => (
              <li key={r.sale.row}>
                <button
                  type="button"
                  onClick={() => onOpen(r.sale.row)}
                  className="block w-full px-4 py-3 text-left tabular-nums hover:bg-zinc-50"
                >
                  <span className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0">
                      <span className="font-semibold text-ink">{r.sale.customer || "(고객명 없음)"}</span>
                      {isUmnpSale(r.sale) && (
                        <span className="ml-1.5 rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-semibold text-amber-800">
                          UMNP
                        </span>
                      )}
                    </span>
                    <span className="shrink-0 text-ink">
                      <UsageWon value={r.amount} strong />
                    </span>
                  </span>
                  <span className="mt-0.5 block text-xs text-ink-sub">
                    {monthDayText(r.sale.activatedAt) || "-"} · {formatCtn(r.sale.ctn) || "-"}
                  </span>
                  {showParts && (
                    <span className="mt-1 block text-xs text-ink-muted">
                      {r.parts.map((p) => `${p.column} ${formatNumber(p.amount)}`).join(" · ")}
                    </span>
                  )}
                </button>
              </li>
            ))}
            <li className="flex items-baseline justify-between bg-brand-soft/40 px-4 py-3 tabular-nums">
              <span className="text-sm font-bold text-ink">전체 합계 ({formatNumber(rows.length)}건)</span>
              <span className="font-bold text-ink">
                <UsageWon value={total} strong />
              </span>
            </li>
            {showParts && (
              <li className="bg-brand-soft/20 px-4 pb-3 text-xs text-ink-muted tabular-nums">
                {partCols.map((p, i) => `${p.column} ${formatNumber(totals[i])}`).join(" · ")}
              </li>
            )}
          </ul>
        </>
      )}

      {total !== cardTotal && (
        <p role="alert" className="border-t border-rose-200 bg-rose-50 px-4 py-2 text-xs font-semibold text-rose-700">
          목록 합계 {formatNumber(total)}원이 카드 금액 {formatNumber(cardTotal)}원과 다릅니다. 새로고침해 주세요.
        </p>
      )}
    </section>
  );
}
