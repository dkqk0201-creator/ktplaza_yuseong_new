"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { STAFF_NAMES } from "@/lib/data/staff-list";
import { formatNumber } from "@/lib/format";
import {
  GOBULBI_CONTENT_MAX,
  GOBULBI_SHEET,
  beforeOf,
  gobulbiAmountError,
  gobulbiContentError,
  gobulbiSellerError,
  newGobulbiId,
  parseGobulbiAmount,
  sortGobulbi,
  type GobulbiItem,
  type GobulbiMonth,
} from "@/lib/gobulbi";
import { postGobulbi } from "@/lib/gobulbi-api";
import { monthDayText } from "@/lib/sale-display";

/*
 * 예산관리 → 고불비사용 카드를 누르면 열리는 내역 (선택한 월, 지급일 기준, 삭제 제외).
 * 신규 등록은 이번 달만 · 지난달은 조회·수정·삭제만. 지급일은 등록 시 자동, 수정 불가.
 * 저장은 서버(Apps Script)가 확인해 준 경우에만 성공으로 표시한다.
 */

export type GobulbiLoad =
  | { status: "loading" }
  | { status: "error"; message: string; notDeployed: boolean }
  | { status: "ok"; data: GobulbiMonth };

type Form =
  | { mode: "create"; id: string }
  | { mode: "edit"; item: GobulbiItem };

function Won({ value, strong = false }: { value: number; strong?: boolean }) {
  return (
    <span className={`${strong ? "font-semibold" : ""} ${value < 0 ? "text-rose-600" : ""}`}>
      {formatNumber(value)}
      <span className="ml-0.5 text-xs font-normal text-ink-muted">원</span>
    </span>
  );
}

