"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { postDeleteSale } from "@/lib/delete-sale-api";
import { formatCtn, formatNumber } from "@/lib/format";
import { amountText, dateText, monthDayText } from "@/lib/sale-display";
import {
  changeLabel,
  diffSale,
  editText,
  isRowFormulaKey,
  ROW_FORMULA_NOTE,
  rowFormulaValues,
  isAmountKey,
  parseEditAmount,
  validateEdits,
  type SaleChange,
} from "@/lib/sale-edit";
import { postUpdateSale } from "@/lib/update-sale-api";
import { MARK_DONE_LABEL, postMarkDone } from "@/lib/mark-done-api";
import { ReviewPanel } from "@/components/review-panel";
import { isReviewPending, type SaleReview } from "@/lib/inspection-review";
import {
  COLUMN_LABEL,
  COLUMN_LETTER,
  type ColumnKey,
} from "@/lib/sheet-columns";
import { isO, parseSheetRow, type SheetSale } from "@/lib/sheet-record";
import {
  SaleFieldGroups,
  type FieldGroup,
  type FieldView,
} from "@/components/sale-fields";
import {
  diffNotes,
  editGroups,
  extraColumnKeys,
  NOTE_FIELD_IDS,
  noteError,
  noteLabel,
  noteOriginal,
  NOTE_MAX,
  type EditSpec,
  type NoteChange,
  type NoteFieldId,
} from "@/lib/sale-form-layout";
import { POLICY_NAME_FIELD, POLICY_NAME_MAX } from "@/lib/model-policy";
import {
  W_EXTRA,
  W_INSTALLMENT,
  planWSplit,
  wPartPrefill,
  wSplitOf,
  wonText,
  type WPartKey,
  type WSplitEdit,
} from "@/lib/w-split";

/*
 * 판매 1건 상세 보기 (장표 A~AL 그대로) + 판매 수정 + 판매 삭제.
 * readOnly 이면 보기만 한다 (실력지표).
 * 판매 수정: 같은 월 시트·같은 행의 바뀐 칸만 고친다. No.(B)·개통일(C)은 고칠 수 없다.
 */

const SECTIONS: { title: string; keys: ColumnKey[]; strong?: ColumnKey[] }[] = [
  {
    title: "1. 기본 개통정보",
    keys: [
      "activatedAt",
      "customer",
      "ctn",
      "excludeIndicator",
      "category",
      "model",
      "plan",
      "planChange",
      "staff",
      "customerPromise",
    ],
  },
  { title: "2. 정리", keys: ["inspected", "paid"] },
  {
    title: "3. 확보금액",
    // 화면 표시 순서만: O P Q R S T N (T열 고객혜택을 확보금액 영역에 표시)
    keys: [
      "spot", // O
      "securedDicho", // P
      "appleMania", // Q
      "securedSecond", // R
      "modelPolicy", // S
      "customerBenefit", // T
      "securedTotal", // N
    ],
    strong: ["securedTotal"],
  },
  {
    title: "4. 고객혜택 / 고객혜택사용",
    keys: [
      "usedModelPlan",
      "usedExtraSupport",
      "usedDicho",
      "usedSecond",
      "usedTotal",
    ],
    strong: ["usedTotal"],
  },
  {
    title: "5. 중고판매",
    keys: ["usedPhoneSale", "usedPhoneUsed", "usedPhoneRemaining"],
    strong: ["usedPhoneRemaining"],
  },
  {
    title: "6. 추가 관리",
    keys: [
      "secondPerformance",
      "jeca",
      "cardType",
      "cardChecked",
      "jecaBudget",
      "addon",
      "insurance",
      "dongpan",
      "wiredAvailableDate",
    ],
  },
  { title: "합계", keys: ["finalTotal"], strong: ["finalTotal"] },
];

/*
 * 판매보고 참고내용 (장표 A~AL 에 없는 항목) 을 상세 화면의 원래 의미 위치에 함께 보여준다.
 * 값은 Apps Script 보조 시트 "웹앱참고" 에서 이 판매에 연결된 것 (sale.notes).
 * always: 비어 있어도 "-" 로 항상 보이는 항목 / 나머지는 직원이 적은 경우에만 보인다.
 */
