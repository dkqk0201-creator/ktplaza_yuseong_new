"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSalesData } from "@/components/sales-data-provider";
import { StatusBadge } from "@/components/work-ui";
import {
  QUICK_FIELDS,
  STAFF_REPORT_TEMPLATE,
  normalizeQuick,
  parseQuickReports,
  saleDuplicateKey,
  type QuickFieldId,
  type QuickFields,
  type QuickNormalized,
} from "@/lib/quick-report";
import { COLUMN_LABEL, COLUMN_LETTER } from "@/lib/sheet-columns";
import type { SaveSaleResponse } from "@/lib/save-sale-api";

/*
 * 간편등록: 붙여넣기 → 분석 → 검수(수정) → 등록 버튼 → 장표 저장.
 * 분석만으로는 절대 저장하지 않는다. 등록 완료된 건은 다시 보내지 않는다.
 */

type Submit =
  | { state: "idle" }
  | { state: "saving" }
  | { state: "done"; sheet: string; no: string }
  | { state: "failed"; message: string; errors?: string[] };

interface Item {
  id: number;
  fields: QuickFields;
  unknownLines: string[];
  repeatedFields: QuickFieldId[];
  submit: Submit;
  /** 점장이 "중복 아님"을 확인한 경우 */
  allowDuplicate: boolean;
}

type Status = "ready" | "issue" | "duplicate" | "saving" | "done" | "failed";

const STATUS_TEXT: Record<Status, string> = {
  ready: "등록 가능",
  issue: "확인 필요",
  duplicate: "중복 가능성",
  saving: "등록 중",
  done: "등록 완료",
  failed: "등록 실패",
};

const STATUS_TONE: Record<Status, "warn" | "good" | "muted"> = {
  ready: "good",
  issue: "warn",
  duplicate: "warn",
  saving: "muted",
  done: "good",
  failed: "warn",
};

async function postQuick(fields: QuickFields): Promise<SaveSaleResponse> {
  try {
    const response = await fetch("/api/sales/quick", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fields }),
    });
    const body = (await response.json()) as SaveSaleResponse;
    if (typeof body?.ok !== "boolean") throw new Error("invalid");
    return body;
  } catch {
    return {
      ok: false,
      message:
        "서버와 통신하지 못했습니다. 장표에 저장되었는지 확인한 뒤 다시 시도해 주세요.",
    };
  }
}