export function GobulbiPanel({
  month,
  monthLabel,
  isCurrentMonth,
  load,
  onChanged,
  onClose,
  onRetry,
}: {
  month: string;
  monthLabel: string;
  /** 이번 달(한국 시간)이면 신규 등록 가능 */
  isCurrentMonth: boolean;
  load: GobulbiLoad;
  /** 등록·수정·삭제 성공 후: 안내 문구 + 목록·예산 다시 불러오기 */
  onChanged: (message: string) => void;
  onClose: () => void;
  onRetry: () => void;
}) {
  const [form, setForm] = useState<Form | null>(null);
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, []);
  // 월이 바뀌면 입력창 닫기
  useEffect(() => setForm(null), [month]);

  const items = load.status === "ok" ? sortGobulbi(load.data.items) : [];
  const total = load.status === "ok" ? load.data.total : 0;

  return (
    <section
      id="budget-usage-list"
      ref={ref}
      tabIndex={-1}
      aria-label={`${monthLabel} 고불비사용 내역`}
      className="overflow-hidden rounded-xl border border-brand/30 bg-white"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line bg-brand-soft/30 px-4 py-3">
        <h3 className="text-sm font-bold text-ink">
          {monthLabel} 고불비사용 내역
          {load.status === "ok" && <> · {formatNumber(items.length)}건</>}
        </h3>
        <span className="text-xs text-ink-muted">
          지급일 기준 · 삭제 제외 · 구글시트 &lsquo;{GOBULBI_SHEET}&rsquo; 시트
        </span>
        <button
          type="button"
          onClick={onClose}
          className="ml-auto text-xs font-medium text-ink-sub underline underline-offset-2"
        >
          닫기
        </button>
      </div>

      {load.status === "loading" && (
        <p className="px-4 py-6 text-center text-sm text-ink-sub">고불비사용 내역을 불러오는 중…</p>
      )}

      {load.status === "error" && (
        <div role="alert" className="space-y-2 px-4 py-4 text-sm">
          <p className="font-semibold text-rose-700">{load.message}</p>
          <button
            type="button"
            onClick={onRetry}
            className="rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-ink hover:bg-zinc-50"
          >
            다시 불러오기
          </button>
        </div>
      )}

      {load.status === "ok" && (
        <>
          {load.data.invalidRows > 0 && (
            <p role="alert" className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs font-semibold text-amber-800">
              구글시트 &lsquo;{GOBULBI_SHEET}&rsquo; 시트에 형식이 올바르지 않은 행이 {load.data.invalidRows}개 있어 합계에
              넣지 않았습니다 (지급일·금액·상태 확인 필요).
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
            {isCurrentMonth ? (
              <button
                type="button"
                onClick={() => setForm({ mode: "create", id: newGobulbiId() })}
                disabled={form?.mode === "create"}
                className="rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-white hover:bg-brand-strong disabled:opacity-50"
              >
                + 고불비사용 등록
              </button>
            ) : (
              <span className="text-xs text-ink-sub">
                지난달은 조회·수정·삭제만 할 수 있습니다 (신규 등록은 이번 달 화면에서).
              </span>
            )}
            <span className="ml-auto text-xs text-ink-muted">내역을 누르면 수정·삭제</span>
          </div>

          {form?.mode === "create" && (
            <GobulbiForm
              key={form.id}
              form={form}
              month={month}
              onCancel={() => setForm(null)}
              onSaved={(message) => {
                setForm(null);
                onChanged(message);
              }}
            />
          )}

          {items.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-ink-sub">이 달 고불비사용 내역이 없습니다.</p>
          ) : (
            <>
              {/* PC·태블릿: 표 */}
              <div className="hidden overflow-x-auto sm:block">
                <table className="w-full min-w-[560px] text-sm">
                  <thead className="bg-zinc-50 text-xs text-ink-sub">
                    <tr>
                      <th scope="col" className="px-3 py-2.5 text-left font-semibold">지급일</th>
                      <th scope="col" className="px-3 py-2.5 text-left font-semibold">내용</th>
                      <th scope="col" className="px-3 py-2.5 text-right font-semibold">금액</th>
                      <th scope="col" className="px-3 py-2.5 text-left font-semibold">판매자</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line tabular-nums text-ink">
                    {items.map((item) => {
                      const editing = form?.mode === "edit" && form.item.id === item.id;
                      return (
                        <tr
                          key={item.id}
                          onClick={() => setForm({ mode: "edit", item })}
                          className={`cursor-pointer hover:bg-zinc-50 ${editing ? "bg-brand-soft/40" : ""}`}
                        >
                          <td className="px-3 py-2.5 whitespace-nowrap">{monthDayText(item.payDate)}</td>
                          <td className="px-3 py-2.5">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setForm({ mode: "edit", item });
                              }}
                              className="text-left font-semibold break-all text-ink underline-offset-2 hover:underline"
                            >
                              {item.content}
                            </button>
                          </td>
                          <td className="px-3 py-2.5 text-right whitespace-nowrap">
                            <Won value={item.amount} strong />
                          </td>
                          <td className="px-3 py-2.5 whitespace-nowrap">{item.seller || "-"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot className="border-t-2 border-line bg-brand-soft/40 tabular-nums">
                    <tr>
                      <th scope="row" colSpan={2} className="px-3 py-2.5 text-left font-bold text-ink">
                        고불비사용 합계 ({formatNumber(items.length)}건)
                      </th>
                      <td className="px-3 py-2.5 text-right whitespace-nowrap font-bold">
                        <Won value={total} strong />
                      </td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>

              {/* 모바일: 목록 */}
              <ul className="divide-y divide-line sm:hidden">
                {items.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => setForm({ mode: "edit", item })}
                      className="block w-full px-4 py-3 text-left tabular-nums hover:bg-zinc-50"
                    >
                      <span className="flex items-baseline justify-between gap-3">
                        <span className="min-w-0 font-semibold break-all text-ink">{item.content}</span>
                        <span className="shrink-0 text-ink">
                          <Won value={item.amount} strong />
                        </span>
                      </span>
                      <span className="mt-0.5 block text-xs text-ink-sub">
                        {monthDayText(item.payDate)} · {item.seller || "-"}
                      </span>
                    </button>
                  </li>
                ))}
                <li className="flex items-baseline justify-between bg-brand-soft/40 px-4 py-3 tabular-nums">
                  <span className="text-sm font-bold text-ink">고불비사용 합계 ({formatNumber(items.length)}건)</span>
                  <span className="font-bold text-ink">
                    <Won value={total} strong />
                  </span>
                </li>
              </ul>
            </>
          )}

          {form?.mode === "edit" && (
            <GobulbiForm
              key={form.item.id + form.item.updatedAt}
              form={form}
              month={month}
              onCancel={() => setForm(null)}
              onSaved={(message) => {
                setForm(null);
                onChanged(message);
              }}
            />
          )}
        </>
      )}
    </section>
  );
}