type NoteRow = { id: string; label: string; always?: boolean; tag?: string };
const NOTES_BEFORE: Partial<Record<ColumnKey, NoteRow[]>> = {
  usedPhoneSale: [{ id: "usedPhone", label: "중고폰&현물 판매", always: true }],
};
const NOTES_AFTER: Partial<Record<ColumnKey, NoteRow[]>> = {
  // S열 모델정책 금액의 정책명 (장표 저장 안 함, 웹앱참고 보관)
  modelPolicy: [
    { id: "modelPolicyName", label: "ㄴ 정책명", always: true, tag: "웹앱 보관" },
  ],
  // 예전에 참고내용(글자)으로 적었던 고혜(기존할부금)·고혜(요금) — 지우지 않고 보여만 준다 (지금은 W·V열 금액)
  usedModelPlan: [
    { id: "useInstallment", label: "고혜(기존할부금) 예전 메모", tag: "장표 아님" },
    { id: "usePlan", label: "고혜(요금) 예전 메모", tag: "장표 아님" },
  ],
  usedDicho: [
    { id: "dicho", label: "디초/삼초" },
    { id: "dichoGift", label: "디초/삼초 사은품판매or수령" },
  ],
  usedSecond: [
    { id: "second", label: "2ND" },
    { id: "secondSelfPay", label: "2ND 자부담" },
    { id: "secondGift", label: "2ND 사은품판매or수령" },
  ],
  usedPhoneUsed: [{ id: "usedPhoneWhere", label: "어디에", always: true }],
};

function NoteRows({ sale, rows }: { sale: SheetSale; rows?: NoteRow[] }) {
  return (
    <>
      {(rows ?? [])
        .filter((r) => r.always || sale.notes?.[r.id])
        .map((r) => (
          <div
            key={r.id}
            className="flex items-start justify-between gap-4 px-4 py-2.5 text-sm"
          >
            <dt className="shrink-0 text-ink-sub">
              {r.label}
              <span className="ml-1.5 text-[11px] text-ink-muted">
                {r.tag ?? "판매보고"}
              </span>
            </dt>
            <dd className="text-right break-all whitespace-pre-wrap text-ink">
              {sale.notes?.[r.id] || "-"}
            </dd>
          </div>
        ))}
    </>
  );
}

function valueText(sale: SheetSale, key: ColumnKey): string {
  const value = (sale as Record<string, unknown>)[key];
  if (typeof value === "number" || value === null) return amountText(value);
  const text = String(value ?? "");
  if (key === "activatedAt") return monthDayText(text);
  if (key === "wiredAvailableDate") return dateText(text);
  if (key === "ctn") return text ? formatCtn(text) : "";
  return text;
}

type Mode = "view" | "edit" | "confirm";

