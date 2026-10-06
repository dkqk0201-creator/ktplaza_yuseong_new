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
import {
  COLUMN_LABEL,
  COLUMN_LETTER,
  type ColumnKey,
} from "@/lib/sheet-columns";
import { parseSheetRow, type SheetSale } from "@/lib/sheet-record";

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
type NoteRow = { id: string; label: string; always?: boolean };
const NOTES_BEFORE: Partial<Record<ColumnKey, NoteRow[]>> = {
  usedPhoneSale: [{ id: "usedPhone", label: "중고폰&현물 판매", always: true }],
};
const NOTES_AFTER: Partial<Record<ColumnKey, NoteRow[]>> = {
  usedModelPlan: [
    { id: "useInstallment", label: "고혜(기존할부금)" },
    { id: "usePlan", label: "고혜(요금)" },
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
                판매보고
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
}: {
  sheet: string;
  sale: SheetSale;
  /** true 면 수정·삭제 버튼 없이 보기만 */
  readOnly?: boolean;
  onClose: () => void;
  onDeleted?: (message: string) => void;
  onUpdated?: (message: string) => void;
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
  const changes = mode === "view" ? [] : diffSale(sale, edited);
  const fieldErrors = validateEdits(changes);

  // 삭제·수정 요청 중에는 창을 닫지 않는다 (Esc·배경 클릭·닫기 버튼 모두)
  const deletingRef = useRef(false);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);
  const close = () => {
    if (!deletingRef.current) onCloseRef.current();
  };

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
    setUpdateError(null);
    setUpdateNotice(null);
    setDeleteError(null);
    setMode("edit");
  }

  async function handleUpdate(list: SaleChange[]) {
    if (deletingRef.current || list.length === 0) return;
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
    });
    deletingRef.current = false;
    setSaving(false);
    if (result.ok) {
      // 참고내용은 장표 값이 아니므로 수정 응답에 없다 → 보던 참고내용을 그대로 유지
      // (고객명·CTN 을 바꾸면 Apps Script 가 참고내용 연결 키도 함께 옮긴다)
      const next = parseSheetRow(result.row, result.no, result.values);
      setUpdated(sale.notes ? { ...next, notes: sale.notes } : next);
      setMode("view");
      setEdited({});
      setUpdateNotice(`${result.message} (${list.length}개 항목)`);
      onUpdated?.(result.message);
    } else {
      setUpdateError(result.message);
    }
  }

  // 상세창이 열릴 때 한 번만 실행
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !deletingRef.current) onCloseRef.current();
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
            disabled={deleting || saving}
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
          {mode === "view" && <SaleView sale={sale} />}
          {mode === "edit" && (
            <SaleEditForm
              sale={sale}
              edited={edited}
              errors={fieldErrors}
              onChange={(key, value) =>
                setEdited((prev) => ({ ...prev, [key]: value }))
              }
            />
          )}
          {mode === "confirm" && <ChangeList changes={changes} />}
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
            {mode === "view" && (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={startEdit}
                    disabled={deleting}
                    className="h-11 rounded-lg bg-ink text-[15px] font-semibold text-white disabled:opacity-60"
                  >
                    판매 수정
                  </button>
                  <button
                    type="button"
                    onClick={handleDelete}
                    disabled={deleting}
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
                    changes.length === 0 || Object.keys(fieldErrors).length > 0
                  }
                  className="h-11 rounded-lg bg-ink text-[15px] font-semibold text-white disabled:opacity-40"
                >
                  변경 확인 ({changes.length})
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
                  onClick={() => void handleUpdate(changes)}
                  disabled={saving || changes.length === 0}
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
                <NoteRows sale={sale} rows={NOTES_AFTER[key]} />
              </Fragment>
            ))}
          </dl>
        </section>
      ))}
    </>
  );
}

