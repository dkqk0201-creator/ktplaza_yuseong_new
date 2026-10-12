"use client";

import type { ReactNode } from "react";

/*
 * 간편등록 · 판매 수정 공용 입력칸 묶음 (같은 그룹 제목·항목 이름·순서·모양).
 * 화면마다 값·검사·안내만 다르고, 칸 모양은 이 컴포넌트 하나로 그린다.
 *   - 장표에 저장되는 칸: 실선 테두리 + "→ S열 모델정책"
 *   - 장표 저장 안 함 (참고): 점선 테두리 + 주황 안내
 * PC 는 2열, 모바일은 1열. 고객약속사항(여러 줄)은 한 줄 전체.
 */

export interface FieldView {
  /** 화면 안에서 유일한 id (input id 로도 씀) */
  id: string;
  label: string;
  /** "→ S열 모델정책" / "장표 저장 안 함 (참고)" */
  hint: string;
  /** 참고 항목 (장표 저장 안 함) 모양 */
  note?: boolean;
  value: string;
  onChange?: (value: string) => void;
  /** 고칠 수 없는 칸 (onChange 가 없어도 읽기 전용) */
  readOnly?: boolean;
  disabled?: boolean;
  placeholder?: string;
  multiline?: boolean;
  numeric?: boolean;
  maxLength?: number;
  /** 바꾼 값 표시 ("변경됨") */
  changed?: boolean;
  /** 빨간 글씨 문제 (등록·저장 막음) */
  problems?: readonly string[];
  /** 칸 아래 작은 안내 (저장 값, 수식 자동 등) */
  info?: ReactNode;
  /** 이 칸 바로 아래에 함께 보여줄 칸 (예: S열 금액 아래 정책명) */
  children?: FieldView[];
}

export interface FieldGroup {
  title: string;
  fields: FieldView[];
}

function FieldInput({ field }: { field: FieldView }) {
  const bad = field.problems && field.problems.length > 0;
  const locked = field.readOnly || !field.onChange;
  const border = bad
    ? "border-rose-400 bg-rose-50/40"
    : field.changed
      ? "border-brand/50 bg-rose-50/20"
      : locked
        ? "border-line bg-zinc-50 text-ink-sub"
        : field.note
          ? "border-dashed border-line bg-zinc-50/60"
          : "border-line";
  const common = {
    id: field.id,
    value: field.value,
    placeholder: field.placeholder,
    disabled: field.disabled,
    readOnly: locked,
    maxLength: field.maxLength,
    autoComplete: "off",
    "aria-invalid": bad ? true : undefined,
    onChange: (e: { target: { value: string } }) => field.onChange?.(e.target.value),
  } as const;
  return (
    <div>
      <label
        htmlFor={field.id}
        className="flex flex-wrap items-baseline gap-x-2 text-xs font-semibold text-ink-sub"
      >
        {field.label}
        <span className={`font-normal ${field.note ? "text-amber-700" : "text-ink-muted"}`}>
          {field.hint}
        </span>
        {field.changed && (
          <span className="ml-auto font-semibold text-brand">변경됨</span>
        )}
      </label>
      {field.multiline ? (
        <textarea
          {...common}
          rows={2}
          className={`mt-1 w-full rounded-lg border px-3 py-2 text-base outline-none focus:border-brand disabled:bg-zinc-50 ${border}`}
        />
      ) : (
        <input
          {...common}
          inputMode={field.numeric ? "numeric" : undefined}
          className={`mt-1 h-10 w-full rounded-lg border px-3 text-base outline-none focus:border-brand disabled:bg-zinc-50 ${border} ${
            field.numeric ? "tabular-nums" : ""
          }`}
        />
      )}
      {field.info && <div className="mt-0.5 text-xs text-ink-muted">{field.info}</div>}
      {field.problems?.map((p) => (
        <p key={p} className="mt-0.5 text-xs font-medium text-rose-600">
          {p}
        </p>
      ))}
    </div>
  );
}

/** 그룹별 입력칸 (그룹 제목 + PC 2열 / 모바일 1열) */
export function SaleFieldGroups({ groups }: { groups: FieldGroup[] }) {
  return (
    <div className="space-y-4">
      {groups.map((group) => (
        <section key={group.title} aria-label={group.title}>
          <h4 className="mb-2 border-b border-line pb-1 text-xs font-bold tracking-wide text-ink">
            {group.title}
          </h4>
          <div className="grid grid-cols-1 gap-x-5 gap-y-3 md:grid-cols-2">
            {group.fields.map((field) => (
              <div key={field.id} className={field.multiline ? "md:col-span-2" : ""}>
                <FieldInput field={field} />
                {field.children && field.children.length > 0 && (
                  <div className="mt-2 space-y-2 border-l-2 border-line pl-3">
                    {field.children.map((child) => (
                      <FieldInput key={child.id} field={child} />
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