export function SaleDetail({
  sheet,
  sale: listedSale,
  readOnly = false,
  onClose,
  onDeleted,
  onUpdated,
  onMarked,
  onReviewChanged,
}: {
  sheet: string;
  sale: SheetSale;
  /** true 면 수정·삭제 버튼 없이 보기만 */
  readOnly?: boolean;
  onClose: () => void;
  onDeleted?: (message: string) => void;
  onUpdated?: (message: string) => void;
  /** 있으면 "검수완료"(G)·"수납완료"(H) 버튼 표시. 장표 저장 성공 후 저장된 판매로 호출 */
  onMarked?: (next: SheetSale, field: "inspected" | "paid", message: string) => void;
  /** 있으면 "검수 보완 요청" 영역 표시 (검수관리). 보완 요청 저장·취소 후 바뀐 판매로 호출 */
  onReviewChanged?: (next: SheetSale, message: string) => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  // 수정 직후 Apps Script 가 돌려준 최신 값 (목록이 다시 읽히기 전에도 바로 보여준다)
  const [updated, setUpdated] = useState<SheetSale | null>(null);
  const sale = updated ?? listedSale;
  const [mode, setMode] = useState<Mode>("view");
  const [edited, setEdited] = useState<Partial<Record<ColumnKey, string>>>({});
  const [saving, setSaving] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [updateNotice, setUpdateNotice] = useState<string | null>(null);
  // W열 = 추가지원금 + 고혜(기존할부금): 두 입력 중 하나라도 건드리면 W열은 두 금액의 합으로 (세부는 참고내용)
  const [wEdit, setWEdit] = useState<WSplitEdit>({});
  const wPlan = planWSplit(sale, mode === "view" ? {} : wEdit);
  const editedAll: Partial<Record<ColumnKey, string>> =
    wPlan.wAfter !== undefined ? { ...edited, usedExtraSupport: wPlan.wAfter } : edited;
  const changes = mode === "view" ? [] : diffSale(sale, editedAll);
  const fieldErrors = validateEdits(changes);
  // 참고 항목 (장표 저장 안 함, 웹앱참고 보관): 손댄 항목만 값이 있다
  const [notesEdit, setNotesEdit] = useState<Partial<Record<NoteFieldId, string>>>({});
  const noteChanges: NoteChange[] =
    mode === "view" ? [] : [...diffNotes(sale, notesEdit), ...wPlan.notes];
  const noteErrors: Partial<Record<NoteFieldId, string>> = { ...wPlan.errors };
  for (const field of NOTE_FIELD_IDS) {
    const value = notesEdit[field];
    if (value === undefined) continue;
    const problem = noteError(field, value);
    if (problem) noteErrors[field] = problem;
  }
  const changeCount = changes.length + noteChanges.length;

  // 삭제·수정 요청 중에는 창을 닫지 않는다 (Esc·배경 클릭·닫기 버튼 모두)
  const deletingRef = useRef(false);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);
  // 저장하지 않은 보완 요청 미비내용이 있으면 닫기 전에 확인
  const reviewDirtyRef = useRef(false);
  const close = () => {
    if (deletingRef.current) return;
    if (
      reviewDirtyRef.current &&
      !window.confirm("저장하지 않은 미비내용이 있습니다. 저장하지 않고 닫을까요?")
    ) {
      return;
    }
    onCloseRef.current();
  };

  // 검수완료(G)·수납완료(H): 그 칸만 O 로 저장, 저장 확인 후에만 완료 표시 (창은 열어 둔다)
  const [marking, setMarking] = useState<"inspected" | "paid" | null>(null);
  const [markError, setMarkError] = useState<string | null>(null);
  const [markNotice, setMarkNotice] = useState<string | null>(null);
  async function handleMark(field: "inspected" | "paid") {
    if (deletingRef.current || isO(sale[field])) return; // 처리 중·이미 완료면 무시 (중복 클릭 방지)
    // 보완 요청 중인 판매의 검수완료 = 최종 검수완료 (점장이 보완 여부를 재확인)
    if (
      field === "inspected" &&
      isReviewPending(sale) &&
      !window.confirm(
        "보완이 끝났는지 확인하셨나요?\n최종 검수완료하면 G열 검수가 O 로 저장되고 보완 요청은 완료 이력으로 남습니다.",
      )
    ) {
      return;
    }
    deletingRef.current = true;
    setMarking(field);
    setMarkError(null);
    setMarkNotice(null);
    const result = await postMarkDone({
      target: {
        sheet,
        row: sale.row,
        no: sale.no,
        activatedAt: sale.activatedAt,
        customer: sale.customer,
        ctn: sale.ctn,
      },
      field,
      before: sale[field],
    });
    deletingRef.current = false;
    setMarking(null);
    if (!result.ok) {
      setMarkError(result.message);
      return;
    }
    // 장표가 돌려준 저장 후 값으로 바로 표시 (참고내용은 장표 값이 아니므로 보던 것 유지)
    const next = parseSheetRow(result.row, result.no, result.values);
    // 보완 요청이 함께 닫혔으면 진행 중 → 이력으로 옮겨 바로 표시 (장표에서 다시 읽으면 서버 값으로 바뀜)
    const review: SaleReview | undefined =
      result.reviewClosed && sale.review?.active
        ? {
            active: null,
            history: [
              {
                status: "검수완료",
                content: sale.review.active.content,
                staff: sale.review.active.staff,
                requestedAt: sale.review.active.requestedAt,
                closedAt: "방금",
              },
              ...sale.review.history,
            ],
          }
        : sale.review;
    const shown = {
      ...next,
      ...(sale.notes ? { notes: sale.notes } : {}),
      ...(sale.spotNote ? { spotNote: sale.spotNote } : {}),
      ...(review ? { review } : {}),
    };
    setUpdated(shown);
    setMarkNotice(result.message);
    onMarked?.(shown, field, result.message);
  }

  async function handleDelete() {
    if (deletingRef.current) return;
    if (!window.confirm("이 판매내역을 삭제하시겠습니까?")) return;
    deletingRef.current = true;
    setDeleting(true);
    setDeleteError(null);
    const result = await postDeleteSale({
      sheet,
      row: sale.row,
      no: sale.no,
      activatedAt: sale.activatedAt,
      customer: sale.customer,
      ctn: sale.ctn,
    });
    deletingRef.current = false;
    setDeleting(false);
    if (result.ok) onDeleted?.(result.message);
    else setDeleteError(result.message);
  }

  function startEdit() {
    setEdited({});
    setNotesEdit({});
    setWEdit({});
    setUpdateError(null);
    setUpdateNotice(null);
    setDeleteError(null);
    setMode("edit");
  }

  async function handleUpdate(
    list: SaleChange[],
    notes: NoteChange[],
  ) {
    if (deletingRef.current || (list.length === 0 && notes.length === 0)) return;
    deletingRef.current = true;
    setSaving(true);
    setUpdateError(null);
    const result = await postUpdateSale({
      target: {
        sheet,
        row: sale.row,
        no: sale.no,
        activatedAt: sale.activatedAt,
        customer: sale.customer,
        ctn: sale.ctn,
      },
      changes: list,
      ...(notes.length > 0 ? { notes } : {}),
    });
    deletingRef.current = false;
    setSaving(false);
    if (result.ok) {
      // 참고내용은 장표 값이 아니므로 수정 응답에 없다 → 보던 참고내용을 그대로 유지
      // (고객명·CTN 을 바꾸면 Apps Script 가 참고내용 연결 키도 함께 옮긴다)
      // 정책명을 바꿨으면 Apps Script 가 돌려준 저장 후 참고내용으로 바꾼다
      const next = parseSheetRow(result.row, result.no, result.values);
      const savedNotes = result.notes ?? sale.notes;
      const shown: SheetSale = {
        ...next,
        ...(savedNotes && Object.keys(savedNotes).length > 0 ? { notes: savedNotes } : {}),
        ...(sale.review ? { review: sale.review } : {}),
      };
      setUpdated(shown);
      setMode("view");
      setEdited({});
      setNotesEdit({});
      setWEdit({});
      setUpdateNotice(
        `${result.message} (${list.length + notes.length}개 항목)` +
          (result.warning ? ` ⚠ ${result.warning}` : ""),
      );
      onUpdated?.(result.message);
    } else {
      setUpdateError(result.message);
    }
  }

  // 상세창이 열릴 때 한 번만 실행
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || deletingRef.current) return;
      if (
        reviewDirtyRef.current &&
        !window.confirm("저장하지 않은 미비내용이 있습니다. 저장하지 않고 닫을까요?")
      ) {
        return;
      }
      onCloseRef.current();
    };
    window.addEventListener("keydown", onKey);
    // 상세창이 열린 동안 뒤 화면이 스크롤되지 않게 한다
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/40"
      onClick={close}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="sale-detail-title"
        onClick={(e) => e.stopPropagation()}
        className="flex h-full w-full max-w-xl flex-col bg-white shadow-xl"
      >
        <header className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div>
            <p className="text-xs text-ink-muted">
              {sheet} 시트 · {sale.row}행 · No.{sale.no || "없음 (UMNP)"}
            </p>
            <h2
              id="sale-detail-title"
              className="mt-0.5 text-lg font-bold text-ink"
            >
              {sale.customer || "(고객명 없음)"}{" "}
              <span className="text-base font-medium text-ink-sub tabular-nums">
                {sale.ctn ? formatCtn(sale.ctn) : ""}
              </span>
            </h2>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={close}
            disabled={deleting || saving || marking !== null}
            className="h-9 shrink-0 rounded-lg border border-line px-3 text-sm font-semibold text-ink-sub hover:bg-zinc-50"
          >
            닫기
          </button>
        </header>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-5">
          {updateNotice && mode === "view" && (
            <p
              role="status"
              className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800"
            >
              ✓ {updateNotice}
            </p>
          )}
          {mode === "view" && onReviewChanged && !readOnly && (
            <ReviewPanel
              sheet={sheet}
              sale={sale}
              busy={deleting || marking !== null}
              onDirtyChange={(dirty) => {
                reviewDirtyRef.current = dirty;
              }}
              onSaved={(review, message) => {
                const { review: _old, ...rest } = sale;
                const next: SheetSale = review ? { ...rest, review } : rest;
                setUpdated(next);
                onReviewChanged(next, message);
              }}
            />
          )}
          {mode === "view" && <SaleView sale={sale} />}
          {mode === "edit" && (
            <SaleEditForm
              sale={sale}
              edited={editedAll}
              wEdit={wEdit}
              wPreview={wPlan.preview}
              onWChange={(part, value) => setWEdit((prev) => ({ ...prev, [part]: value }))}
              errors={fieldErrors}
              onChange={(key, value) =>
                setEdited((prev) => ({ ...prev, [key]: value }))
              }
              notesEdit={notesEdit}
              noteErrors={noteErrors}
              onNoteChange={(field, value) =>
                setNotesEdit((prev) => ({ ...prev, [field]: value }))
              }
            />
          )}
          {mode === "confirm" && (
            <ChangeList changes={changes} notes={noteChanges} />
          )}
        </div>

        {!readOnly && (
          <footer className="border-t border-line px-5 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
            {(deleteError || updateError) && (
              <p
                role="alert"
                className="mb-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700"
              >
                ⚠ {deleteError || updateError}
              </p>
            )}
            {mode === "view" && onMarked && (
              <MarkDoneButtons
                sale={sale}
                marking={marking}
                busy={deleting}
                error={markError}
                notice={markNotice}
                onMark={(field) => void handleMark(field)}
              />
            )}
            {mode === "view" && (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={startEdit}
                    disabled={deleting || marking !== null}
                    className="h-11 rounded-lg bg-ink text-[15px] font-semibold text-white disabled:opacity-60"
                  >
                    판매 수정
                  </button>
                  <button
                    type="button"
                    onClick={handleDelete}
                    disabled={deleting || marking !== null}
                    aria-busy={deleting}
                    className="flex h-11 items-center justify-center gap-2 rounded-lg border border-rose-300 bg-white text-[15px] font-semibold text-rose-600 hover:bg-rose-50 disabled:cursor-wait disabled:opacity-70"
                  >
                    {deleting && (
                      <span
                        aria-hidden
                        className="h-4 w-4 animate-spin rounded-full border-2 border-rose-200 border-t-rose-600"
                      />
                    )}
                    {deleting ? "삭제 중..." : "판매 삭제"}
                  </button>
                </div>
                <p className="mt-1.5 text-center text-xs text-ink-muted">
                  삭제는 장표의 행과 No.는 그대로 두고 이 판매 건의 입력 내용만
                  지웁니다.
                </p>
              </>
            )}
            {mode === "edit" && (
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setMode("view")}
                  className="h-11 rounded-lg border border-line text-[15px] font-semibold text-ink-sub hover:bg-zinc-50"
                >
                  수정 취소
                </button>
                <button
                  type="button"
                  onClick={() => setMode("confirm")}
                  disabled={
                    changeCount === 0 ||
                    Object.keys(fieldErrors).length > 0 ||
                    Object.keys(noteErrors).length > 0
                  }
                  className="h-11 rounded-lg bg-ink text-[15px] font-semibold text-white disabled:opacity-40"
                >
                  변경 확인 ({changeCount})
                </button>
              </div>
            )}
            {mode === "confirm" && (
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setMode("edit")}
                  disabled={saving}
                  className="h-11 rounded-lg border border-line text-[15px] font-semibold text-ink-sub hover:bg-zinc-50"
                >
                  다시 수정
                </button>
                <button
                  type="button"
                  onClick={() => void handleUpdate(changes, noteChanges)}
                  disabled={saving || changeCount === 0}
                  aria-busy={saving}
                  className="h-11 rounded-lg bg-brand text-[15px] font-bold text-white disabled:cursor-wait disabled:opacity-70"
                >
                  {saving ? "저장 중..." : "수정 저장"}
                </button>
              </div>
            )}
          </footer>
        )}
      </div>
    </div>
  );
}

