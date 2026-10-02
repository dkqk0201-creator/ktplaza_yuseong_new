export function StatCard({
  label,
  value,
  unit,
  hint,
  emphasis = false,
}: {
  label: string;
  value: string;
  unit: string;
  hint?: string;
  emphasis?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border bg-white p-5 shadow-[0_1px_2px_rgba(0,0,0,0.04)] ${
        emphasis ? "border-brand/30 ring-1 ring-brand/10" : "border-line"
      }`}
    >
      <p className="text-sm font-medium text-ink-sub">{label}</p>
      <p
        className={`mt-2 text-[26px] leading-tight font-bold tracking-tight tabular-nums sm:text-[28px] ${
          emphasis ? "text-brand" : "text-ink"
        }`}
      >
        {value}
        <span className="ml-0.5 text-base font-semibold text-ink-sub">
          {unit}
        </span>
      </p>
      {hint && <p className="mt-2 text-xs text-ink-muted">{hint}</p>}
    </div>
  );
}
