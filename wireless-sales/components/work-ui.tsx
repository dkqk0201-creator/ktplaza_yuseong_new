"use client";

import type { ReactNode } from "react";

/* 검수관리·카드실적·예산관리에서 함께 쓰는 작은 화면 부품 */

export function SummaryTile({
  label,
  value,
  tone = "default",
  active = false,
  onClick,
}: {
  label: string;
  value: string;
  tone?: "default" | "warn" | "good" | "brand";
  active?: boolean;
  onClick?: () => void;
}) {
  const color =
    tone === "warn"
      ? "text-rose-600"
      : tone === "good"
        ? "text-emerald-700"
        : tone === "brand"
          ? "text-brand"
          : "text-ink";
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      {...(onClick ? { type: "button" as const, onClick } : {})}
      className={`rounded-xl border bg-white p-4 text-left ${
        active ? "border-brand ring-2 ring-brand/15" : "border-line"
      } ${onClick ? "hover:border-zinc-300" : ""}`}
    >
      <p className="text-xs font-medium text-ink-sub">{label}</p>
      <p className={`mt-1 truncate text-2xl font-bold tabular-nums ${color}`}>
        {value}
      </p>
    </Tag>
  );
}

export function FilterChips<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly { value: T; label: string; count?: number }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="flex flex-wrap gap-1.5"
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(option.value)}
            className={`h-9 rounded-full border px-3 text-sm font-semibold whitespace-nowrap ${
              selected
                ? "border-ink bg-ink text-white"
                : "border-line bg-white text-ink-sub hover:border-zinc-300"
            }`}
          >
            {option.label}
            {option.count !== undefined && (
              <span
                className={`ml-1 tabular-nums ${selected ? "text-white/80" : "text-ink-muted"}`}
              >
                {option.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export function StaffSelect({
  staff,
  value,
  onChange,
}: {
  staff: string[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label="직원 선택"
      className="h-9 rounded-lg border border-line bg-white px-2.5 text-sm font-semibold text-ink"
    >
      <option value="">직원 전체</option>
      {staff.map((name) => (
        <option key={name} value={name}>
          {name}
        </option>
      ))}
    </select>
  );
}

export function StatusBadge({
  tone,
  children,
}: {
  tone: "warn" | "good" | "muted";
  children: ReactNode;
}) {
  const style =
    tone === "warn"
      ? "bg-rose-50 text-rose-700 ring-rose-600/20"
      : tone === "good"
        ? "bg-emerald-50 text-emerald-700 ring-emerald-600/20"
        : "bg-zinc-100 text-ink-sub ring-zinc-400/20";
  return (
    <span
      className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold whitespace-nowrap ring-1 ring-inset ${style}`}
    >
      {children}
    </span>
  );
}

export function EmptyBox({ text }: { text: string }) {
  return (
    <div className="rounded-xl border border-dashed border-line bg-white px-6 py-14 text-center text-sm text-ink-sub">
      {text}
    </div>
  );
}

export function Notice({
  message,
  onClose,
}: {
  message: string;
  onClose: () => void;
}) {
  return (
    <div
      role="status"
      className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800"
    >
      <span>✓ {message}</span>
      <button
        type="button"
        onClick={onClose}
        className="text-xs font-medium text-emerald-700 underline underline-offset-2"
      >
        닫기
      </button>
    </div>
  );
}
