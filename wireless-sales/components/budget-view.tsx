"use client";

import { useEffect, useState } from "react";
import { useFreshSalesData } from "@/components/sales-data-provider";
import {
  SalesDataGate,
  sheetLabel,
  sheetToYearMonth,
} from "@/components/sales-data-status";
import { BUDGET_COLUMNS, calculateBudget } from "@/lib/budget";
import { formatNumber } from "@/lib/format";
import type { SheetSale } from "@/lib/sheet-record";
import { postpaidCount } from "@/lib/umnp";
import { wMismatches, wonText } from "@/lib/w-split";
import { formatCtn } from "@/lib/format";
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

function BudgetBody({ sheet, sales }: { sheet: string; sales: SheetSale[] }) {
  const b = calculateBudget(sales);
  return (
    <div className="space-y-6">
      <section
        aria-label="총 매장 예산"
        className="rounded-2xl border border-brand/30 bg-white p-6 ring-1 ring-brand/10"
      >
        <p className="text-sm font-semibold text-brand">
          {sheetLabel(sheet)} 총 매장 예산
        </p>
        <p className="mt-2 text-brand">
          <Money value={b.total} big />
        </p>
        <p className="mt-2 text-xs text-ink-muted">
          고객혜택 잔여금액 + 스팟예산 + 현금예산
        </p>
      </section>

      <section
        aria-label="예산 내역"
        className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
      >
        {[
          [
            "고객혜택 확보금액",
            b.benefitSecured,
            `${BUDGET_COLUMNS.benefitSecured}열 합계`,
          ],
          [
            "고객혜택 사용금액",
            b.benefitUsed,
            `${BUDGET_COLUMNS.benefitUsed}열 합계`,
          ],
          ["고객혜택 잔여금액", b.benefitRemaining, "확보금액 − 사용금액"],
          ["스팟예산", b.spot, `${BUDGET_COLUMNS.spot}열(SPOT정책) 합계`],
          ["현금예산", b.cash, `${BUDGET_COLUMNS.cash}열(중고판매 잔여) 합계`],
        ].map(([label, value, hint]) => (
          <div
            key={label as string}
            className="rounded-xl border border-line bg-white p-5"
          >
            <p className="text-sm font-medium text-ink-sub">
              {label as string}
            </p>
            <p className="mt-1.5">
              <Money value={value as number} />
            </p>
            <p className="mt-1.5 text-xs text-ink-muted">{hint as string}</p>
          </div>
        ))}
      </section>

      <WMismatchSection sales={sales} />

      {/* 현재 실적 = 후불 실적 건수 (UMNP 제외). 위 예산 금액은 UMNP 포함 */}
      <GoalSection sheet={sheet} achieved={postpaidCount(sales)} />
    </div>
  );
}

/**
 * W열(추가지원금 + 고혜(기존할부금) 합계)과 웹앱 세부 합계가 다른 판매 (구글시트에서 W열을 직접 고친 경우 등).
 * 예산 사용금액은 장표 W열(U열 수식) 기준 그대로이며, 여기서는 확인만 한다 (자동으로 고치지 않음).
 */
function WMismatchSection({ sales }: { sales: SheetSale[] }) {
  const list = wMismatches(sales);
  if (list.length === 0) return null;
  return (
    <section
      aria-label="W열 세부 불일치"
      className="overflow-x-auto rounded-xl border border-amber-300 bg-white"
    >
      <p className="border-b border-amber-200 bg-amber-50/60 px-4 py-3 text-sm font-bold text-amber-900">
        ⚠ W열(추가지원금+고혜(기존할부금)) 세부 불일치 {list.length}건
        <span className="mt-0.5 block text-xs font-normal text-amber-800">
          예산 금액은 장표 W열 값 기준입니다. 검수관리 → 판매 수정에서 두 금액을 확인해 주세요. (자동으로 고치지 않음)
        </span>
      </p>
      <table className="w-full min-w-[520px] text-sm">
        <thead className="bg-zinc-50 text-xs text-ink-sub">
          <tr>
            {["개통일", "고객명", "CTN", "W열", "웹앱 세부 합계"].map((h) => (
              <th key={h} className="px-3 py-2 text-left font-semibold">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line tabular-nums text-ink">
          {list.map(({ sale, split }) => (
            <tr key={sale.row}>
              <td className="px-3 py-2 whitespace-nowrap">{monthDayText(sale.activatedAt)}</td>
              <td className="px-3 py-2 whitespace-nowrap">{sale.customer || "-"}</td>
              <td className="px-3 py-2 whitespace-nowrap">{formatCtn(sale.ctn) || "-"}</td>
              <td className="px-3 py-2 whitespace-nowrap">{wonText(split.w)}</td>
              <td className="px-3 py-2 whitespace-nowrap">
                {wonText(split.detailSum ?? 0)}
                <span className="ml-1 text-xs text-ink-muted">
                  (추가 {wonText(split.extra ?? 0)} + 할부 {wonText(split.installment ?? 0)})
                </span>
              </td>
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