/** 검수완료(G열)·수납완료(H열) 버튼: 이미 O 면 "✓ …" 로 비활성, 둘 다 O 면 완료 표시 */
function MarkDoneButtons({
  sale,
  marking,
  busy,
  error,
  notice,
  onMark,
}: {
  sale: SheetSale;
  marking: "inspected" | "paid" | null;
  busy: boolean;
  error: string | null;
  notice: string | null;
  onMark: (field: "inspected" | "paid") => void;
}) {
  const inspected = isO(sale.inspected);
  const paid = isO(sale.paid);
  return (
    <div className="mb-3">
      {error && (
        <p
          role="alert"
          className="mb-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700"
        >
          ⚠ {error}
        </p>
      )}
      {inspected && paid ? (
        <p
          role="status"
          className="mb-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-center text-sm font-bold text-emerald-800"
        >
          ✓ 검수·수납 모두 완료된 판매입니다
        </p>
      ) : (
        notice && (
          <p
            role="status"
            className="mb-2 text-center text-sm font-semibold text-emerald-700"
          >
            ✓ {notice}
          </p>
        )
      )}
      <div className="grid grid-cols-2 gap-2">
        {(["inspected", "paid"] as const).map((field) => {
          const done = isO(sale[field]);
          const label =
            field === "inspected" && isReviewPending(sale)
              ? "최종 검수완료"
              : MARK_DONE_LABEL[field];
          return (
            <button
              key={field}
              type="button"
              onClick={() => onMark(field)}
              disabled={done || busy || marking !== null}
              aria-busy={marking === field}
              className={`h-11 rounded-lg text-[15px] font-semibold ${
                done
                  ? "border border-emerald-200 bg-emerald-50 text-emerald-700"
                  : "bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-60"
              }`}
            >
              {done ? `✓ ${label}` : marking === field ? "처리 중..." : label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** W열 세부: 추가지원금 / 고혜(기존할부금) (웹앱 보관) + 불일치·세부 없음 표시 */
function WSplitRows({ sale }: { sale: SheetSale }) {
  const split = wSplitOf(sale);
  return (
    <div className="space-y-1 px-4 py-2.5 text-sm">
      {split.status !== "none" &&
        (
          [
            ["ㄴ 추가지원금", split.extra],
            ["ㄴ 고혜(기존할부금)", split.installment],
          ] as const
        ).map(([label, value]) => (
          <div key={label} className="flex items-start justify-between gap-4">
            <dt className="shrink-0 text-ink-sub">
              {label}
              <span className="ml-1.5 text-[11px] text-ink-muted">W열 세부 · 웹앱 보관</span>
            </dt>
            <dd className="text-right text-ink tabular-nums">{value === null ? "-" : wonText(value)}</dd>
          </div>
        ))}
      {split.status === "none" && split.w !== 0 && (
        <p className="text-xs text-ink-muted">W열 세부 내역 없음 (예전 등록 — 추가지원금·고혜(기존할부금)로 나누지 않음)</p>
      )}
      {split.status === "mismatch" && (
        <p role="alert" className="rounded-lg bg-rose-50 px-2.5 py-1.5 text-xs font-semibold text-rose-700">
          ⚠ 불일치: W열 {wonText(split.w)} ≠ 세부 합계 {wonText(split.detailSum ?? 0)} — 구글시트 W열이 직접 수정된 것으로
          보입니다. 판매 수정에서 두 금액을 확인해 주세요.
        </p>
      )}
    </div>
  );
}

function SaleView({ sale }: { sale: SheetSale }) {
  return (
    <>
      {SECTIONS.map((section) => (
        <section key={section.title} className="rounded-xl border border-line">
          <h3 className="border-b border-line bg-zinc-50 px-4 py-2.5 text-sm font-bold text-ink">
            {section.title}
          </h3>
          <dl className="divide-y divide-line">
            {section.keys.map((key) => (
              <Fragment key={key}>
                <NoteRows sale={sale} rows={NOTES_BEFORE[key]} />
                <div className="flex items-start justify-between gap-4 px-4 py-2.5 text-sm">
                  <dt className="shrink-0 text-ink-sub">
                    {COLUMN_LABEL[key]}
                    <span className="ml-1.5 text-[11px] text-ink-muted">
                      {COLUMN_LETTER[key]}열
                    </span>
                  </dt>
                  <dd
                    className={`text-right break-all whitespace-pre-wrap tabular-nums ${
                      section.strong?.includes(key)
                        ? "font-bold text-ink"
                        : "text-ink"
                    }`}
                  >
                    {valueText(sale, key) || "-"}
                  </dd>
                </div>
                {key === "usedExtraSupport" && <WSplitRows sale={sale} />}
                <NoteRows sale={sale} rows={NOTES_AFTER[key]} />
              </Fragment>
            ))}
          </dl>
        </section>
      ))}
    </>
  );
}

/**
 * 수정 입력창: 간편등록과 같은 그룹·항목 이름·순서 (공용 SaleFieldGroups).
 * - 장표 칸은 저장된 값, 참고 항목(장표 저장 안 함)은 웹앱참고에 보관된 값을 채워서 보여준다.
 * - 간편등록 양식에 없는 장표 칸(검수·수납·SPOT 등)은 맨 아래 "장표 추가 항목" 에서 그대로 고칠 수 있다.
 * - No.·개통일은 고칠 수 없고, N·U·AB·AC 는 장표 수식이 계산한 값을 보여준다.
 */
function SaleEditForm({
  sale,
  edited,
  errors,
  onChange,
  notesEdit,
  noteErrors,
  onNoteChange,
  wEdit,
  wPreview,
  onWChange,
}: {
  sale: SheetSale;
  wEdit: WSplitEdit;
  wPreview: number | null;
  onWChange: (part: keyof WSplitEdit, value: string) => void;
  edited: Partial<Record<ColumnKey, string>>;
  errors: Partial<Record<ColumnKey, string>>;
  onChange: (key: ColumnKey, value: string) => void;
  notesEdit: Partial<Record<NoteFieldId, string>>;
  noteErrors: Partial<Record<NoteFieldId, string>>;
  onNoteChange: (field: NoteFieldId, value: string) => void;
}) {
  const formula = rowFormulaValues(sale, edited);
  const columnView = (key: ColumnKey, label: string, hint: string): FieldView => {
    if (key === "activatedAt") {
      return { id: `edit-${key}`, label, hint: `${hint} · 수정 불가`, value: monthDayText(sale.activatedAt), readOnly: true };
    }
    if (isRowFormulaKey(key)) {
      return {
        id: `edit-${key}`,
        label,
        hint,
        value: `${formatNumber(formula[key])}원`,
        readOnly: true,
        info: ROW_FORMULA_NOTE[key],
      };
    }
    const original = editText(sale, key);
    const value = edited[key] ?? original;
    return {
      id: `edit-${key}`,
      label,
      hint,
      value,
      onChange: (v) => onChange(key, v),
      numeric: isAmountKey(key),
      multiline: key === "customerPromise",
      changed: key in edited && value.trim() !== original.trim(),
      problems: errors[key] ? [errors[key]!] : undefined,
    };
  };
  const noteView = (field: NoteFieldId, label: string, hint: string): FieldView => {
    const original = noteOriginal(sale, field);
    const value = notesEdit[field] ?? original;
    return {
      id: `edit-note-${field}`,
      label,
      hint,
      note: true,
      value,
      onChange: (v) => onNoteChange(field, v),
      maxLength: (field === POLICY_NAME_FIELD ? POLICY_NAME_MAX : NOTE_MAX) + 20,
      placeholder: field === POLICY_NAME_FIELD ? "정책명 직접 입력" : undefined,
      changed: field in notesEdit && value.trim() !== original,
      problems: noteErrors[field] ? [noteErrors[field]!] : undefined,
    };
  };
  // 예전에 참고내용으로 적었던 고혜(기존할부금)·고혜(요금) 글자는 지우지 않고 안내로만 보여준다
  const legacy = (id: "useInstallment" | "usePlan") =>
    sale.notes?.[id] ? `예전 참고 메모 (장표 아님): ${sale.notes[id]}` : null;
  const split = wSplitOf(sale);
  const wInfo = (
    <>
      {wPreview !== null ? (
        <p className="font-semibold text-ink">
          W열 저장 값: {wonText(wPreview)} (지금 W열 {wonText(split.w)})
        </p>
      ) : split.status === "ok" ? (
        <p>W열 {wonText(split.w)} = 추가지원금 + 고혜(기존할부금)</p>
      ) : split.status === "none" ? (
        <p className="text-amber-700">
          세부 내역 없음 — 지금 W열 {wonText(split.w)} (예전 등록이라 나누지 않음). 금액을 입력하면 W열은 두 금액의 합계로
          저장됩니다.
        </p>
      ) : (
        <p className="font-semibold text-rose-600">
          불일치 — W열 {wonText(split.w)} ≠ 웹앱 세부 합계 {wonText(split.detailSum ?? 0)} (구글시트에서 직접 수정된 것으로 보입니다).
          그대로 두면 아무것도 바뀌지 않습니다.
        </p>
      )}
      {legacy("useInstallment") && <p>{legacy("useInstallment")}</p>}
    </>
  );
  const wView = (part: WPartKey, label: string, hint: string): FieldView => {
    const key: keyof WSplitEdit = part === W_EXTRA ? "extra" : "installment";
    const original = wPartPrefill(sale, part);
    const value = wEdit[key] ?? original;
    return {
      id: `edit-${part}`,
      label,
      hint,
      value,
      onChange: (v) => onWChange(key, v),
      numeric: true,
      placeholder: split.status === "none" ? "세부 금액 입력" : undefined,
      changed: key in wEdit && value.trim() !== original,
      problems: noteErrors[part] ? [noteErrors[part]!] : undefined,
      info: part === W_INSTALLMENT ? wInfo : undefined,
    };
  };
  const view = (spec: EditSpec): FieldView => {
    if (spec.kind === "wpart") return wView(spec.part, spec.label, spec.hint);
    if (spec.kind === "note") return noteView(spec.field, spec.label, spec.hint);
    const v = columnView(spec.key, spec.label, spec.hint);
    return spec.id === "usePlan" && legacy("usePlan") ? { ...v, info: legacy("usePlan") } : v;
  };

  const groups: FieldGroup[] = editGroups().map((g) => ({
    title: g.title,
    fields: g.items.flatMap(({ main, children }) => {
      // 한 항목이 칸 두 개(2ND: 보고 내용 + AD열)면 첫 칸 아래에 나머지를 붙인다
      const [first, ...rest] = main.map(view);
      return first ? [{ ...first, children: [...rest, ...children.map(view)] }] : [];
    }),
  }));
  groups.push({
    title: "장표 추가 항목 (간편등록 양식에 없는 칸)",
    fields: [
      { id: "edit-no", label: "No.", hint: "B열 · 수정 불가", value: sale.no || "없음 (UMNP)", readOnly: true },
      ...extraColumnKeys().map((key) =>
        columnView(key, COLUMN_LABEL[key], `${COLUMN_LETTER[key]}열`),
      ),
    ],
  });

  return (
    <>
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
        <p className="font-semibold">판매 수정</p>
        <p className="mt-0.5 text-xs">
          간편등록과 같은 항목·순서입니다. 바꾼 칸만 저장됩니다. 장표 칸은 같은
          행에, &ldquo;장표 저장 안 함 (참고)&rdquo; 항목은 웹앱 보관 시트에
          저장되며 바꾸지 않은 참고 항목은 그대로 남습니다. No.·개통일은 수정할
          수 없고 N·U·AB·AC는 장표 수식이 자동 계산합니다. 카드 종류(AF)에
          카드사명을 넣으면 제카(AE)는 O, 카드실적 검수(AG)는 빈칸으로 함께
          저장됩니다.
        </p>
      </div>
      <section className="rounded-xl border border-line px-4 py-4">
        <SaleFieldGroups groups={groups} />
      </section>
    </>
  );
}

function changeValueText(key: ColumnKey, value: string): string {
  if (value.trim() === "") return "(빈칸)";
  if (isAmountKey(key)) {
    const amount = parseEditAmount(value);
    if (typeof amount === "number") return `${formatNumber(amount)}원`;
  }
  return value;
}

/** 저장 전 "변경된 항목" 확인 */
function ChangeList({
  changes,
  notes,
}: {
  changes: SaleChange[];
  notes: NoteChange[];
}) {
  return (
    <section aria-label="변경된 항목" className="rounded-xl border border-line">
      <h3 className="border-b border-line bg-zinc-50 px-4 py-2.5 text-sm font-bold text-ink">
        변경된 항목 {changes.length + notes.length}개
      </h3>
      <ul className="divide-y divide-line">
        {changes.map(({ key, before, after, auto, autoNote }) => (
          <li key={key} className="px-4 py-3 text-sm">
            <p className="font-semibold text-ink">
              {changeLabel(key)}
              {auto && (
                <span className="ml-1.5 rounded bg-amber-50 px-1.5 py-0.5 text-[11px] font-semibold text-amber-700">
                  {autoNote ?? "카드 종류 변경으로 자동"}
                </span>
              )}
            </p>
            <p className="mt-1 text-ink-sub">
              기존:{" "}
              <span className="whitespace-pre-wrap text-ink">
                {changeValueText(key, before)}
              </span>
            </p>
            <p className="text-ink-sub">
              변경:{" "}
              <span className="font-semibold whitespace-pre-wrap text-brand">
                {changeValueText(key, after)}
              </span>
            </p>
          </li>
        ))}
        {notes.map((n) => (
          <li key={n.field} className="px-4 py-3 text-sm">
            <p className="font-semibold text-ink">
              {noteLabel(n.field)}
              <span className="ml-1.5 rounded bg-zinc-100 px-1.5 py-0.5 text-[11px] font-semibold text-ink-muted">
                참고 · 장표 저장 안 함
              </span>
            </p>
            <p className="mt-1 text-ink-sub">
              기존:{" "}
              <span className="whitespace-pre-wrap text-ink">
                {n.before || "(빈칸)"}
              </span>
            </p>
            <p className="text-ink-sub">
              변경:{" "}
              <span className="font-semibold whitespace-pre-wrap text-brand">
                {n.after || "(빈칸)"}
              </span>
            </p>
          </li>
        ))}
      </ul>
      <p className="border-t border-line px-4 py-2.5 text-xs text-ink-muted">
        [수정 저장]을 누르면 장표의 같은 행에 위 항목만 반영됩니다.
        {notes.length > 0 &&
          " 참고 항목은 장표가 아니라 웹앱 보관 시트에 저장되며, 바꾸지 않은 참고 항목은 그대로 남습니다."}
      </p>
    </section>
  );
}