/** 수정 입력창: 섹션별로 장표 칸 이름과 열을 함께 보여준다. No.·개통일은 고칠 수 없다. */
function SaleEditForm({
  sale,
  edited,
  errors,
  onChange,
}: {
  sale: SheetSale;
  edited: Partial<Record<ColumnKey, string>>;
  errors: Partial<Record<ColumnKey, string>>;
  onChange: (key: ColumnKey, value: string) => void;
}) {
  return (
    <>
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
        <p className="font-semibold">판매 수정</p>
        <p className="mt-0.5 text-xs">
          바꾼 칸만 장표의 같은 행에 저장됩니다. No.와 개통일은 수정할 수
          없습니다. N(O~T 합계)·U(V~Y 합계)·AB(Z−AA)·AC(N+U+AB)는 장표
          수식이 자동으로 계산합니다. 카드
          종류(AF)에 카드사명을 넣으면 제카(AE)는 O, 카드실적 검수(AG)는
          빈칸으로 함께 저장됩니다.
        </p>
      </div>
      <section className="rounded-xl border border-line">
        <dl className="divide-y divide-line">
          {(
            [
              ["No.", "B", sale.no || "없음 (UMNP)"],
              ["개통일", "C", monthDayText(sale.activatedAt)],
            ] as const
          ).map(([label, letter, value]) => (
            <div
              key={label}
              className="flex items-center justify-between gap-4 px-4 py-2.5 text-sm"
            >
              <dt className="text-ink-sub">
                {label}
                <span className="ml-1.5 text-[11px] text-ink-muted">
                  {letter}열
                </span>
              </dt>
              <dd className="text-right text-ink tabular-nums">
                {value || "-"}{" "}
                <span className="ml-1 rounded bg-zinc-100 px-1.5 py-0.5 text-[11px] text-ink-muted">
                  수정 불가
                </span>
              </dd>
            </div>
          ))}
        </dl>
      </section>
      {SECTIONS.map((section) => {
        const keys = section.keys.filter((k) => k !== "activatedAt");
        return (
          <section
            key={section.title}
            className="rounded-xl border border-line"
          >
            <h3 className="border-b border-line bg-zinc-50 px-4 py-2.5 text-sm font-bold text-ink">
              {section.title}
            </h3>
            <div className="space-y-3 px-4 py-3">
              {keys.map((key) => {
                // N·U·AB·AC: 장표 행별 수식 → 직접 수정하지 않고, 입력값 기준 계산값만 보여준다
                if (isRowFormulaKey(key)) {
                  return (
                    <div
                      key={key}
                      className="flex items-center justify-between gap-4 rounded-lg bg-zinc-50 px-3 py-2.5 text-sm"
                    >
                      <span className="text-xs font-semibold text-ink-sub">
                        {COLUMN_LABEL[key]}
                        <span className="ml-1.5 font-normal text-ink-muted">
                          {COLUMN_LETTER[key]}열
                        </span>
                      </span>
                      <span className="text-right text-ink tabular-nums">
                        {formatNumber(rowFormulaValues(sale, edited)[key])}원
                        <span className="ml-1.5 rounded bg-zinc-100 px-1.5 py-0.5 text-[11px] text-ink-muted">
                          {ROW_FORMULA_NOTE[key]}
                        </span>
                      </span>
                    </div>
                  );
                }
                const id = `edit-${key}`;
                const original = editText(sale, key);
                const value = edited[key] ?? original;
                const changed =
                  key in edited && value.trim() !== original.trim();
                return (
                  <div key={key}>
                    <label
                      htmlFor={id}
                      className="flex items-baseline gap-1.5 text-xs font-semibold text-ink-sub"
                    >
                      {COLUMN_LABEL[key]}
                      <span className="font-normal text-ink-muted">
                        {COLUMN_LETTER[key]}열
                      </span>
                      {changed && (
                        <span className="ml-auto font-semibold text-brand">
                          변경됨
                        </span>
                      )}
                    </label>
                    {key === "customerPromise" ? (
                      <textarea
                        id={id}
                        rows={2}
                        value={value}
                        onChange={(e) => onChange(key, e.target.value)}
                        className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-base outline-none focus:border-brand"
                      />
                    ) : (
                      <input
                        id={id}
                        value={value}
                        inputMode={isAmountKey(key) ? "numeric" : undefined}
                        onChange={(e) => onChange(key, e.target.value)}
                        aria-invalid={errors[key] ? true : undefined}
                        className={`mt-1 h-10 w-full rounded-lg border px-3 text-base outline-none focus:border-brand ${
                          errors[key]
                            ? "border-rose-400 bg-rose-50/40"
                            : changed
                              ? "border-brand/50 bg-rose-50/20"
                              : "border-line"
                        } ${isAmountKey(key) ? "text-right tabular-nums" : ""}`}
                      />
                    )}
                    {errors[key] && (
                      <p className="mt-0.5 text-xs font-medium text-rose-600">
                        {errors[key]}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
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
function ChangeList({ changes }: { changes: SaleChange[] }) {
  return (
    <section aria-label="변경된 항목" className="rounded-xl border border-line">
      <h3 className="border-b border-line bg-zinc-50 px-4 py-2.5 text-sm font-bold text-ink">
        변경된 항목 {changes.length}개
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
      </ul>
      <p className="border-t border-line px-4 py-2.5 text-xs text-ink-muted">
        [수정 저장]을 누르면 장표의 같은 행에 위 항목만 반영됩니다.
      </p>
    </section>
  );
}