export function QuickRegister({
  today,
  staffNames,
}: {
  today: string;
  staffNames: string[];
}) {
  const {
    data,
    selectedSheet,
    selectSheet,
    ensureFresh,
    refresh,
    invalidate,
    loading,
    error,
  } = useSalesData();
  const [text, setText] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [copied, setCopied] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const runningRef = useRef(false);
  const nextId = useRef(1);

  // 저장은 항상 이번 달 시트로 들어가므로, 중복 확인도 이번 달 시트 기준
  const currentSheet = `${Number(today.slice(5, 7))}월`;
  useEffect(() => {
    if (selectedSheet !== currentSheet) selectSheet(currentSheet);
    else ensureFresh();
  }, [selectedSheet, currentSheet, selectSheet, ensureFresh]);
  const sheetReady = data?.sheet === currentSheet;

  const existingKeys = useMemo(
    () =>
      new Set(
        sheetReady
          ? data!.sales.map((s) => saleDuplicateKey(s.activatedAt, s.ctn))
          : [],
      ),
    [data, sheetReady],
  );

  const normalized = useMemo(
    () =>
      new Map(
        items.map((item) => [
          item.id,
          normalizeQuick(item.fields, { today, staffNames }),
        ]),
      ),
    [items, today, staffNames],
  );

  /** 붙여넣은 글 안에서 같은 개통일+CTN 이 2번 이상 나오는 키 */
  const batchDuplicateKeys = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of items) {
      const key = normalized.get(item.id)?.duplicateKey;
      if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return new Set([...counts].filter(([, n]) => n > 1).map(([k]) => k));
  }, [items, normalized]);

  function duplicateReason(item: Item, n: QuickNormalized): string | null {
    if (!n.duplicateKey || item.submit.state === "done") return null;
    if (batchDuplicateKeys.has(n.duplicateKey))
      return "붙여넣은 내용 안에 같은 개통일·CTN 판매가 또 있습니다.";
    if (existingKeys.has(n.duplicateKey))
      return "이번 달 장표에 같은 개통일·CTN 판매가 이미 있습니다.";
    return null;
  }

  function statusOf(item: Item): Status {
    const n = normalized.get(item.id)!;
    if (item.submit.state === "done") return "done";
    if (item.submit.state === "saving") return "saving";
    if (n.issues.length > 0 || item.repeatedFields.length > 0) return "issue";
    if (duplicateReason(item, n) && !item.allowDuplicate) return "duplicate";
    if (item.submit.state === "failed") return "failed";
    return "ready";
  }

  function analyze() {
    const reports = parseQuickReports(text);
    const added = reports.map((r) => ({
      id: nextId.current++,
      fields: r.fields,
      unknownLines: r.unknownLines,
      repeatedFields: r.repeatedFields,
      submit: { state: "idle" } as Submit,
      allowDuplicate: false,
    }));
    const pending = items.filter((i) => i.submit.state !== "done").length;
    if (
      pending > 0 &&
      !window.confirm(
        `아직 등록하지 않은 ${pending}건의 분석 결과(수정 내용 포함)를 지우고 새로 분석할까요?`,
      )
    ) {
      return;
    }
    // 등록 완료 건은 기록으로 남기고(다시 보내지 않음), 나머지는 새 분석 결과로 바꾼다
    setItems((prev) => [
      ...prev.filter((i) => i.submit.state === "done"),
      ...added,
    ]);
    void refresh(); // 중복 확인을 위해 장표 최신 내용 확인
  }

  function updateItem(id: number, update: (item: Item) => Item) {
    setItems((prev) => prev.map((i) => (i.id === id ? update(i) : i)));
  }

  // register 루프 안에서 최신 items 를 읽기 위한 참조
  const itemsRef = useRef(items);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  async function register(targets: number[]) {
    if (runningRef.current || targets.length === 0) return;
    runningRef.current = true;
    setRunning(true);
    let saved = 0;
    for (const id of targets) {
      const item = itemsRef.current.find((i) => i.id === id);
      // 등록 완료·등록 중인 건은 절대 다시 보내지 않는다
      if (
        !item ||
        item.submit.state === "done" ||
        item.submit.state === "saving"
      )
        continue;
      updateItem(id, (i) => ({ ...i, submit: { state: "saving" } }));
      const result = await postQuick(item.fields);
      if (result.ok) {
        saved++;
        updateItem(id, (i) => ({
          ...i,
          submit: { state: "done", sheet: result.sheet, no: result.no },
        }));
      } else {
        updateItem(id, (i) => ({
          ...i,
          submit: {
            state: "failed",
            message: result.message,
            errors: result.errors,
          },
        }));
      }
    }
    runningRef.current = false;
    setRunning(false);
    if (saved > 0) void invalidate(); // 검수관리·카드실적·예산관리가 최신 장표를 보도록
  }

  async function copyTemplate() {
    try {
      await navigator.clipboard.writeText(STAFF_REPORT_TEMPLATE);
      setCopied(
        "직원용 보고 양식을 복사했습니다. 카카오톡에 붙여넣어 보내세요.",
      );
    } catch {
      setCopied(
        "자동 복사가 안 되는 환경입니다. 아래 양식을 길게 눌러 직접 복사해 주세요.",
      );
    }
  }

  const statuses = items.map((i) => statusOf(i));
  const readyIds = items
    .filter((_, idx) => statuses[idx] === "ready")
    .map((i) => i.id);
  const count = (s: Status) => statuses.filter((x) => x === s).length;

  return (
    <div className="space-y-5">
      <section className="rounded-xl border border-line bg-white p-4 sm:p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-bold text-ink">
            카톡 판매보고 붙여넣기
          </h2>
          <button
            type="button"
            onClick={copyTemplate}
            className="h-9 rounded-lg border border-line px-3 text-sm font-semibold text-ink-sub hover:bg-zinc-50"
          >
            직원용 보고 양식 복사
          </button>
        </div>
        {copied && (
          <div
            className="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800"
            role="status"
          >
            {copied}
            {copied.startsWith("자동 복사가") && (
              <pre className="mt-2 rounded bg-white p-2 text-xs whitespace-pre-wrap text-ink">
                {STAFF_REPORT_TEMPLATE}
              </pre>
            )}
          </div>
        )}
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          aria-label="카톡 판매보고 내용"
          placeholder={
            "직원들이 카카오톡으로 보낸 판매보고를 그대로 붙여넣으세요.\n여러 건을 한꺼번에 붙여넣어도 '개통일자 :' 줄마다 나눠 분석합니다."
          }
          className="min-h-56 w-full resize-y rounded-lg border border-line px-3 py-2.5 font-mono text-sm leading-relaxed outline-none focus:border-brand focus:ring-2 focus:ring-brand/15"
        />
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={analyze}
            disabled={!text.trim() || running}
            className="h-11 rounded-lg bg-ink px-5 text-[15px] font-bold text-white disabled:opacity-50"
          >
            판매내용 분석하기
          </button>
          <span className="text-xs text-ink-muted">
            분석만으로는 장표에 저장되지 않습니다. 검수 후 등록 버튼을 눌러야
            저장됩니다.
          </span>
        </div>
      </section>

      {items.length > 0 && (
        <>
          <section className="sticky top-14 z-10 rounded-xl border border-line bg-white/95 p-3 shadow-sm backdrop-blur md:top-2 sm:p-4">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-bold text-ink">분석 {items.length}건</span>
              {(
                ["ready", "issue", "duplicate", "failed", "done"] as Status[]
              ).map((s) =>
                count(s) > 0 ? (
                  <StatusBadge key={s} tone={STATUS_TONE[s]}>
                    {STATUS_TEXT[s]} {count(s)}
                  </StatusBadge>
                ) : null,
              )}
              {!sheetReady && (
                <span className="text-xs text-rose-600">
                  {loading
                    ? "중복 확인용 장표 조회 중..."
                    : error
                      ? `중복 확인용 장표 조회 실패: ${error}`
                      : ""}
                </span>
              )}
              <button
                type="button"
                onClick={() => void register(readyIds)}
                disabled={running || readyIds.length === 0 || !sheetReady}
                className="ml-auto h-10 rounded-lg bg-brand px-4 text-sm font-bold text-white disabled:opacity-50"
              >
                {running
                  ? "등록 중..."
                  : `정상 건 일괄 등록 (${readyIds.length})`}
              </button>
            </div>
            {!sheetReady && !loading && (
              <p className="mt-1 text-xs text-ink-muted">
                이번 달 장표를 불러와 중복을 확인한 뒤에 등록할 수 있습니다.
              </p>
            )}
          </section>

          <ol className="space-y-4">
            {items.map((item, index) => (
              <QuickItemCard
                key={item.id}
                index={index + 1}
                item={item}
                status={statuses[index]}
                normalized={normalized.get(item.id)!}
                duplicateReason={duplicateReason(
                  item,
                  normalized.get(item.id)!,
                )}
                running={running}
                canRegister={sheetReady}
                onChange={(id, value) =>
                  updateItem(item.id, (i) => ({
                    ...i,
                    fields: { ...i.fields, [id]: value },
                    repeatedFields: i.repeatedFields.filter((f) => f !== id),
                  }))
                }
                onAllowDuplicate={(allow) =>
                  updateItem(item.id, (i) => ({ ...i, allowDuplicate: allow }))
                }
                onRegister={() => void register([item.id])}
                onRemove={() =>
                  setItems((prev) => prev.filter((i) => i.id !== item.id))
                }
              />
            ))}
          </ol>
        </>
      )}
    </div>
  );
}