function GobulbiForm({
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
  const [content, setContent] = useState(editing?.content ?? "");
  const [amountText, setAmountText] = useState(editing ? String(editing.amount) : "");
  const [seller, setSeller] = useState(editing?.seller ?? "");
  const [busy, setBusy] = useState<null | "save" | "delete">(null);
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    formRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, []);

  const amount = parseGobulbiAmount(amountText);
  const contentProblem = gobulbiContentError(content);
  const amountProblem = amount === null ? "금액은 숫자로 입력해 주세요 (예: 50000 또는 5만)." : gobulbiAmountError(amount);
  const sellerProblem = gobulbiSellerError(seller, STAFF_NAMES);
  const invalid = !!(contentProblem || amountProblem || sellerProblem);
  const unchanged =
    !!editing &&
    editing.content === content.trim() &&
    editing.amount === amount &&
    editing.seller === seller.trim();

  async function save(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (invalid || busy || unchanged) return;
    setBusy("save");
    setError(null);
    const fields = { content: content.trim(), amount: amount!, seller: seller.trim() };
    const res =
      form.mode === "create"
        ? // 같은 입력창에서 다시 눌러도 같은 ID → Apps Script 가 중복 저장하지 않는다
          await postGobulbi({ op: "create", month, id: form.id, ...fields })
        : await postGobulbi({ op: "update", id: form.item.id, before: beforeOf(form.item), ...fields });
    setBusy(null);
    if (res.ok) onSaved(res.message);
    else setError(res.message);
  }

  async function remove() {
    if (!editing || busy) return;
    const ok = window.confirm(
      `이 고불비사용 내역을 삭제할까요?\n\n${monthDayText(editing.payDate)} · ${editing.content} · ${formatNumber(editing.amount)}원 · ${editing.seller}\n\n삭제하면 합계와 현금예산에서 빠집니다. (구글시트에는 삭제 기록이 남습니다)`,
    );
    if (!ok) return;
    setBusy("delete");
    setError(null);
    const res = await postGobulbi({ op: "delete", id: editing.id, before: beforeOf(editing) });
    setBusy(null);
    if (res.ok) onSaved(res.message);
    else setError(res.message);
  }

  const fieldClass =
    "mt-1 w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink focus:border-brand focus:outline-none";
  return (
    <form
      ref={formRef}
      onSubmit={save}
      aria-label={editing ? "고불비사용 수정" : "고불비사용 등록"}
      className="border-y border-brand/20 bg-brand-soft/20 px-4 py-4"
    >
      <p className="text-sm font-bold text-ink">
        {editing ? "고불비사용 수정" : "고불비사용 등록"}
        <span className="ml-2 text-xs font-normal text-ink-muted">
          지급일 {editing ? `${monthDayText(editing.payDate)} (수정 불가)` : "= 오늘 (등록 시 자동 기록)"}
        </span>
      </p>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-[1fr_10rem_9rem]">
        <label className="block text-xs font-semibold text-ink-sub">
          내용
          <input
            value={content}
            onChange={(e) => setContent(e.target.value)}
            maxLength={GOBULBI_CONTENT_MAX}
            placeholder="예: 고객 불편 보상"
            className={fieldClass}
            disabled={!!busy}
          />
        </label>
        <label className="block text-xs font-semibold text-ink-sub">
          금액
          <input
            value={amountText}
            onChange={(e) => setAmountText(e.target.value)}
            inputMode="numeric"
            placeholder="50000"
            className={`${fieldClass} text-right tabular-nums`}
            disabled={!!busy}
          />
        </label>
        <label className="block text-xs font-semibold text-ink-sub">
          판매자
          <select
            value={seller}
            onChange={(e) => setSeller(e.target.value)}
            className={fieldClass}
            disabled={!!busy}
          >
            <option value="">선택</option>
            {STAFF_NAMES.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
            {editing && seller && !STAFF_NAMES.includes(seller) && <option value={seller}>{seller}</option>}
          </select>
        </label>
      </div>
      {touched && invalid && (
        <ul role="alert" className="mt-2 space-y-0.5 text-xs font-semibold text-rose-600">
          {[contentProblem, amountProblem, sellerProblem].filter(Boolean).map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
      {error && (
        <p role="alert" className="mt-2 rounded-lg bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">
          저장되지 않았습니다: {error}
        </p>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="submit"
          disabled={!!busy || unchanged}
          className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-strong disabled:opacity-50"
        >
          {busy === "save" ? "저장 중…" : editing ? "수정 저장" : "등록"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={!!busy}
          className="rounded-lg border border-line bg-white px-4 py-2 text-sm font-semibold text-ink hover:bg-zinc-50 disabled:opacity-50"
        >
          취소
        </button>
        {editing && (
          <button
            type="button"
            onClick={remove}
            disabled={!!busy}
            className="ml-auto rounded-lg border border-rose-300 bg-white px-4 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50"
          >
            {busy === "delete" ? "삭제 중…" : "삭제"}
          </button>
        )}
      </div>
    </form>
  );
}
