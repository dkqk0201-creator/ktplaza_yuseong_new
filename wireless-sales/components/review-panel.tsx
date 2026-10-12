"use client";

import { useEffect, useState } from "react";
import { copyText } from "@/components/copy-text";
import { formatCtn } from "@/lib/format";
import {
  REVIEW_MAX,
  reviewContentError,
  reviewMessage,
  type SaleReview,
} from "@/lib/inspection-review";
import { postReview } from "@/lib/review-api";
import { isO, type SheetSale } from "@/lib/sheet-record";

/*
 * 검수 보완 요청 (검수관리 판매 상세).
 * - 고객명·CTN·판매자: 선택한 판매에서 자동 (읽기 전용)
 * - 미비내용: 점장이 직접 적는 글 하나 (체크리스트·선택 목록 없음)
 * - "직원 전달내용 복사": 클립보드 복사만 (저장 아님, 카카오톡 자동 발송 없음)
 * - "보완 요청 저장": 보조 시트 "검수보완" 에 미비내용·요청 상태 저장 (장표에는 쓰지 않음)
 * - 최종 검수완료(G열 O)는 아래 검수완료 버튼 → Apps Script 가 요청을 닫고 이력으로 남긴다
 */

const STATUS_LABEL: Record<string, string> = {
  검수완료: "검수완료",
  취소: "요청 취소",
  판매삭제: "판매 삭제",
};

