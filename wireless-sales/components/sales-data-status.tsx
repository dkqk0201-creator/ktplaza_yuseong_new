"use client";

import { useEffect, useState } from "react";
import { useSalesData } from "@/components/sales-data-provider";
import { todayInKorea } from "@/lib/format";

/* 판매 데이터 상태 표시: 월 선택 / 처음 불러오는 중 / 불러오기 실패 / 조회 시각·새로고침 */

function agoText(fetchedAt: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - fetchedAt) / 1000));
  if (seconds < 10) return "방금 조회";
  if (seconds < 60) return `${seconds}초 전 조회`;
  return `${Math.floor(seconds / 60)}분 전 조회`;
}

/** "10월" → 연도를 붙인 "2026-10" (이번 달보다 뒤의 월은 작년으로 본다) */
export function sheetToYearMonth(sheet: string): string {
  const today = todayInKorea();
  const year = Number(today.slice(0, 4));
  const thisMonth = Number(today.slice(5, 7));
  const month = Number(sheet.replace("월", ""));
  const y = month > thisMonth ? year - 1 : year;
  return `${y}-${String(month).padStart(2, "0")}`;
}

export function sheetLabel(sheet: string): string {
  const [y, m] = sheetToYearMonth(sheet).split("-");
  return `${y}년 ${Number(m)}월`;
}

/** 월 선택 + 조회 시각 + 새로고침 */
export function SalesDataBar() {
  const {
    data,
    fetchedAt,
    loading,
    error,
    refresh,
    sheets,
    selectedSheet,
    selectSheet,
  } = useSalesData();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(timer);
  }, []);

  const options = [
    ...new Set([...sheets, ...(selectedSheet ? [selectedSheet] : [])]),
  ].sort((a, b) => sheetToYearMonth(a).localeCompare(sheetToYearMonth(b)));

  return (
    <div className="mb-4 space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-xs text-ink-muted">
        {options.length > 0 ? (
          <label className="flex items-center gap-1.5">
            <span className="sr-only">월 선택</span>
            <select
              value={selectedSheet ?? ""}
              onChange={(e) => selectSheet(e.target.value)}
              aria-label="월 선택"
              className="h-9 rounded-lg border border-line bg-white px-2.5 text-sm font-semibold text-ink"
            >
              {selectedSheet === null && <option value="">이번 달</option>}
              {options.map((sheet) => (
                <option key={sheet} value={sheet}>
                  {sheetLabel(sheet)}
                </option>
              ))}
            </select>
          </label>
        ) : (
          data && (
            <span className="text-sm font-semibold text-ink">
              {sheetLabel(data.sheet)}
            </span>
          )
        )}
        <span>
          {loading
            ? "최신 데이터 확인 중..."
            : fetchedAt
              ? agoText(fetchedAt, now)
              : ""}
        </span>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={loading}
          className="h-9 rounded-lg border border-line bg-white px-3 text-sm font-semibold text-ink-sub hover:bg-zinc-50 disabled:opacity-60"
        >
          새로고침
        </button>
      </div>
      {error && data && (
        <p
          role="alert"
          className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700"
        >
          ⚠ 최신 데이터를 불러오지 못해 이전에 조회한 내용을 보여주고 있습니다.
          ({error})
        </p>
      )}
    </div>
  );
}

/** 데이터가 아직 없을 때의 로딩 화면 */
export function SalesDataLoading() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex flex-col items-center justify-center gap-3 rounded-xl border border-line bg-white px-6 py-16 text-sm text-ink-sub"
    >
      <span
        aria-hidden
        className="h-6 w-6 animate-spin rounded-full border-2 border-zinc-200 border-t-brand"
      />
      판매 데이터를 불러오는 중...
    </div>
  );
}

/** 데이터가 없고 불러오기에 실패했을 때 */
export function SalesDataError({ message }: { message: string }) {
  const { refresh, loading } = useSalesData();
  return (
    <div
      role="alert"
      className="rounded-xl border border-rose-200 bg-rose-50 px-5 py-6 text-center"
    >
      <p className="font-semibold text-rose-700">⚠ {message}</p>
      <button
        type="button"
        onClick={() => void refresh()}
        disabled={loading}
        className="mt-3 text-sm font-semibold text-rose-700 underline underline-offset-2 disabled:opacity-60"
      >
        {loading ? "불러오는 중..." : "다시 불러오기"}
      </button>
    </div>
  );
}

/**
 * 공통 화면 틀: 월 선택 바 + (데이터가 없으면) 로딩/오류.
 * children 은 데이터가 있을 때만 그린다.
 */
export function SalesDataGate({
  children,
}: {
  children: (
    data: NonNullable<ReturnType<typeof useSalesData>["data"]>,
  ) => React.ReactNode;
}) {
  const { data, error, loading } = useSalesData();
  return (
    <>
      <SalesDataBar />
      {data ? (
        children(data)
      ) : error && !loading ? (
        <SalesDataError message={error} />
      ) : (
        <SalesDataLoading />
      )}
    </>
  );
}
