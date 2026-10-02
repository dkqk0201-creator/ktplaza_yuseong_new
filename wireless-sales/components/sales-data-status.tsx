"use client";

import { useEffect, useState } from "react";
import { useSalesData } from "@/components/sales-data-provider";

/* 판매 데이터 상태 표시: 처음 불러오는 중 / 불러오기 실패 / 조회 시각·새로고침 */

function agoText(fetchedAt: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - fetchedAt) / 1000));
  if (seconds < 10) return "방금 조회";
  if (seconds < 60) return `${seconds}초 전 조회`;
  return `${Math.floor(seconds / 60)}분 전 조회`;
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

/** 데이터가 있을 때 위쪽에 표시: "10월 시트 · 12초 전 조회 · 새로고침" */
export function SalesDataBar() {
  const { data, fetchedAt, loading, error, refresh } = useSalesData();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(timer);
  }, []);

  if (!data) return null;
  return (
    <div className="mb-4 space-y-2">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-muted">
        <span className="font-semibold text-ink-sub">{data.sheet} 시트</span>
        <span aria-hidden>·</span>
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
          className="ml-1 rounded-md border border-line bg-white px-2 py-0.5 font-semibold text-ink-sub hover:bg-zinc-50 disabled:opacity-60"
        >
          새로고침
        </button>
      </div>
      {error && (
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
