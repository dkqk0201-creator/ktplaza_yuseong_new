"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { formatNumber } from "@/lib/format";
import {
  OTHER_BUDGET_SHEET,
  OTHER_KIND_LABEL,
  OTHER_MEMO_MAX,
  OTHER_NAME_MAX,
  newOtherBudgetId,
  otherBeforeOf,
  otherInputError,
  parseOtherAmount,
  signedAmount,
  sortOther,
  type OtherBudgetItem,
  type OtherBudgetMonth,
  type OtherKind,
} from "@/lib/other-budget";
import { postOtherBudget } from "@/lib/other-budget-api";

/*
 * 예산관리 → "기타 예산" 영역 (기존 예산 카드와 구분, 별도 메뉴·페이지 없음).
 * 고객혜택 예산이 아닌 점장 직접 등록 확보(+)·차감(-) 항목. 최종 매장 총예산에만 더한다.
 * 저장은 서버(Apps Script)가 확인해 준 경우에만 성공으로 표시한다.
 */

export type OtherBudgetLoad =
  | { status: "loading" }
  | { status: "error"; message: string; notDeployed: boolean }
  | { status: "ok"; data: OtherBudgetMonth };

type Form = { mode: "create"; id: string } | { mode: "edit"; item: OtherBudgetItem };

function Signed({ value }: { value: number }) {
  return (
    <span className={`font-semibold tabular-nums ${value < 0 ? "text-rose-600" : value > 0 ? "text-emerald-700" : ""}`}>
      {value > 0 ? "+" : value < 0 ? "−" : ""}
      {formatNumber(Math.abs(value))}
      <span className="ml-0.5 text-xs font-normal text-ink-muted">원</span>
    </span>
  );
}

