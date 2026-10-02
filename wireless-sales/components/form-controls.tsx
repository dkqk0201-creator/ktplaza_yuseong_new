"use client";

import type {
  InputHTMLAttributes,
  ReactNode,
  TextareaHTMLAttributes,
} from "react";
import { formatNumber } from "@/lib/format";

/* 판매 등록 등 입력 화면에서 함께 쓰는 입력 부품 */

export function FormSection({
  step,
  title,
  description,
  aside,
  className = "",
  children,
}: {
  step: number;
  title: string;
  description?: string;
  aside?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      aria-labelledby={`section-${step}`}
      className={`rounded-xl border border-line bg-white shadow-[0_1px_2px_rgba(0,0,0,0.04)] ${className}`}
    >
      <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3.5 sm:px-5">
        <div className="flex items-center gap-2.5">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-ink text-xs font-bold text-white">
            {step}
          </span>
          <div>
            <h2 id={`section-${step}`} className="text-base font-bold text-ink">
              {title}
            </h2>
            {description && (
              <p className="text-xs text-ink-muted">{description}</p>
            )}
          </div>
        </div>
        {aside}
      </header>
      <div className="p-4 sm:p-5">{children}</div>
    </section>
  );
}

export function Field({
  label,
  htmlFor,
  required = false,
  error,
  group = false,
  className = "",
  children,
}: {
  label: string;
  htmlFor?: string;
  required?: boolean;
  error?: string;
  /** 버튼 묶음(ChoiceGroup) 제목일 때 true. 첫 버튼의 이름을 덮어쓰지 않도록 label 대신 span으로 그린다. */
  group?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const asLabel = htmlFor && !group;
  const LabelTag = asLabel ? "label" : "span";
  return (
    <div className={className}>
      <LabelTag
        {...(asLabel ? { htmlFor } : {})}
        className="mb-1.5 block text-sm font-semibold text-ink"
      >
        {label}
        {required && (
          <span className="ml-0.5 text-brand" aria-hidden>
            *
          </span>
        )}
        {required && <span className="sr-only"> (필수)</span>}
      </LabelTag>
      {children}
      {error && (
        <p
          id={htmlFor ? `${htmlFor}-error` : undefined}
          className="mt-1.5 text-xs font-medium text-rose-600"
        >
          {error}
        </p>
      )}
    </div>
  );
}

const inputBase =
  "h-11 w-full rounded-lg border bg-white px-3 text-base text-ink placeholder:text-ink-muted/70 outline-none transition-colors focus:border-brand focus:ring-2 focus:ring-brand/15 disabled:bg-zinc-50 disabled:text-ink-muted";

function borderClass(invalid?: boolean) {
  return invalid ? "border-rose-500 bg-rose-50/40" : "border-line";
}

export function TextInput({
  invalid,
  className = "",
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }) {
  return (
    <input
      {...props}
      aria-invalid={invalid || undefined}
      aria-describedby={invalid && props.id ? `${props.id}-error` : undefined}
      className={`${inputBase} ${borderClass(invalid)} ${className}`}
    />
  );
}

export function TextArea({
  className = "",
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={`${inputBase} ${borderClass()} h-auto min-h-24 resize-y py-2.5 leading-relaxed ${className}`}
    />
  );
}

/** 금액 입력: 숫자만 받고 천 단위 쉼표를 표시한다. value는 숫자만 담은 문자열. */
export function AmountInput({
  id,
  value,
  onChange,
  disabled,
  ariaLabel,
}: {
  id: string;
  value: string;
  onChange: (digits: string) => void;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  return (
    <div className="relative">
      <input
        id={id}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        placeholder="0"
        disabled={disabled}
        aria-label={ariaLabel}
        value={value ? formatNumber(Number(value)) : ""}
        onChange={(e) => {
          const digits = e.target.value
            .replace(/\D/g, "")
            .replace(/^0+(?=\d)/, "")
            .slice(0, 12);
          onChange(digits);
        }}
        className={`${inputBase} ${borderClass()} pr-9 text-right font-medium tabular-nums`}
      />
      <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-ink-muted">
        원
      </span>
    </div>
  );
}

/** 버튼형 단일 선택 */
export function ChoiceGroup<T extends string>({
  id,
  label,
  options,
  value,
  onChange,
  invalid,
  columns,
  variant = "brand",
}: {
  id: string;
  label: string;
  options: readonly T[];
  value: T | "";
  onChange: (value: T) => void;
  invalid?: boolean;
  /** 고정 열 수 (없으면 내용에 맞게 줄바꿈) */
  columns?: number;
  /** "ox": 선택된 "X"는 회색, 그 외 선택값은 초록색으로 표시 */
  variant?: "brand" | "ox";
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      aria-invalid={invalid || undefined}
      aria-describedby={invalid ? `${id}-error` : undefined}
      className={columns ? "grid gap-2" : "flex flex-wrap gap-2"}
      style={
        columns
          ? { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }
          : undefined
      }
    >
      {options.map((option, index) => {
        const selected = option === value;
        return (
          <button
            key={option}
            id={index === 0 ? id : undefined}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(option)}
            className={`h-11 rounded-lg border px-4 text-[15px] font-semibold whitespace-nowrap transition-colors ${
              selected
                ? variant === "brand"
                  ? "border-brand bg-brand text-white"
                  : option === "X"
                    ? "border-zinc-600 bg-zinc-600 text-white"
                    : "border-emerald-600 bg-emerald-600 text-white"
                : invalid
                  ? "border-rose-500 bg-rose-50/40 text-ink-sub hover:bg-rose-50"
                  : "border-line bg-white text-ink-sub hover:border-zinc-300 hover:text-ink"
            }`}
          >
            {option}
          </button>
        );
      })}
    </div>
  );
}

/** 완료/미완료 토글 (큰 터치 영역) */
export function StatusToggle({
  id,
  label,
  checked,
  onChange,
  onText = "완료",
  offText = "미완료",
}: {
  id: string;
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  onText?: string;
  offText?: string;
}) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`flex h-14 w-full items-center justify-between gap-3 rounded-lg border px-4 text-left transition-colors ${
        checked
          ? "border-emerald-500/50 bg-emerald-50"
          : "border-line bg-white hover:border-zinc-300"
      }`}
    >
      <span className="text-[15px] font-semibold text-ink">{label}</span>
      <span className="flex items-center gap-2">
        <span
          className={`text-sm font-semibold ${checked ? "text-emerald-700" : "text-ink-muted"}`}
        >
          {checked ? onText : offText}
        </span>
        <span
          aria-hidden
          className={`relative h-6 w-11 rounded-full transition-colors ${
            checked ? "bg-emerald-500" : "bg-zinc-300"
          }`}
        >
          <span
            className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
              checked ? "translate-x-5" : ""
            }`}
          />
        </span>
      </span>
    </button>
  );
}

/** 자동 계산 결과 표시 줄 */
export function TotalRow({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: number;
  tone?: "default" | "negative";
}) {
  return (
    <div className="mt-4 flex items-center justify-between rounded-lg bg-zinc-50 px-4 py-3">
      <span className="text-sm font-semibold text-ink">
        {label}
        <span className="ml-1.5 rounded bg-zinc-200/70 px-1.5 py-0.5 text-[11px] font-medium text-ink-sub">
          자동 계산
        </span>
      </span>
      <span
        className={`text-xl font-bold tabular-nums ${tone === "negative" ? "text-rose-600" : "text-ink"}`}
      >
        {formatNumber(value)}
        <span className="ml-0.5 text-sm font-semibold text-ink-sub">원</span>
      </span>
    </div>
  );
}