function QuickItemCard({
  index,
  item,
  status,
  normalized,
  duplicateReason,
  running,
  canRegister,
  onChange,
  onAllowDuplicate,
  onRegister,
  onRemove,
}: {
  index: number;
  item: Item;
  status: Status;
  normalized: QuickNormalized;
  duplicateReason: string | null;
  running: boolean;
  canRegister: boolean;
  onChange: (id: QuickFieldId, value: string) => void;
  onAllowDuplicate: (allow: boolean) => void;
  onRegister: () => void;
  onRemove: () => void;
}) {
  const locked = item.submit.state === "done" || item.submit.state === "saving";
  const issuesByField = new Map<QuickFieldId, string[]>();
  for (const issue of normalized.issues) {
    issuesByField.set(issue.field, [
      ...(issuesByField.get(issue.field) ?? []),
      issue.message,
    ]);
  }
  for (const id of item.repeatedFields) {
    issuesByField.set(id, [
      ...(issuesByField.get(id) ?? []),
      "같은 항목이 두 번 적혀 있습니다. 값을 확인해 주세요.",
    ]);
  }

  return (
    <li
      className={`rounded-xl border bg-white ${
        status === "done"
          ? "border-emerald-300"
          : status === "ready"
            ? "border-line"
            : "border-rose-200"
      }`}
      aria-label={`판매 ${index}`}
    >
      <header className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
        <span className="text-sm font-bold text-ink">#{index}</span>
        <span className="text-sm font-semibold text-ink">
          {item.fields.customer || "(고객명 없음)"}
        </span>
        <span className="text-sm text-ink-sub">{item.fields.staff}</span>
        <StatusBadge tone={STATUS_TONE[status]}>
          {STATUS_TEXT[status]}
        </StatusBadge>
        {item.submit.state === "done" && (
          <span className="text-sm font-semibold text-emerald-700">
            {item.submit.sheet} / No.{item.submit.no}에 저장되었습니다.
          </span>
        )}
        <div className="ml-auto flex gap-2">
          {!locked && (
            <>
              <button
                type="button"
                onClick={onRemove}
                disabled={running}
                className="h-9 rounded-lg border border-line px-3 text-xs font-semibold text-ink-sub hover:bg-zinc-50"
              >
                목록에서 빼기
              </button>
              <button
                type="button"
                onClick={onRegister}
                disabled={
                  running ||
                  !canRegister ||
                  (status !== "ready" && status !== "failed")
                }
                className="h-9 rounded-lg bg-brand px-3 text-xs font-bold text-white disabled:opacity-40"
              >
                {status === "failed" ? "다시 등록" : "이 건만 등록"}
              </button>
            </>
          )}
        </div>
      </header>

      {(item.submit.state === "failed" || duplicateReason) && (
        <div className="space-y-2 px-4 pt-3">
          {item.submit.state === "failed" && (
            <p
              role="alert"
              className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700"
            >
              ⚠ 등록 실패: {item.submit.message}
              {item.submit.errors && item.submit.errors.length > 0 && (
                <span className="mt-1 block text-xs">
                  {item.submit.errors.join(" / ")}
                </span>
              )}
            </p>
          )}
          {duplicateReason && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              ⚠ 이미 등록된 판매와 동일할 가능성이 있습니다. ({duplicateReason})
              <label className="mt-1.5 flex items-center gap-2 text-xs font-semibold">
                <input
                  type="checkbox"
                  checked={item.allowDuplicate}
                  onChange={(e) => onAllowDuplicate(e.target.checked)}
                  disabled={locked}
                />
                확인했습니다. 중복이 아니므로 등록합니다.
              </label>
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 gap-x-5 gap-y-3 p-4 md:grid-cols-2">
        {QUICK_FIELDS.map((field) => {
          const problems = issuesByField.get(field.id);
          const saved = field.column !== null;
          const shown = normalized.display[field.id];
          const inputId = `quick-${item.id}-${field.id}`;
          return (
            <div
              key={field.id}
              className={field.id === "customerPromise" ? "md:col-span-2" : ""}
            >
              <label
                htmlFor={inputId}
                className="flex flex-wrap items-baseline gap-x-2 text-xs font-semibold text-ink-sub"
              >
                {field.label}
                <span
                  className={`font-normal ${saved ? "text-ink-muted" : "text-amber-700"}`}
                >
                  {saved
                    ? `→ ${COLUMN_LETTER[field.column!]}열 ${COLUMN_LABEL[field.column!]}`
                    : "장표 저장 안 함 (참고)"}
                </span>
              </label>
              {field.id === "customerPromise" ? (
                <textarea
                  id={inputId}
                  value={item.fields[field.id]}
                  onChange={(e) => onChange(field.id, e.target.value)}
                  disabled={locked}
                  rows={2}
                  className={`mt-1 w-full rounded-lg border px-3 py-2 text-base outline-none focus:border-brand disabled:bg-zinc-50 ${problems ? "border-rose-400" : "border-line"}`}
                />
              ) : (
                <input
                  id={inputId}
                  value={item.fields[field.id]}
                  onChange={(e) => onChange(field.id, e.target.value)}
                  disabled={locked}
                  aria-invalid={problems ? true : undefined}
                  className={`mt-1 h-10 w-full rounded-lg border px-3 text-base outline-none focus:border-brand disabled:bg-zinc-50 ${
                    problems
                      ? "border-rose-400 bg-rose-50/40"
                      : saved
                        ? "border-line"
                        : "border-dashed border-line bg-zinc-50/60"
                  }`}
                />
              )}
              {saved &&
                shown !== undefined &&
                shown !== item.fields[field.id].trim() && (
                  <p className="mt-0.5 text-xs text-ink-muted">
                    저장 값: {shown}
                  </p>
                )}
              {problems?.map((p) => (
                <p key={p} className="mt-0.5 text-xs font-medium text-rose-600">
                  {p}
                </p>
              ))}
            </div>
          );
        })}
      </div>

      {item.unknownLines.length > 0 && (
        <p className="border-t border-line px-4 py-2 text-xs text-ink-muted">
          양식에 없는 줄(저장 안 함): {item.unknownLines.join(" / ")}
        </p>
      )}
    </li>
  );
}