export function OtherBudgetPanel({
  month,
  monthLabel,
  load,
  onChanged,
  onRetry,
}: {
  month: string;
  monthLabel: string;
  load: OtherBudgetLoad;
  /** 등록·수정·삭제·복구 성공 후: 안내 문구 + 다시 불러오기 (최종 매장 총예산 재계산) */
  onChanged: (message: string) => void;
  onRetry: () => void;
}) {
  const [form, setForm] = useState<Form | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setForm(null);
    setError(null);
  }, [month]);
  const items = load.status === "ok" ? sortOther(load.data.items) : [];
  const deleted = load.status === "ok" ? sortOther(load.data.deleted) : [];

  async function changeStatus(op: "delete" | "restore", item: OtherBudgetItem) {
    if (busy) return;
    const text = `${item.name} · ${OTHER_KIND_LABEL[item.kind]} ${formatNumber(item.amount)}원`;
    if (
      !window.confirm(
        op === "delete"
          ? `이 기타 예산 항목을 삭제할까요?\n\n${text}\n\n최종 매장 총예산에서 빠집니다. (구글시트에 기록이 남고 복구할 수 있습니다)`
          : `삭제한 항목을 복구할까요?\n\n${text}`,
      )
    )
      return;
    setBusy(item.id);
    setError(null);
    const res = await postOtherBudget({ op, id: item.id, before: otherBeforeOf(item) });
    setBusy(null);
    if (res.ok) {
      setForm(null);
      onChanged(res.message);
    } else setError(res.message);
  }

  return (
    <section aria-label={`${monthLabel} 기타 예산`} className="overflow-hidden rounded-xl border border-violet-200 bg-white">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-violet-200 bg-violet-50/60 px-4 py-3">
        <h3 className="text-sm font-bold text-ink">{monthLabel} 기타 예산</h3>
        <span className="text-xs text-ink-muted">
          고객혜택 예산이 아닌 별도 확보·차감 · 최종 매장 총예산에만 반영 · 구글시트 &lsquo;{OTHER_BUDGET_SHEET}&rsquo; 시트
        </span>
        {load.status === "ok" && (
          <button
            type="button"
            onClick={() => setForm({ mode: "create", id: newOtherBudgetId() })}
            disabled={form?.mode === "create"}
            className="ml-auto rounded-lg bg-violet-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-violet-800 disabled:opacity-50"
          >
            + 기타 예산 등록
          </button>
        )}
      </div>

      {load.status === "loading" && <p className="px-4 py-6 text-center text-sm text-ink-sub">기타 예산을 불러오는 중…</p>}
      {load.status === "error" && (
        <div role="alert" className="space-y-2 px-4 py-4 text-sm">
          <p className="font-semibold text-rose-700">{load.message}</p>
          <button type="button" onClick={onRetry} className="rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-ink hover:bg-zinc-50">
            다시 불러오기
          </button>
        </div>
      )}

      {load.status === "ok" && (
        <>
          {load.data.invalidRows > 0 && (
            <p role="alert" className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs font-semibold text-amber-800">
              구글시트 &lsquo;{OTHER_BUDGET_SHEET}&rsquo; 시트에 형식이 올바르지 않은 행이 {load.data.invalidRows}개 있어 합계에 넣지 않았습니다.
            </p>
          )}
          {error && (
            <p role="alert" className="border-b border-rose-200 bg-rose-50 px-4 py-2 text-xs font-semibold text-rose-700">
              처리되지 않았습니다: {error}
            </p>
          )}
          {form?.mode === "create" && (
            <OtherBudgetForm key={form.id} form={form} month={month} onCancel={() => setForm(null)} onSaved={(m) => { setForm(null); onChanged(m); }} />
          )}

          {items.length === 0 ? (
            <p className="px-4 py-5 text-center text-sm text-ink-sub">이 달 기타 예산 내역이 없습니다.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead className="bg-zinc-50 text-xs text-ink-sub">
                  <tr>
                    <th scope="col" className="px-3 py-2.5 text-left font-semibold">등록일</th>
                    <th scope="col" className="px-3 py-2.5 text-left font-semibold">항목명</th>
                    <th scope="col" className="px-3 py-2.5 text-left font-semibold">구분</th>
                    <th scope="col" className="px-3 py-2.5 text-right font-semibold">금액</th>
                    <th scope="col" className="px-3 py-2.5 text-left font-semibold">메모</th>
                    <th scope="col" className="px-3 py-2.5 text-left font-semibold">관리</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line tabular-nums text-ink">
                  {items.map((item) => (
                    <tr key={item.id} className={form?.mode === "edit" && form.item.id === item.id ? "bg-violet-50/60" : undefined}>
                      <td className="px-3 py-2.5 whitespace-nowrap">{item.createdAt.slice(0, 10).replaceAll("-", ".")}</td>
                      <td className="px-3 py-2.5 font-semibold break-all">{item.name}</td>
                      <td className="px-3 py-2.5 whitespace-nowrap">{OTHER_KIND_LABEL[item.kind]}</td>
                      <td className="px-3 py-2.5 text-right whitespace-nowrap"><Signed value={signedAmount(item)} /></td>
                      <td className="px-3 py-2.5 break-all text-ink-sub">{item.memo || "-"}</td>
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        <button type="button" onClick={() => setForm({ mode: "edit", item })} disabled={!!busy} className="text-xs font-semibold text-brand underline underline-offset-2">
                          수정
                        </button>
                        <span className="mx-1 text-ink-muted">·</span>
                        <button type="button" onClick={() => void changeStatus("delete", item)} disabled={!!busy} className="text-xs font-semibold text-rose-700 underline underline-offset-2">
                          {busy === item.id ? "삭제 중…" : "삭제"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t-2 border-line bg-violet-50/50 tabular-nums">
                  <tr>
                    <th scope="row" colSpan={3} className="px-3 py-2.5 text-left text-sm font-bold text-ink">
                      확보 +{formatNumber(load.data.gain)}원 · 차감 −{formatNumber(load.data.deduct)}원 · 순증감
                    </th>
                    <td className="px-3 py-2.5 text-right whitespace-nowrap"><Signed value={load.data.net} /></td>
                    <td colSpan={2} />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          {form?.mode === "edit" && (
            <OtherBudgetForm
              key={form.item.id + form.item.updatedAt}
              form={form}
              month={month}
              onCancel={() => setForm(null)}
              onSaved={(m) => {
                setForm(null);
                onChanged(m);
              }}
            />
          )}

          {deleted.length > 0 && (
            <details className="border-t border-line px-4 py-3">
              <summary className="cursor-pointer text-xs font-semibold text-ink-sub">삭제한 항목 {deleted.length}건 (복구 가능)</summary>
              <ul className="mt-2 divide-y divide-line text-xs">
                {deleted.map((d) => (
                  <li key={d.id} className="flex flex-wrap items-center gap-x-3 py-1.5 text-ink-sub">
                    <span className="line-through">{d.name}</span>
                    <span>{OTHER_KIND_LABEL[d.kind]} {formatNumber(d.amount)}원</span>
                    <span>삭제 {d.deletedAt}</span>
                    <button type="button" onClick={() => void changeStatus("restore", d)} disabled={!!busy} className="ml-auto rounded border border-line px-2 py-0.5 font-semibold text-ink hover:bg-zinc-50">
                      {busy === d.id ? "복구 중…" : "복구"}
                    </button>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </section>
  );
}

function OtherBudgetForm({
  form,
  month,
  onCancel,
  onSaved,
}: {
  form: Form;
  month: string;
  onCancel: () => void;
  onSaved: (message: string) => void;
}) {
  const editing = form.mode === "edit" ? form.item : null;
  const [applyMonth, setApplyMonth] = useState(editing?.month ?? month);
  const [name, setName] = useState(editing?.name ?? "");
  const [kind, setKind] = useState<OtherKind | "">(editing?.kind ?? "");
  const [amountText, setAmountText] = useState(editing ? String(editing.amount) : "");
  const [memo, setMemo] = useState(editing?.memo ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, []);
  const amount = parseOtherAmount(amountText);
  const problem =
    amount === null
      ? "금액은 원 단위 숫자로 입력해 주세요 (예: 300000 또는 30만)."
      : otherInputError({ name, kind, amount, memo }) ?? (/^\d{4}-(0[1-9]|1[0-2])$/.test(applyMonth) ? null : "적용 월을 선택해 주세요.");
  const unchanged = !!editing && editing.name === name.trim() && editing.kind === kind && editing.amount === amount && editing.memo === memo.trim();

  async function save(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (problem || busy || unchanged || !kind) return;
    setBusy(true);
    setError(null);
    const fields = { name: name.trim(), kind, amount: amount!, memo: memo.trim() };
    const res =
      form.mode === "create"
        ? await postOtherBudget({ op: "create", month: applyMonth, id: form.id, ...fields })
        : await postOtherBudget({ op: "update", id: form.item.id, before: otherBeforeOf(form.item), ...fields });
    setBusy(false);
    if (res.ok) onSaved(res.message + (form.mode === "create" && applyMonth !== month ? ` (적용 월 ${applyMonth})` : ""));
    else setError(res.message);
  }

  const cls = "mt-1 w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink focus:border-brand focus:outline-none";
  return (
    <form ref={ref} onSubmit={save} aria-label={editing ? "기타 예산 수정" : "기타 예산 등록"} className="border-y border-violet-200 bg-violet-50/40 px-4 py-4">
      <p className="text-sm font-bold text-ink">{editing ? "기타 예산 수정" : "기타 예산 등록"}</p>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-[9rem_1fr_9rem_10rem]">
        <label className="block text-xs font-semibold text-ink-sub">
          적용 월
          <input type="month" value={applyMonth} onChange={(e) => setApplyMonth(e.target.value)} disabled={busy || !!editing} className={cls} />
        </label>
        <label className="block text-xs font-semibold text-ink-sub">
          예산 항목명
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={OTHER_NAME_MAX} placeholder="예: 별도 영업지원금" disabled={busy} className={cls} />
        </label>
        <div className="text-xs font-semibold text-ink-sub">
          구분
          <div className="mt-1 flex gap-3 py-2">
            {(["gain", "deduct"] as const).map((k) => (
              <label key={k} className="flex items-center gap-1 font-normal text-ink">
                <input type="radio" name="other-kind" checked={kind === k} onChange={() => setKind(k)} disabled={busy} />
                {k === "gain" ? "확보(+)" : "차감(−)"}
              </label>
            ))}
          </div>
        </div>
        <label className="block text-xs font-semibold text-ink-sub">
          금액 (원)
          <input value={amountText} onChange={(e) => setAmountText(e.target.value)} inputMode="numeric" placeholder="300000" disabled={busy} className={`${cls} text-right tabular-nums`} />
        </label>
      </div>
      <label className="mt-3 block text-xs font-semibold text-ink-sub">
        메모 (선택)
        <input value={memo} onChange={(e) => setMemo(e.target.value)} maxLength={OTHER_MEMO_MAX} placeholder="예: 회사 정책 정산" disabled={busy} className={cls} />
      </label>
      {editing && <p className="mt-2 text-xs text-ink-muted">적용 월은 수정할 수 없습니다 (다른 달이면 삭제 후 그 달로 새로 등록).</p>}
      {touched && problem && <p role="alert" className="mt-2 text-xs font-semibold text-rose-600">{problem}</p>}
      {error && <p role="alert" className="mt-2 rounded-lg bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">저장되지 않았습니다: {error}</p>}
      <div className="mt-3 flex gap-2">
        <button type="submit" disabled={busy || unchanged} className="rounded-lg bg-violet-700 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-800 disabled:opacity-50">
          {busy ? "저장 중…" : editing ? "수정 저장" : "등록"}
        </button>
        <button type="button" onClick={onCancel} disabled={busy} className="rounded-lg border border-line bg-white px-4 py-2 text-sm font-semibold text-ink hover:bg-zinc-50 disabled:opacity-50">
          취소
        </button>
      </div>
    </form>
  );
}
