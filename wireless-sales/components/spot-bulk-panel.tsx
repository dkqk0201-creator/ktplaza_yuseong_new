"use client";

import { useEffect, useMemo, useState } from "react";
import { formatNumber, todayInKorea } from "@/lib/format";
import { sheetForMonth } from "@/lib/month-sheet";
import { parseOtherAmount } from "@/lib/other-budget";
import { monthDayText } from "@/lib/sale-display";
import type { SheetSale } from "@/lib/sheet-record";
import { spotLabel } from "@/lib/spot";
import {
  SPOT_BULK_MAX_CONDITIONS,
  SPOT_BULK_MAX_ITEMS,
  buildBulkPreview,
  conditionError,
  conditionText,
  defaultSelection,
  monthsInRange,
  newSpotBulkId,
  normalizeModel,
  resolveSelection,
  summarize,
  toBulkItems,
  type BulkFlag,
  type BulkPreview,
  type BulkSale,
  type SpotBulkApplyResult,
  type SpotBulkHistoryEntry,
  type SpotCondition,
} from "@/lib/spot-bulk";
import { fetchSpotBulkHistory, postSpotBulkApply, postSpotBulkUndo } from "@/lib/spot-bulk-api";

/*
 * 스팟관리 화면 안의 "스팟 일괄등록" 영역 (별도 메뉴·페이지 없음).
 *   1) 조건 여러 줄 입력 (기간·대상(특정 모델/전체)·스팟 번호·건당 금액)
 *   2) [적용 대상 조회] → 기간에 걸친 월 시트를 읽어 미리보기 (저장 안 함)
 *   3) 개별 체크·해제 (기존 스팟·충돌·No. 없음은 기본 해제) → [최종 등록] 때만 저장
 *   4) 결과 안내 + 스팟별 집계 자동 갱신 (onApplied)
 */

interface Draft {
  id: string;
  from: string;
  to: string;
  mode: "all" | "models";
  modelsText: string;
  spotText: string;
  amountText: string;
}

const FLAG_LABEL: Record<BulkFlag, string> = {
  already: "이미 같은 스팟 등록",
  conflict: "조건 중복(충돌)",
  existing: "기존 스팟 있음(보호)",
  noNo: "판매 No. 없음",
};

let draftSeq = 0;
function newDraft(base?: Draft): Draft {
  draftSeq += 1;
  return {
    id: `c${Date.now().toString(36)}${draftSeq}`,
    from: base?.from ?? "",
    to: base?.to ?? "",
    mode: "models",
    modelsText: "",
    spotText: "",
    amountText: "",
  };
}

function toCondition(d: Draft): { condition: SpotCondition | null; error: string | null } {
  const models =
    d.mode === "all"
      ? []
      : [...new Set(d.modelsText.split(/[,，\n]/).map(normalizeModel).filter(Boolean))];
  if (d.mode === "models" && models.length === 0) return { condition: null, error: "적용할 모델을 입력하거나 '기간 내 전체 판매'를 선택해 주세요." };
  const spot = /^\s*\d{1,3}\s*$/.test(d.spotText) ? Number(d.spotText) : NaN;
  const amount = parseOtherAmount(d.amountText);
  const c: SpotCondition = { id: d.id, from: d.from, to: d.to, models, spot, amount: amount ?? NaN };
  const error = conditionError(c);
  return error ? { condition: null, error } : { condition: c, error: null };
}

type SalesLoad = { status: "idle" } | { status: "loading" } | { status: "error"; message: string };

async function loadSalesForMonths(months: string[]): Promise<{ sales: BulkSale[]; errors: string[] }> {
  const today = todayInKorea();
  const errors: string[] = [];
  const sales: BulkSale[] = [];
  await Promise.all(
    months.map(async (ym) => {
      const sheet = sheetForMonth(ym, today);
      if (!sheet) {
        errors.push(`${ym}: 최근 12개월 밖이라 월 시트로 찾을 수 없습니다.`);
        return;
      }
      try {
        const r = await fetch(`/api/sales/list?sheet=${encodeURIComponent(sheet)}`, { cache: "no-store" });
        const body = (await r.json()) as { ok?: boolean; sheet?: string; sales?: SheetSale[]; message?: string };
        if (body?.ok && body.sheet === sheet && Array.isArray(body.sales)) sales.push(...body.sales.map((s) => ({ ...s, sheet })));
        else errors.push(`${sheet}: ${body?.message || "불러오지 못했습니다."}`);
      } catch {
        errors.push(`${sheet}: 불러오지 못했습니다.`);
      }
    }),
  );
  return { sales, errors };
}

