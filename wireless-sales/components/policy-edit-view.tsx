"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { formatNumber, todayInKorea } from "@/lib/format";
import { loadSalesForMonths } from "@/lib/load-sales-months";
import {
  POLICY_EDIT_MAX_ITEMS,
  POLICY_FIELDS,
  changeDelta,
  changesFromInput,
  groupPolicy,
  newPolicyEditId,
  policyTotal,
  policyValues,
  queryError,
  saleKeyOf,
  selectPolicySales,
  toEditItem,
  type PolicyChange,
  type PolicyEditApplyResult,
  type PolicyEditHistoryEntry,
  type PolicyKey,
  type PolicyQuery,
  type PolicySale,
} from "@/lib/policy-edit";
import { fetchPolicyEditHistory, postPolicyEditApply, postPolicyEditUndo } from "@/lib/policy-edit-api";
import { monthDayText } from "@/lib/sale-display";
import { monthsInRange, normalizeModel } from "@/lib/spot-bulk";

/*
 * 예산관리 > 정책 확보 관리.
 *   1) 기간(양쪽 포함, 월을 넘어가도 됨)·모델(특정 모델 여러 개 / 기간 내 전체) → [정책 확보 내역 조회] (저장 없음)
 *   2) 판매마다 고객혜택(T)·그외(스팟제외)(S)·2ND연계정책(R) 확보금액 확인 → [수정] → 바뀐 항목만 입력 → [변경 확인]
 *   3) 여러 판매를 각각 확인한 뒤 [수정 저장] 한 번에 저장 (같은 금액 일괄 적용 기능은 없음)
 *   4) 저장 후 자동 재조회 · 수정 이력 · 되돌리기
 * 저장은 Apps Script policy-edit.gs 가 잠금 안에서 판매·판매 ID·지금 금액을 다시 확인한 뒤 R·S·T 칸만 숫자로 쓴다.
 */

type Inputs = Partial<Record<PolicyKey, string>>;
interface Edit {
  inputs: Inputs;
  /** [변경 확인]을 눌러 저장 대상에 넣은 상태 */
  confirmed: boolean;
  change: PolicyChange;
}

const fieldClass =
  "mt-1 w-full rounded-lg border border-line bg-white px-2.5 py-2 text-sm text-ink focus:border-brand focus:outline-none disabled:bg-zinc-50";

function Amount({ value }: { value: number | null }) {
  if (value === null) return <span className="text-ink-muted" title="빈칸(또는 -)">빈칸</span>;
  return (
    <span className={value < 0 ? "text-rose-600" : undefined}>
      {formatNumber(value)}
      <span className="ml-0.5 text-xs font-normal text-ink-muted">원</span>
    </span>
  );
}

function Delta({ value }: { value: number }) {
  if (value === 0) return <span className="text-ink-muted">0</span>;
  return <span className={value > 0 ? "text-emerald-700" : "text-rose-600"}>{value > 0 ? "+" : "−"}{formatNumber(Math.abs(value))}원</span>;
}

type Load = { status: "idle" } | { status: "loading" } | { status: "error"; message: string };