export function ReviewPanel({
  sheet,
  sale,
  busy,
  onSaved,
  onDirtyChange,
}: {
  sheet: string;
  sale: SheetSale;
  /** 다른 저장(검수완료·삭제 등) 중이면 true */
  busy: boolean;
  onSaved: (review: SaleReview | null, message: string) => void;
  /** 저장하지 않은 미비내용이 있는지 (창 닫기 전 확인용) */
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const active = sale.review?.active ?? null;
  const history = sale.review?.history ?? [];
  const inspected = isO(sale.inspected);
  const saved = active?.content ?? "";
  const [draft, setDraft] = useState<string | null>(null);
  const value = draft ?? saved;
  const dirty = draft !== null && draft.trim() !== saved.trim();
  const [saving, setSaving] = useState<"save" | "cancel" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const problem = draft === null ? null : reviewContentError(draft);

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  async function submit(op: "save" | "cancel") {
    if (saving || busy) return;
    if (op === "cancel" && !window.confirm("진행 중인 보완 요청을 취소할까요? (기록은 이력으로 남습니다)")) return;
    setSaving(op);
    setError(null);
    setNotice(null);
    setCopied(null);
    const result = await postReview({
      target: {
        sheet,
        row: sale.row,
        no: sale.no,
        activatedAt: sale.activatedAt,
        customer: sale.customer,
        ctn: sale.ctn,
      },
      op,
      before: saved,
      content: op === "save" ? value : "",
    });
    setSaving(null);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setDraft(null);
    setNotice(result.message);
    onSaved(result.review, result.message);
  }

  async function copy() {
    const ok = await copyText(reviewMessage(sale, value));
    setCopied(
      ok
        ? dirty || !active
          ? "직원 전달내용을 복사했습니다. 아직 저장되지 않았습니다 — [보완 요청 저장]을 눌러 주세요."
          : "직원 전달내용을 복사했습니다."
        : "복사하지 못했습니다. 브라우저의 클립보드 권한을 확인해 주세요.",
    );
  }

  return (
    <section
      aria-label="검수 보완 요청"
      className={`rounded-xl border ${active && !inspected ? "border-amber-300" : "border-line"}`}
    >
      <h3 className="flex flex-wrap items-center gap-2 border-b border-line bg-zinc-50 px-4 py-2.5 text-sm font-bold text-ink">
        검수 보완 요청
        {active && !inspected && (
          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-semibold text-amber-800">
            보완 요청 중
          </span>
        )}
        {inspected && (
          <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[11px] font-semibold text-emerald-700">
            검수완료
          </span>
        )}
      </h3>
      <div className="space-y-3 px-4 py-3">
        <dl className="grid grid-cols-3 gap-2 text-sm">
          {(
            [
              ["고객명", sale.customer || "-"],
              ["CTN", sale.ctn ? formatCtn(sale.ctn) : "-"],
              ["판매자", sale.staff || "-"],
            ] as const
          ).map(([label, text]) => (
            <div key={label} className="rounded-lg bg-zinc-50 px-2.5 py-2">
              <dt className="text-[11px] text-ink-muted">{label}</dt>
              <dd className="mt-0.5 font-semibold break-all text-ink tabular-nums">{text}</dd>
            </div>
          ))}
        </dl>

        {inspected ? (
          active ? (
            <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
              G열 검수가 이미 O 입니다 (장표에서 직접 입력). 보완 요청 목록에는 나오지 않습니다.
              <span className="mt-1 block whitespace-pre-wrap text-ink">미비내용: {active.content}</span>
            </p>
          ) : (
            <p className="text-xs text-ink-muted">검수완료된 판매입니다.</p>
          )
        ) : (
          <>
            <div>
              <label
                htmlFor="review-content"
                className="flex items-baseline gap-2 text-xs font-semibold text-ink-sub"
              >
                미비내용
                {dirty && (
                  <span className="ml-auto font-semibold text-amber-700">
                    저장되지 않은 변경
                  </span>
                )}
              </label>
              <textarea
                id="review-content"
                rows={4}
                value={value}
                maxLength={REVIEW_MAX + 50}
                onChange={(e) => {
                  setDraft(e.target.value);
                  setCopied(null);
                  setNotice(null);
                }}
                placeholder="보완이 필요한 내용을 직접 입력하세요"
                className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-base outline-none focus:border-brand"
              />
              <p className="mt-0.5 text-xs text-ink-muted">
                {active
                  ? `요청 ${active.requestedAt}${active.updatedAt && active.updatedAt !== active.requestedAt ? ` · 수정 ${active.updatedAt}` : ""}`
                  : "저장된 보완 요청이 없습니다."}
              </p>
              {problem && draft !== null && draft.trim() !== "" && (
                <p className="mt-0.5 text-xs font-medium text-rose-600">{problem}</p>
              )}
            </div>
            {error && (
              <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                ⚠ {error}
              </p>
            )}
            {notice && (
              <p role="status" className="text-sm font-semibold text-emerald-700">
                ✓ {notice}
              </p>
            )}
            {copied && (
              <p role="status" className="text-sm font-medium text-ink-sub">
                {copied}
              </p>
            )}
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => void copy()}
                disabled={!value.trim()}
                className="h-11 rounded-lg border border-line bg-white text-[15px] font-semibold text-ink hover:bg-zinc-50 disabled:opacity-40"
              >
                직원 전달내용 복사
              </button>
              <button
                type="button"
                onClick={() => void submit("save")}
                disabled={!dirty || problem !== null || saving !== null || busy}
                aria-busy={saving === "save"}
                className="h-11 rounded-lg bg-amber-600 text-[15px] font-semibold text-white hover:bg-amber-700 disabled:opacity-40"
              >
                {saving === "save" ? "저장 중..." : active ? "보완 요청 저장 (수정)" : "보완 요청 저장"}
              </button>
            </div>
            {active && (
              <button
                type="button"
                onClick={() => void submit("cancel")}
                disabled={saving !== null || busy}
                className="text-xs font-medium text-ink-muted underline underline-offset-2 disabled:opacity-40"
              >
                {saving === "cancel" ? "취소 중..." : "보완 요청 취소"}
              </button>
            )}
            {active && (
              <p className="text-xs text-ink-muted">
                보완이 끝났는지 확인한 뒤 아래 [최종 검수완료]를 누르면 G열 검수가 O 로 저장되고 보완 요청은 완료 이력으로 남습니다.
              </p>
            )}
          </>
        )}

        {history.length > 0 && (
          <details className="text-sm">
            <summary className="cursor-pointer text-xs font-semibold text-ink-sub">
              지난 보완 요청 이력 {history.length}건
            </summary>
            <ul className="mt-2 space-y-2">
              {history.map((h, i) => (
                <li key={`${h.requestedAt}-${i}`} className="rounded-lg bg-zinc-50 px-3 py-2">
                  <p className="text-xs text-ink-muted">
                    {STATUS_LABEL[h.status] ?? h.status} · 요청 {h.requestedAt || "-"} · 종료 {h.closedAt || "-"}
                  </p>
                  <p className="mt-0.5 whitespace-pre-wrap text-ink">{h.content || "-"}</p>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </section>
  );
}
