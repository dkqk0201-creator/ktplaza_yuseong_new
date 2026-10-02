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

      <GoalSection sheet={sheet} achieved={sales.length} />
    </div>
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
        판매 행 수
      </p>
    </section>
  );
}