export function PolicyEditView() {
  const today = todayInKorea();
  const [from, setFrom] = useState(`${today.slice(0, 7)}-01`);
  const [to, setTo] = useState(today);
  const [mode, setMode] = useState<"models" | "all">("models");
  const [modelsText, setModelsText] = useState("");
  const [modelSuggestions, setModelSuggestions] = useState<string[]>([]);
  const [load, setLoad] = useState<Load>({ status: "idle" });
  const [loadErrors, setLoadErrors] = useState<string[]>([]);
  const [queried, setQueried] = useState<{ query: PolicyQuery; rows: PolicySale[]; invalidDate: PolicySale[] } | null>(null);
  const [edits, setEdits] = useState<Map<string, Edit>>(new Map());
  const [open, setOpen] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [result, setResult] = useState<PolicyEditApplyResult | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [historyKey, setHistoryKey] = useState(0);

  const models = mode === "all" ? [] : [...new Set(modelsText.split(/[,，\n]/).map(normalizeModel).filter(Boolean))];
  const query: PolicyQuery = { from, to, models };
  const inputError = mode === "models" && models.length === 0 ? "조회할 모델을 입력하거나 '기간 내 전체 판매'를 선택해 주세요." : queryError(query);

  // 모델 목록 (입력 도움): 이번 달 판매 모델
  useEffect(() => {
    let cancelled = false;
    void loadSalesForMonths([today.slice(0, 7)]).then(({ sales }) => {
      if (!cancelled) setModelSuggestions(sales.map((s) => s.model));
    });
    return () => {
      cancelled = true;
    };
  }, [today]);
  const allModels = useMemo(() => [...new Set(modelSuggestions.map(normalizeModel).filter(Boolean))].sort(), [modelSuggestions]);

  async function runQuery(q: PolicyQuery, keepNotice = false) {
    setLoad({ status: "loading" });
    if (!keepNotice) setNotice(null);
    const { sales, errors } = await loadSalesForMonths(monthsInRange(q.from, q.to));
    setLoadErrors(errors);
    if (errors.length > 0 && sales.length === 0) {
      setLoad({ status: "error", message: errors.join(" / ") });
      setQueried(null);
      return;
    }
    setModelSuggestions((cur) => [...cur, ...sales.map((s) => s.model)]);
    const { rows, invalidDate } = selectPolicySales(sales, q);
    setQueried({ query: q, rows, invalidDate });
    setLoad({ status: "idle" });
  }

  async function onQuery() {
    if (inputError) return;
    if (edits.size > 0 && !window.confirm("저장하지 않은 수정 내용이 있습니다. 다시 조회하면 수정 내용이 사라집니다. 계속할까요?")) return;
    setEdits(new Map());
    setOpen(null);
    setResult(null);
    setSaveError(null);
    await runQuery({ ...query });
  }

  const byKey = useMemo(() => new Map(queried?.rows.map((s) => [saleKeyOf(s), s]) ?? []), [queried]);
  const pending = [...edits.entries()]
    .filter(([k, e]) => e.confirmed && byKey.has(k) && Object.keys(e.change).length > 0)
    .map(([k, e]) => ({ sale: byKey.get(k)!, change: e.change }));
  const pendingSig = JSON.stringify(pending.map((p) => [saleKeyOf(p.sale), p.change]));
  // 같은 수정 묶음이면 같은 요청 ID → 두 번 눌러도 두 번 저장되지 않는다
  const requestId = useMemo(() => newPolicyEditId(), [pendingSig]); // eslint-disable-line react-hooks/exhaustive-deps

  const totals = pending.reduce(
    (t, p) => {
      const d = changeDelta(policyValues(p.sale), p.change);
      return { benefit: t.benefit + d.benefit, other: t.other + d.other, second: t.second + d.second, total: t.total + d.total };
    },
    { benefit: 0, other: 0, second: 0, total: 0 },
  );

  function setInput(key: string, sale: PolicySale, field: PolicyKey, text: string) {
    setEdits((cur) => {
      const next = new Map(cur);
      const e = next.get(key) ?? { inputs: initialInputs(sale), confirmed: false, change: {} };
      const inputs = { ...e.inputs, [field]: text };
      next.set(key, { inputs, confirmed: false, change: changesFromInput(policyValues(sale), inputs).change });
      return next;
    });
  }

  function confirmEdit(key: string, sale: PolicySale) {
    const e = edits.get(key);
    if (!e) return;
    const { change, error } = changesFromInput(policyValues(sale), e.inputs);
    if (error) return;
    setEdits((cur) => {
      const next = new Map(cur);
      if (Object.keys(change).length === 0) next.delete(key);
      else next.set(key, { ...e, change, confirmed: true });
      return next;
    });
    setOpen(null);
  }

  function cancelEdit(key: string) {
    setEdits((cur) => {
      const next = new Map(cur);
      next.delete(key);
      return next;
    });
    setOpen(null);
  }

  async function save() {
    if (saving || pending.length === 0 || !queried) return;
    if (pending.length > POLICY_EDIT_MAX_ITEMS) {
      setSaveError(`한 번에 ${POLICY_EDIT_MAX_ITEMS}건까지 저장할 수 있습니다.`);
      return;
    }
    const lines = POLICY_FIELDS.map((f) => `· ${f.label}(${f.letter}열) ${signed(totals[f.key])}`).join("\n");
    const ok = window.confirm(
      `정책 확보금액 수정을 저장할까요?\n\n수정 판매 ${pending.length}건\n${lines}\n· 총 확보금액 변경 ${signed(totals.total)}\n\n` +
        "장표 R·S·T 칸에 바로 반영되고, 판매의 총 확보금액(N열)·최종 남은 예산과 매장 총예산이 같은 금액만큼 바뀝니다.\n변경 전 금액은 이력에 남아 되돌릴 수 있습니다.",
    );
    if (!ok) return;
    setSaving(true);
    setSaveError(null);
    const res = await postPolicyEditApply(requestId, pending.map((p) => toEditItem(p.sale, p.change)));
    setSaving(false);
    if (!res.ok || !res.result) {
      setSaveError(res.message);
      return;
    }
    setResult(res.result);
    // 성공한 판매의 수정 내용은 지우고(실패한 판매는 남겨 다시 확인), 장표를 다시 읽는다
    const okKeys = new Set(res.result.results.filter((r) => r.ok).map((r) => `${r.sheet}:${r.row}`));
    setEdits((cur) => {
      const next = new Map(cur);
      if (res.result!.repeated) next.clear();
      for (const k of okKeys) next.delete(k);
      return next;
    });
    setNotice(
      res.result.repeated
        ? "이미 처리된 요청입니다 (다시 저장하지 않음). 최신 금액으로 다시 조회했습니다."
        : `정책 확보금액 수정: ${res.result.applied}건 저장 (총 확보 ${signed(res.result.delta)})${res.result.failed ? `, ${res.result.failed}건 실패` : ""} — 최신 금액으로 다시 조회했습니다.`,
    );
    setHistoryKey((k) => k + 1);
    await runQuery(queried.query, true);
  }

  const staffGroups = useMemo(() => (queried ? groupPolicy(queried.rows, "staff") : []), [queried]);
  const modelGroups = useMemo(() => (queried ? groupPolicy(queried.rows, "model") : []), [queried]);
  const listTotal = queried?.rows.reduce(
    (t, s) => {
      const v = policyValues(s);
      return { benefit: t.benefit + (v.benefit ?? 0), other: t.other + (v.other ?? 0), second: t.second + (v.second ?? 0), total: t.total + policyTotal(v) };
    },
    { benefit: 0, other: 0, second: 0, total: 0 },
  );

  return (
    <div className="space-y-4">
      <section aria-label="정책 확보 조회 조건" className="rounded-xl border border-line bg-white p-4">
        <h2 className="text-sm font-bold text-ink">정책 확보 관리</h2>
        <p className="mt-1 text-xs text-ink-muted">
          카톡 판매보고 &lsquo;정책&rsquo;의 고객혜택(장표 T열)·그외(스팟제외)(S열 모델정책)·2ND연계정책(R열) 확보금액을 판매별로 확인하고, 틀린 금액만 고칩니다.
          새 예산을 추가하는 기능이 아니며, 고친 금액은 기존 수식대로 판매의 총 확보금액·매장 총예산·모델정책 정산에 반영됩니다.
        </p>
        <datalist id="policy-edit-models">
          {allModels.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
        <fieldset disabled={saving} className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-[9.5rem_9.5rem_1fr]">
          <label className="block text-xs font-semibold text-ink-sub">
            시작일
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={fieldClass} />
          </label>
          <label className="block text-xs font-semibold text-ink-sub">
            종료일
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={fieldClass} />
          </label>
          <div className="col-span-2 text-xs font-semibold text-ink-sub sm:col-span-1">
            조회 대상
            <div className="mt-1 flex flex-wrap items-center gap-3 py-1.5">
              <label className="flex items-center gap-1 font-normal text-ink">
                <input type="radio" name="policy-mode" checked={mode === "models"} onChange={() => setMode("models")} />
                특정 모델
              </label>
              <label className="flex items-center gap-1 font-normal text-ink">
                <input type="radio" name="policy-mode" checked={mode === "all"} onChange={() => setMode("all")} />
                기간 내 전체 판매
              </label>
            </div>
            {mode === "models" && (
              <input
                value={modelsText}
                onChange={(e) => setModelsText(e.target.value)}
                list="policy-edit-models"
                placeholder="예: A17 (여러 모델은 쉼표로: A17, A175)"
                className={fieldClass}
              />
            )}
          </div>
        </fieldset>
        {mode === "models" && allModels.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-1">
            <span className="text-[11px] text-ink-muted">모델 선택:</span>
            {allModels.slice(0, 40).map((m) => {
              const on = models.includes(m);
              return (
                <button
                  key={m}
                  type="button"
                  disabled={saving}
                  onClick={() => setModelsText((on ? models.filter((x) => x !== m) : [...models, m]).join(", "))}
                  className={`rounded-full border px-2 py-0.5 text-[11px] ${on ? "border-brand bg-brand text-white" : "border-line text-ink-sub hover:border-brand hover:text-brand"}`}
                >
                  {on ? "✓ " : "+ "}
                  {m}
                </button>
              );
            })}
          </div>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void onQuery()}
            disabled={!!inputError || load.status === "loading" || saving}
            className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-strong disabled:opacity-50"
          >
            {load.status === "loading" ? "조회 중…" : "정책 확보 내역 조회"}
          </button>
          <span className={`text-xs ${inputError ? "font-semibold text-rose-600" : "text-ink-muted"}`}>
            {inputError ?? "조회는 저장하지 않습니다. 시작일·종료일 모두 포함, 월을 넘어가도 됩니다. 모델명은 대소문자·공백을 맞춰 비교하며 A17 과 A175 는 다른 모델입니다."}
          </span>
        </div>
        {load.status === "error" && <p role="alert" className="mt-2 text-sm font-semibold text-rose-700">{load.message}</p>}
        {loadErrors.length > 0 && load.status !== "error" && (
          <p role="alert" className="mt-2 text-xs font-semibold text-amber-700">일부 월을 불러오지 못했습니다: {loadErrors.join(" / ")}</p>
        )}
      </section>

      {notice && (
        <p role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm font-semibold text-emerald-800">
          ✓ {notice}
        </p>
      )}

      {queried && (
        <section aria-label="정책 확보 내역" className="overflow-hidden rounded-xl border border-line bg-white">
          {queried.rows.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-ink-sub">조건에 맞는 판매가 없습니다.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1200px] text-sm">
                <caption className="border-b border-line px-4 py-2.5 text-left text-sm font-bold text-ink">
                  정책 확보 내역 {formatNumber(queried.rows.length)}건
                  <span className="ml-2 text-xs font-normal text-ink-muted">
                    {queried.query.from}~{queried.query.to} · {queried.query.models.length ? queried.query.models.join(", ") : "전체 모델"} · 빈칸 = 장표에 금액 없음(빈칸·-), 0원 = 실제 0
                  </span>
                </caption>
                <thead className="bg-zinc-50 text-xs text-ink-sub">
                  <tr>
                    <th scope="col" className="px-2 py-2.5 text-left font-semibold">개통일</th>
                    <th scope="col" className="px-2 py-2.5 text-left font-semibold">판매 월</th>
                    <th scope="col" className="px-2 py-2.5 text-left font-semibold">판매 No.</th>
                    <th scope="col" className="px-2 py-2.5 text-left font-semibold">직원명</th>
                    <th scope="col" className="px-2 py-2.5 text-left font-semibold">고객명</th>
                    <th scope="col" className="px-2 py-2.5 text-left font-semibold">모델명</th>
                    <th scope="col" className="px-2 py-2.5 text-left font-semibold">개통 요금제</th>
                    {POLICY_FIELDS.map((f) => (
                      <th key={f.key} scope="col" className="px-2 py-2.5 text-right font-semibold">
                        {f.label}
                        <span className="block text-[10px] font-normal">{f.letter}열</span>
                      </th>
                    ))}
                    <th scope="col" className="px-2 py-2.5 text-right font-semibold">세 정책 합계</th>
                    <th scope="col" className="px-2 py-2.5 text-center font-semibold">수정</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line tabular-nums text-ink">
                  {queried.rows.map((s) => {
                    const key = saleKeyOf(s);
                    const v = policyValues(s);
                    const e = edits.get(key);
                    const staged = e?.confirmed && Object.keys(e.change).length > 0;
                    const after = staged ? applied(v, e!.change) : v;
                    return (
                      <Fragment key={key}>
                        <tr className={staged ? "bg-amber-50/70" : open === key ? "bg-brand-soft/20" : undefined}>
                          <td className="px-2 py-2 whitespace-nowrap">{monthDayText(s.activatedAt)}</td>
                          <td className="px-2 py-2 whitespace-nowrap">{s.sheet}</td>
                          <td className="px-2 py-2 whitespace-nowrap">{s.no || <span className="font-semibold text-amber-700">없음</span>}</td>
                          <td className="px-2 py-2 whitespace-nowrap">{s.staff || "-"}</td>
                          <td className="px-2 py-2 whitespace-nowrap">{s.customer || "-"}</td>
                          <td className="px-2 py-2 whitespace-nowrap">{s.model || "-"}</td>
                          <td className="px-2 py-2 whitespace-nowrap">{s.plan || <span className="font-semibold text-amber-700">미입력</span>}</td>
                          {POLICY_FIELDS.map((f) => (
                            <td key={f.key} className="px-2 py-2 text-right whitespace-nowrap">
                              <Amount value={v[f.key]} />
                              {staged && e!.change[f.key] !== undefined && (
                                <span className="block text-xs font-semibold text-amber-800">→ {formatNumber(e!.change[f.key]!)}원</span>
                              )}
                            </td>
                          ))}
                          <td className="px-2 py-2 text-right whitespace-nowrap font-semibold">
                            <Amount value={policyTotal(v)} />
                            {staged && <span className="block text-xs font-semibold text-amber-800">→ {formatNumber(policyTotal(after))}원</span>}
                          </td>
                          <td className="px-2 py-2 text-center whitespace-nowrap">
                            <button
                              type="button"
                              disabled={saving}
                              onClick={() => setOpen(open === key ? null : key)}
                              aria-label={`${s.sheet} ${s.activatedAt} No.${s.no || "없음"} 정책 확보금액 수정`}
                              className="rounded-md border border-line bg-white px-2.5 py-1 text-xs font-semibold text-ink hover:bg-zinc-50 disabled:opacity-50"
                            >
                              {open === key ? "닫기" : staged ? "수정 중" : "수정"}
                            </button>
                          </td>
                        </tr>
                        {open === key && (
                          <tr>
                            <td colSpan={12} className="bg-brand-soft/10 px-3 py-3">
                              <EditBox
                                sale={s}
                                edit={edits.get(key)}
                                onInput={(field, text) => setInput(key, s, field, text)}
                                onConfirm={() => confirmEdit(key, s)}
                                onCancel={() => cancelEdit(key)}
                              />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
                {listTotal && (
                  <tfoot className="border-t-2 border-line bg-zinc-50 text-sm font-bold tabular-nums">
                    <tr>
                      <td colSpan={7} className="px-2 py-2.5">조회 합계 ({formatNumber(queried.rows.length)}건)</td>
                      <td className="px-2 py-2.5 text-right">{formatNumber(listTotal.benefit)}원</td>
                      <td className="px-2 py-2.5 text-right">{formatNumber(listTotal.other)}원</td>
                      <td className="px-2 py-2.5 text-right">{formatNumber(listTotal.second)}원</td>
                      <td className="px-2 py-2.5 text-right">{formatNumber(listTotal.total)}원</td>
                      <td />
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          )}

          {queried.invalidDate.length > 0 && (
            <div className="border-t border-amber-200 bg-amber-50/60 px-4 py-3 text-xs text-amber-900">
              <p className="font-bold">개통일을 읽지 못해 조회에서 빠진 판매 (장표 확인 필요)</p>
              <ul className="mt-1 space-y-0.5">
                {queried.invalidDate.map((x) => (
                  <li key={saleKeyOf(x)}>
                    {x.sheet} {x.row}행 · No.{x.no || "없음"} · {x.model || "-"} — 개통일 &lsquo;{x.activatedAt || "빈칸"}&rsquo;
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* 저장 대기 요약 + 저장 */}
          <div className="border-t border-line bg-brand-soft/20 px-4 py-3">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-5">
              <div>
                <dt className="text-xs text-ink-sub">수정 판매 (변경 확인)</dt>
                <dd className="font-bold tabular-nums">{formatNumber(pending.length)}건</dd>
              </div>
              {POLICY_FIELDS.map((f) => (
                <div key={f.key}>
                  <dt className="text-xs text-ink-sub">{f.label} 증감</dt>
                  <dd className="font-bold tabular-nums"><Delta value={totals[f.key]} /></dd>
                </div>
              ))}
              <div>
                <dt className="text-xs text-ink-sub">총 확보금액 변경 (= 매장 총예산 변경)</dt>
                <dd className="font-bold tabular-nums"><Delta value={totals.total} /></dd>
              </div>
            </dl>
            {saveError && (
              <p role="alert" className="mt-2 text-xs font-semibold text-rose-700">저장되지 않았습니다: {saveError}</p>
            )}
            {result && <ApplyResult result={result} />}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void save()}
                disabled={saving || pending.length === 0}
                className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-strong disabled:opacity-50"
              >
                {saving ? "저장 중… (창을 닫지 마세요)" : `수정 저장 (${formatNumber(pending.length)}건)`}
              </button>
              <span className="text-xs text-ink-muted">
                [수정] → 금액 입력 → [변경 확인]한 판매만 저장합니다. 저장 직전 장표의 최신 금액을 다시 확인해, 조회 후 다른 곳에서 바뀐 판매는 저장하지 않고 알려 드립니다.
              </span>
            </div>
          </div>

          {queried.rows.length > 0 && (
            <details className="border-t border-line px-4 py-3">
              <summary className="cursor-pointer text-sm font-semibold text-ink">직원별·모델별 비교</summary>
              <div className="mt-3 grid gap-4 lg:grid-cols-2">
                <GroupTable title="직원별" rows={staffGroups} />
                <GroupTable title="모델별" rows={modelGroups} />
              </div>
            </details>
          )}
        </section>
      )}

      <PolicyHistory
        refreshKey={historyKey}
        onUndone={(message) => {
          setNotice(message);
          if (queried) void runQuery(queried.query, true);
        }}
      />
    </div>
  );
}

function initialInputs(sale: PolicySale): Inputs {
  const v = policyValues(sale);
  return { benefit: v.benefit === null ? "" : String(v.benefit), other: v.other === null ? "" : String(v.other), second: v.second === null ? "" : String(v.second) };
}

function applied(v: ReturnType<typeof policyValues>, change: PolicyChange) {
  return {
    benefit: change.benefit ?? v.benefit,
    other: change.other ?? v.other,
    second: change.second ?? v.second,
  };
}

function signed(n: number): string {
  return `${n > 0 ? "+" : n < 0 ? "−" : ""}${formatNumber(Math.abs(n))}원`;
}

function EditBox({
  sale,
  edit,
  onInput,
  onConfirm,
  onCancel,
}: {
  sale: PolicySale;
  edit: Edit | undefined;
  onInput: (field: PolicyKey, text: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const before = policyValues(sale);
  const inputs = edit?.inputs ?? initialInputs(sale);
  const { change, error } = changesFromInput(before, inputs);
  const d = changeDelta(before, change);
  const afterTotal = policyTotal(applied(before, change));
  return (
    <div className="space-y-2">
      <p className="text-xs text-ink-sub">
        변경 대상: <b className="text-ink">{sale.sheet} {sale.activatedAt} · No.{sale.no || "없음"} · {sale.staff || "-"} · {sale.customer || "-"} · {sale.model || "-"}</b>
        {sale.saleId ? "" : " (판매 ID 없는 예전 판매 — 행·개통일·고객·CTN·모델로 확인)"}
      </p>
      <div className="grid gap-2 sm:grid-cols-3">
        {POLICY_FIELDS.map((f) => (
          <label key={f.key} className="block rounded-lg border border-line bg-white p-2.5 text-xs font-semibold text-ink-sub">
            {f.label} <span className="font-normal">({f.letter}열)</span>
            <span className="mt-1 block font-normal">
              기존 확보금액: <b className="text-ink"><Amount value={before[f.key]} /></b>
            </span>
            <input
              value={inputs[f.key] ?? ""}
              onChange={(e) => onInput(f.key, e.target.value)}
              inputMode="numeric"
              placeholder={before[f.key] === null ? "빈칸 (바꾸지 않음)" : "비우면 바꾸지 않음"}
              className={`${fieldClass} text-right tabular-nums`}
            />
            <span className="mt-1 block font-normal">
              차액: <Delta value={d[f.key]} /> {change[f.key] !== undefined && <span className="font-semibold text-amber-700">· 변경</span>}
            </span>
          </label>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span>
          세 정책 확보 합계: <b><Amount value={policyTotal(before)} /></b> → <b><Amount value={afterTotal} /></b> (<Delta value={d.total} />)
        </span>
        {error && <span className="text-xs font-semibold text-rose-600">{error}</span>}
        <span className="ml-auto flex gap-2">
          <button type="button" onClick={onCancel} className="rounded-lg border border-line bg-white px-3 py-1.5 text-xs font-semibold text-ink hover:bg-zinc-50">
            수정 취소
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={!!error}
            className="rounded-lg bg-ink px-3 py-1.5 text-xs font-semibold text-white hover:bg-zinc-800 disabled:opacity-50"
          >
            {Object.keys(change).length === 0 ? "변경 없음 (닫기)" : `변경 확인 (${Object.keys(change).length}항목)`}
          </button>
        </span>
      </div>
      <p className="text-[11px] text-ink-muted">금액은 30000, 30,000, 3만, 3만5천 형식으로 입력할 수 있습니다. 0 을 입력하면 0원으로 바뀝니다. 바꾼 항목만 저장되며 다른 칸은 그대로입니다.</p>
    </div>
  );
}

function ApplyResult({ result }: { result: PolicyEditApplyResult }) {
  const failed = result.results.filter((r) => !r.ok);
  return (
    <div role="status" className={`mt-2 rounded-lg border px-3 py-2 text-sm ${failed.length ? "border-amber-200 bg-amber-50" : "border-emerald-200 bg-emerald-50"}`}>
      <p className="font-bold text-ink">
        {result.repeated
          ? "이미 처리된 요청입니다 — 다시 저장하지 않았습니다."
          : `저장 성공 ${formatNumber(result.applied)}건 (총 확보 ${signed(result.delta)}) · 실패 ${formatNumber(result.failed)}건`}
      </p>
      {failed.length > 0 && (
        <ul className="mt-1 space-y-0.5 text-xs text-amber-900">
          {failed.map((f) => (
            <li key={`${f.sheet}:${f.row}`}>
              {f.sheet} {f.row}행: {f.message}
            </li>
          ))}
        </ul>
      )}
      {failed.length > 0 && <p className="mt-1 text-xs text-amber-900">실패한 판매의 수정 내용은 화면에 남겨 두었습니다. 다시 조회된 최신 금액을 확인한 뒤 다시 저장해 주세요.</p>}
    </div>
  );
}

function GroupTable({ title, rows }: { title: string; rows: ReturnType<typeof groupPolicy> }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[480px] text-xs tabular-nums">
        <caption className="pb-1 text-left text-xs font-bold text-ink">{title}</caption>
        <thead className="bg-zinc-50 text-ink-sub">
          <tr>
            <th className="px-2 py-1.5 text-left font-semibold">{title === "직원별" ? "직원" : "모델"}</th>
            <th className="px-2 py-1.5 text-right font-semibold">건수</th>
            {POLICY_FIELDS.map((f) => (
              <th key={f.key} className="px-2 py-1.5 text-right font-semibold">{f.label}</th>
            ))}
            <th className="px-2 py-1.5 text-right font-semibold">합계</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((g) => (
            <tr key={g.name}>
              <td className="px-2 py-1.5">{g.name}</td>
              <td className="px-2 py-1.5 text-right">{g.count}</td>
              <td className="px-2 py-1.5 text-right">{formatNumber(g.benefit)}</td>
              <td className="px-2 py-1.5 text-right">{formatNumber(g.other)}</td>
              <td className="px-2 py-1.5 text-right">{formatNumber(g.second)}</td>
              <td className="px-2 py-1.5 text-right font-semibold">{formatNumber(g.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PolicyHistory({ refreshKey, onUndone }: { refreshKey: number; onUndone: (message: string) => void }) {
  const [items, setItems] = useState<PolicyEditHistoryEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [seq, setSeq] = useState(0);
  useEffect(() => {
    let cancelled = false;
    void fetchPolicyEditHistory().then((r) => {
      if (cancelled) return;
      if (r.ok) {
        setItems(r.history ?? []);
        setError(null);
      } else setError(r.message);
    });
    return () => {
      cancelled = true;
    };
  }, [refreshKey, seq]);

  async function undo(h: PolicyEditHistoryEntry) {
    if (busy) return;
    if (
      !window.confirm(
        `이 수정을 되돌릴까요?\n\n${h.savedAt} · ${h.sales}건 · 총 확보 ${signed(h.delta)}\n\n변경 전 금액으로 돌립니다. 수정 후 R·S·T 금액이 다시 바뀐 판매는 건너뜁니다.`,
      )
    )
      return;
    setBusy(h.requestId);
    const r = await postPolicyEditUndo(h.requestId);
    setBusy(null);
    if (r.ok) {
      onUndone(`정책 확보금액 수정 되돌리기: ${r.message}`);
      if (r.undo && r.undo.skipped.length > 0) window.alert(`건너뛴 판매:\n${r.undo.skipped.join("\n")}`);
    } else window.alert(`되돌리지 못했습니다: ${r.message}`);
    setSeq((s) => s + 1);
  }

  return (
    <details className="rounded-xl border border-line bg-white px-4 py-3">
      <summary className="cursor-pointer text-sm font-semibold text-ink">
        최근 정책 확보금액 수정 이력 {items ? `${items.length}건` : ""} <span className="text-xs font-normal text-ink-muted">(변경 전 금액 보관 · 되돌리기)</span>
      </summary>
      {error && <p className="mt-2 text-xs text-ink-muted">수정 이력을 불러오지 못했습니다: {error}</p>}
      {items && items.length === 0 && <p className="mt-2 text-xs text-ink-muted">아직 수정 이력이 없습니다.</p>}
      {items && items.length > 0 && (
        <ul className="mt-2 divide-y divide-line text-sm">
          {items.map((h) => (
            <li key={h.requestId} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
              <span className="tabular-nums text-ink-sub">{h.savedAt}</span>
              <span className="font-semibold">{h.sales}건 · 총 확보 {signed(h.delta)}</span>
              <span className="text-xs text-ink-muted">
                고객혜택 {signed(h.benefit)} · 그외 {signed(h.other)} · 2ND연계 {signed(h.second)}
              </span>
              <span className={`text-xs font-semibold ${h.status === "적용" ? "text-emerald-700" : "text-ink-sub"}`}>{h.status}</span>
              {h.status !== "되돌림" && (
                <button
                  type="button"
                  onClick={() => void undo(h)}
                  disabled={busy !== null}
                  className="ml-auto rounded-md border border-line px-2.5 py-1 text-xs font-semibold text-ink hover:bg-zinc-50 disabled:opacity-50"
                >
                  {busy === h.requestId ? "되돌리는 중…" : "되돌리기"}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}