function Won({ value }: { value: number }) {
  return (
    <span className={value < 0 ? "text-rose-600" : undefined}>
      {formatNumber(value)}
      <span className="ml-0.5 text-xs font-normal text-ink-muted">원</span>
    </span>
  );
}

const fieldClass =
  "mt-1 w-full rounded-lg border border-line bg-white px-2.5 py-2 text-sm text-ink focus:border-brand focus:outline-none disabled:bg-zinc-50";

export function SpotBulkPanel({
  modelSuggestions,
  defaultMonth,
  onApplied,
  onClose,
}: {
  /** 지금 보고 있는 월의 모델 목록 (입력 도움) */
  modelSuggestions: string[];
  /** 지금 보고 있는 월 YYYY-MM (기간 기본값) */
  defaultMonth: string;
  /** 저장 후: 안내 문구 + 스팟별 집계 다시 불러오기 */
  onApplied: (message: string) => void;
  onClose: () => void;
}) {
  const [drafts, setDrafts] = useState<Draft[]>(() => {
    const d = newDraft();
    d.from = `${defaultMonth}-01`;
    d.to = `${defaultMonth}-01`;
    return [d];
  });
  const [load, setLoad] = useState<SalesLoad>({ status: "idle" });
  const [loadErrors, setLoadErrors] = useState<string[]>([]);
  const [queried, setQueried] = useState<{ preview: BulkPreview; conditions: SpotCondition[]; requestId: string } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [result, setResult] = useState<SpotBulkApplyResult | null>(null);
  const [extraModels, setExtraModels] = useState<string[]>([]);

  const checks = drafts.map(toCondition);
  const inputInvalid = checks.some((c) => c.error);

  // 조건을 바꾸면 이전 조회 결과는 버린다 (조회한 조건과 저장하는 조건이 항상 같게)
  const draftKey = JSON.stringify(drafts);
  useEffect(() => {
    setQueried(null);
    setResult(null);
    setSaveError(null);
  }, [draftKey]);

  const allModels = useMemo(
    () => [...new Set([...modelSuggestions, ...extraModels].map(normalizeModel).filter(Boolean))].sort(),
    [modelSuggestions, extraModels],
  );

  const update = (id: string, patch: Partial<Draft>) =>
    setDrafts((cur) => cur.map((d) => (d.id === id ? { ...d, ...patch } : d)));

  async function query() {
    if (inputInvalid) return;
    const conditions = checks.map((c) => c.condition!);
    const months = [...new Set(conditions.flatMap((c) => monthsInRange(c.from, c.to)))].sort();
    setLoad({ status: "loading" });
    setResult(null);
    setSaveError(null);
    const { sales, errors } = await loadSalesForMonths(months);
    setLoadErrors(errors);
    if (errors.length > 0 && sales.length === 0) {
      setLoad({ status: "error", message: errors.join(" / ") });
      setQueried(null);
      return;
    }
    setExtraModels(sales.map((s) => s.model).filter(Boolean));
    const preview = buildBulkPreview(sales, conditions);
    setQueried({ preview, conditions, requestId: newSpotBulkId() });
    setSelected(defaultSelection(preview));
    setLoad({ status: "idle" });
  }

  const resolved = queried ? resolveSelection(queried.preview, selected) : null;
  const summary = queried && resolved ? summarize(queried.preview, resolved) : null;
  const afterBySale = new Map(resolved?.choices.map((c) => [c.saleKey, c]) ?? []);

  async function save() {
    if (!queried || !resolved || !summary || saving) return;
    if (resolved.errors.length > 0 || resolved.choices.length === 0) return;
    if (resolved.choices.length > SPOT_BULK_MAX_ITEMS) {
      setSaveError(`한 번에 ${SPOT_BULK_MAX_ITEMS}건까지 등록할 수 있습니다. 기간을 나눠 주세요.`);
      return;
    }
    const ok = window.confirm(
      `스팟 일괄등록을 저장할까요?\n\n적용 대상 ${summary.targetSales}건 · 총 적용 금액 ${formatNumber(summary.totalAmount)}원\n` +
        `(기존 스팟이 있는 판매 중 체크한 판매: ${resolved.choices.filter((c) => c.beforeO !== 0 || c.beforeNote).length}건)\n\n` +
        "장표 O열 금액과 메모에 바로 반영됩니다. 변경 전 값은 이력에 남아 되돌릴 수 있습니다.",
    );
    if (!ok) return;
    setSaving(true);
    setSaveError(null);
    // 같은 미리보기에서 다시 눌러도 같은 요청 ID → 두 번 저장되지 않는다
    const res = await postSpotBulkApply(queried.requestId, queried.conditions, toBulkItems(resolved.choices));
    setSaving(false);
    if (!res.ok || !res.result) {
      setSaveError(res.message);
      return;
    }
    setResult(res.result);
    onApplied(
      res.result.repeated
        ? "이미 처리된 일괄등록입니다 (다시 저장하지 않음)."
        : `스팟 일괄등록: ${res.result.applied}건 적용 (${formatNumber(res.result.amount)}원)${res.result.failed ? `, ${res.result.failed}건 실패` : ""}`,
    );
  }

  const toggle = (key: string) =>
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <section aria-label="스팟 일괄등록" className="overflow-hidden rounded-xl border border-brand/30 bg-white">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line bg-brand-soft/30 px-4 py-3">
        <h3 className="text-sm font-bold text-ink">스팟 일괄등록</h3>
        <span className="text-xs text-ink-muted">기간·모델 조건 → 적용 대상 조회 → 확인 후 최종 등록 (O열 금액 + 메모 &ldquo;스팟N 금액&rdquo;)</span>
        <button type="button" onClick={onClose} className="ml-auto text-xs font-medium text-ink-sub underline underline-offset-2">
          닫기
        </button>
      </div>

      {/* 1) 조건 */}
      <div className="space-y-3 px-4 py-4">
        <datalist id="spot-bulk-models">
          {allModels.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
        {drafts.map((d, i) => {
          const err = checks[i].error;
          return (
            <fieldset key={d.id} className="rounded-lg border border-line p-3" disabled={saving}>
              <legend className="px-1 text-xs font-bold text-ink-sub">조건 {i + 1}</legend>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-[9.5rem_9.5rem_1fr_6rem_8rem]">
                <label className="block text-xs font-semibold text-ink-sub">
                  시작일
                  <input type="date" value={d.from} onChange={(e) => update(d.id, { from: e.target.value })} className={fieldClass} />
                </label>
                <label className="block text-xs font-semibold text-ink-sub">
                  종료일
                  <input type="date" value={d.to} onChange={(e) => update(d.id, { to: e.target.value })} className={fieldClass} />
                </label>
                <div className="col-span-2 text-xs font-semibold text-ink-sub sm:col-span-1">
                  적용 대상
                  <div className="mt-1 flex flex-wrap items-center gap-3 py-1.5">
                    <label className="flex items-center gap-1 font-normal text-ink">
                      <input type="radio" name={`mode-${d.id}`} checked={d.mode === "models"} onChange={() => update(d.id, { mode: "models" })} />
                      특정 모델
                    </label>
                    <label className="flex items-center gap-1 font-normal text-ink">
                      <input type="radio" name={`mode-${d.id}`} checked={d.mode === "all"} onChange={() => update(d.id, { mode: "all" })} />
                      기간 내 전체 판매
                    </label>
                  </div>
                  {d.mode === "models" && (
                    <input
                      value={d.modelsText}
                      onChange={(e) => update(d.id, { modelsText: e.target.value })}
                      list="spot-bulk-models"
                      placeholder="예: A17 (여러 모델은 쉼표로: A17, S26)"
                      className={fieldClass}
                    />
                  )}
                </div>
                <label className="block text-xs font-semibold text-ink-sub">
                  스팟 번호
                  <input value={d.spotText} onChange={(e) => update(d.id, { spotText: e.target.value })} inputMode="numeric" placeholder="1" className={`${fieldClass} text-right`} />
                </label>
                <label className="block text-xs font-semibold text-ink-sub">
                  건당 금액
                  <input value={d.amountText} onChange={(e) => update(d.id, { amountText: e.target.value })} inputMode="numeric" placeholder="30000 또는 3만" className={`${fieldClass} text-right tabular-nums`} />
                </label>
              </div>
              {d.mode === "models" && allModels.length > 0 && (
                <div className="mt-2 flex flex-wrap items-center gap-1">
                  <span className="text-[11px] text-ink-muted">모델 목록:</span>
                  {allModels.slice(0, 30).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => {
                        const cur = d.modelsText.split(/[,，\n]/).map(normalizeModel).filter(Boolean);
                        if (!cur.includes(m)) update(d.id, { modelsText: [...cur, m].join(", ") });
                      }}
                      className="rounded-full border border-line px-2 py-0.5 text-[11px] text-ink-sub hover:border-brand hover:text-brand"
                    >
                      + {m}
                    </button>
                  ))}
                </div>
              )}
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                {err ? <span className="font-semibold text-rose-600">{err}</span> : <span className="text-ink-muted">{conditionText(checks[i].condition!)}</span>}
                {drafts.length > 1 && (
                  <button type="button" onClick={() => setDrafts((cur) => cur.filter((x) => x.id !== d.id))} className="ml-auto text-rose-700 underline underline-offset-2">
                    조건 삭제
                  </button>
                )}
              </div>
            </fieldset>
          );
        })}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setDrafts((cur) => [...cur, newDraft(cur[cur.length - 1])])}
            disabled={drafts.length >= SPOT_BULK_MAX_CONDITIONS || saving}
            className="rounded-lg border border-line bg-white px-3 py-2 text-sm font-semibold text-ink hover:bg-zinc-50 disabled:opacity-50"
          >
            + 조건 추가
          </button>
          <button
            type="button"
            onClick={() => void query()}
            disabled={inputInvalid || load.status === "loading" || saving}
            className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-strong disabled:opacity-50"
          >
            {load.status === "loading" ? "조회 중…" : "적용 대상 조회"}
          </button>
          <span className="text-xs text-ink-muted">조회는 저장하지 않습니다. 시작일·종료일 모두 포함, 월을 넘어가도 됩니다.</span>
        </div>
        {load.status === "error" && <p role="alert" className="text-sm font-semibold text-rose-700">{load.message}</p>}
        {loadErrors.length > 0 && load.status !== "error" && (
          <p role="alert" className="text-xs font-semibold text-amber-700">일부 월을 불러오지 못했습니다: {loadErrors.join(" / ")}</p>
        )}
      </div>

      {/* 2) 미리보기 */}
      {queried && summary && resolved && (
        <div className="border-t border-line">
          {queried.preview.rows.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-ink-sub">조건에 맞는 판매가 없습니다.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[980px] text-sm">
                <caption className="border-b border-line px-4 py-2.5 text-left text-sm font-bold text-ink">
                  적용 대상 미리보기
                  <span className="ml-2 text-xs font-normal text-ink-muted">체크한 판매만 저장 · 기존 스팟·충돌·No. 없음은 기본 해제(확인 후 직접 체크)</span>
                </caption>
                <thead className="bg-zinc-50 text-xs text-ink-sub">
                  <tr>
                    <th scope="col" className="px-2 py-2.5 text-center font-semibold">선택</th>
                    <th scope="col" className="px-2 py-2.5 text-left font-semibold">개통일</th>
                    <th scope="col" className="px-2 py-2.5 text-left font-semibold">판매 No.</th>
                    <th scope="col" className="px-2 py-2.5 text-left font-semibold">직원명</th>
                    <th scope="col" className="px-2 py-2.5 text-left font-semibold">모델명</th>
                    <th scope="col" className="px-2 py-2.5 text-left font-semibold">기존 스팟</th>
                    <th scope="col" className="px-2 py-2.5 text-left font-semibold">신규 스팟</th>
                    <th scope="col" className="px-2 py-2.5 text-right font-semibold">적용 금액</th>
                    <th scope="col" className="px-2 py-2.5 text-right font-semibold">변경 후 금액</th>
                    <th scope="col" className="px-2 py-2.5 text-left font-semibold">적용 여부</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line tabular-nums text-ink">
                  {queried.preview.rows.map((r) => {
                    const checked = selected.has(r.key) && r.selectable;
                    const after = afterBySale.get(r.saleKey);
                    const conflictBad = resolved.errors.length > 0 && checked && r.flags.includes("conflict");
                    const status = !r.selectable || !checked ? "제외" : r.flags.includes("conflict") ? "충돌(승인)" : "적용";
                    return (
                      <tr key={r.key} className={`align-top ${checked ? "" : "bg-zinc-50/60 text-ink-sub"} ${r.flags.includes("conflict") ? "bg-amber-50/60" : ""}`}>
                        <td className="px-2 py-2 text-center">
                          <input
                            type="checkbox"
                            aria-label={`${r.sale.activatedAt} No.${r.sale.no || "없음"} ${spotLabel(r.condition.spot)} 적용`}
                            checked={checked}
                            disabled={!r.selectable || saving || !!result}
                            onChange={() => toggle(r.key)}
                          />
                        </td>
                        <td className="px-2 py-2 whitespace-nowrap">
                          {monthDayText(r.sale.activatedAt)}
                          <span className="block text-[11px] text-ink-muted">{r.sale.sheet}</span>
                        </td>
                        <td className="px-2 py-2 whitespace-nowrap">{r.sale.no || <span className="font-semibold text-amber-700">없음</span>}</td>
                        <td className="px-2 py-2 whitespace-nowrap">{r.sale.staff || "-"}</td>
                        <td className="px-2 py-2 whitespace-nowrap">{r.sale.model || "-"}</td>
                        <td className="px-2 py-2">
                          {r.sale.spot || r.sale.spotNote ? (
                            <>
                              <Won value={r.sale.spot ?? 0} />
                              {r.sale.spotNote && <pre className="font-sans text-[11px] whitespace-pre-wrap text-ink-sub">{r.sale.spotNote}</pre>}
                            </>
                          ) : (
                            <span className="text-ink-muted">없음</span>
                          )}
                        </td>
                        <td className="px-2 py-2 whitespace-nowrap font-semibold">
                          {spotLabel(r.condition.spot)}
                          <span className="block text-[11px] font-normal text-ink-muted">조건 {r.conditionIndex + 1}</span>
                        </td>
                        <td className="px-2 py-2 text-right whitespace-nowrap"><Won value={r.condition.amount} /></td>
                        <td className="px-2 py-2 text-right whitespace-nowrap font-semibold">
                          {after ? <Won value={after.afterO} /> : <Won value={r.sale.spot ?? 0} />}
                        </td>
                        <td className="px-2 py-2">
                          <span className={`font-semibold ${status === "적용" ? "text-emerald-700" : status === "제외" ? "text-ink-sub" : "text-amber-700"}`}>{status}</span>
                          {r.flags.map((f) => (
                            <span key={f} className={`block text-[11px] ${f === "already" || f === "conflict" ? "text-rose-600" : "text-amber-700"}`}>
                              {FLAG_LABEL[f]}
                            </span>
                          ))}
                          {conflictBad && <span className="block text-[11px] text-rose-600">같은 스팟 번호 중복 선택</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {(queried.preview.excluded.length > 0 || queried.preview.invalidDate.length > 0) && (
            <div className="border-t border-amber-200 bg-amber-50/60 px-4 py-3 text-xs text-amber-900">
              <p className="font-bold">적용 제외 판매 (조용히 빠지지 않도록 표시)</p>
              <ul className="mt-1 space-y-0.5">
                {[...queried.preview.excluded, ...queried.preview.invalidDate].map((x) => (
                  <li key={`${x.sale.sheet}:${x.sale.row}`}>
                    {x.sale.sheet} {x.sale.activatedAt || "(개통일 없음)"} · No.{x.sale.no || "없음"} · {x.sale.model || "-"} — {x.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* 요약 */}
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 border-t border-line bg-brand-soft/20 px-4 py-3 text-sm sm:grid-cols-4">
            {[
              ["조건에 맞는 총 판매", `${formatNumber(summary.matchedSales)}건`],
              ["실제 적용 대상", `${formatNumber(summary.targetSales)}건`],
              ["기존 스팟 등록 판매", `${formatNumber(summary.existingSales)}건`],
              ["중복 조건·충돌", `${formatNumber(summary.conflictSales)}건${summary.alreadyRows ? ` · 이미 등록 ${summary.alreadyRows}줄` : ""}`],
              ["제외", `${formatNumber(summary.excludedSales)}건${summary.noNoSales ? ` (No. 없음 ${summary.noNoSales}건 포함 가능)` : ""}`],
              ["총 적용 금액", `${formatNumber(summary.totalAmount)}원`],
              ["기존 대비 예산 증감", `+${formatNumber(summary.totalAmount)}원 (대상 O열 ${formatNumber(summary.beforeTotal)} → ${formatNumber(summary.afterTotal)})`],
              ["개통일 오류", `${formatNumber(queried.preview.invalidDate.length)}건`],
            ].map(([k, v]) => (
              <div key={k}>
                <dt className="text-xs text-ink-sub">{k}</dt>
                <dd className="font-bold tabular-nums text-ink">{v}</dd>
              </div>
            ))}
          </dl>

          {resolved.errors.length > 0 && (
            <ul role="alert" className="border-t border-rose-200 bg-rose-50 px-4 py-2 text-xs font-semibold text-rose-700">
              {resolved.errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          )}
          {saveError && (
            <p role="alert" className="border-t border-rose-200 bg-rose-50 px-4 py-2 text-xs font-semibold text-rose-700">
              저장되지 않았습니다: {saveError}
            </p>
          )}
          {result && <ApplyResult result={result} />}

          <div className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-3">
            {!result ? (
              <button
                type="button"
                onClick={() => void save()}
                disabled={saving || resolved.choices.length === 0 || resolved.errors.length > 0}
                className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-strong disabled:opacity-50"
              >
                {saving ? "저장 중… (창을 닫지 마세요)" : `최종 등록 (${formatNumber(resolved.choices.length)}건)`}
              </button>
            ) : (
              <button type="button" onClick={() => void query()} className="rounded-lg border border-line bg-white px-4 py-2 text-sm font-semibold text-ink hover:bg-zinc-50">
                다시 조회 (반영 결과 확인)
              </button>
            )}
            <span className="text-xs text-ink-muted">저장 직전 Apps Script 가 판매·기존 금액·메모를 다시 확인합니다. 다른 칸·수식은 바꾸지 않습니다.</span>
          </div>
        </div>
      )}

      <SpotBulkHistory refreshKey={result?.requestId ?? ""} onUndone={onApplied} />
    </section>
  );
}

function ApplyResult({ result }: { result: SpotBulkApplyResult }) {
  const failed = result.results.filter((r) => !r.ok);
  return (
    <div role="status" className={`border-t px-4 py-3 text-sm ${failed.length ? "border-amber-200 bg-amber-50" : "border-emerald-200 bg-emerald-50"}`}>
      <p className="font-bold text-ink">
        {result.repeated
          ? "이미 처리된 요청입니다 — 다시 저장하지 않았습니다."
          : `성공 ${formatNumber(result.applied)}건 (${formatNumber(result.amount)}원) · 실패 ${formatNumber(result.failed)}건`}
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
    </div>
  );
}

function SpotBulkHistory({ refreshKey, onUndone }: { refreshKey: string; onUndone: (message: string) => void }) {
  const [items, setItems] = useState<SpotBulkHistoryEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [seq, setSeq] = useState(0);
  useEffect(() => {
    let cancelled = false;
    void fetchSpotBulkHistory().then((r) => {
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

  async function undo(h: SpotBulkHistoryEntry) {
    if (busy) return;
    if (!window.confirm(`이 일괄등록을 되돌릴까요?\n\n${h.appliedAt} · ${h.sales}건 · ${formatNumber(h.amount)}원\n${h.conditions}\n\n등록 후 O열 금액·메모가 바뀐 판매는 건너뜁니다.`)) return;
    setBusy(h.requestId);
    const r = await postSpotBulkUndo(h.requestId);
    setBusy(null);
    if (r.ok) {
      onUndone(`스팟 일괄등록 되돌리기: ${r.message}`);
      if (r.undo && r.undo.skipped.length > 0) window.alert(`건너뛴 판매:\n${r.undo.skipped.join("\n")}`);
    } else window.alert(`되돌리지 못했습니다: ${r.message}`);
    setSeq((s) => s + 1);
  }

  if (error) return <p className="border-t border-line px-4 py-3 text-xs text-ink-muted">최근 일괄등록 이력을 불러오지 못했습니다: {error}</p>;
  if (!items || items.length === 0) return null;
  return (
    <details className="border-t border-line px-4 py-3">
      <summary className="cursor-pointer text-xs font-semibold text-ink-sub">최근 일괄등록 이력 {items.length}건 (변경 전 금액·메모 보관 · 되돌리기)</summary>
      <ul className="mt-2 divide-y divide-line text-xs">
        {items.map((h) => (
          <li key={h.requestId} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
            <span className="tabular-nums text-ink-sub">{h.appliedAt}</span>
            <span className="font-semibold text-ink">{h.sales}건 · {formatNumber(h.amount)}원</span>
            <span className="min-w-0 break-all text-ink-sub">{h.conditions}</span>
            <span className={h.status === "적용" ? "text-emerald-700" : "text-ink-muted"}>{h.status}</span>
            {h.status !== "되돌림" && (
              <button type="button" onClick={() => void undo(h)} disabled={!!busy} className="ml-auto rounded border border-rose-300 px-2 py-0.5 font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50">
                {busy === h.requestId ? "되돌리는 중…" : "되돌리기"}
              </button>
            )}
          </li>
        ))}
      </ul>
    </details>
  );
}
