"use client";

import { useEffect, useRef, useState } from "react";
import { postDeleteSale } from "@/lib/delete-sale-api";
import { formatCtn } from "@/lib/format";
import { amountText, dateText } from "@/lib/sale-display";
import {
  COLUMN_LABEL,
  COLUMN_LETTER,
  type ColumnKey,
} from "@/lib/sheet-columns";
import type { SheetSale } from "@/lib/sheet-record";

/* 판매 1건 상세 보기 (장표 A~AL 그대로) + 판매 삭제 */

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
    keys: [
      "spot",
      "securedDicho",
      "appleMania",
      "securedSecond",
      "modelPolicy",
      "securedTotal",
    ],
    strong: ["securedTotal"],
  },
  {
    title: "4. 고객혜택 / 고객혜택사용",
    keys: [
      "customerBenefit",
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

function valueText(sale: SheetSale, key: ColumnKey): string {
  const value = (sale as Record<string, unknown>)[key];
  if (typeof value === "number" || value === null) return amountText(value);
  const text = String(value ?? "");
  if (key === "activatedAt" || key === "wiredAvailableDate")
    return dateText(text);
  if (key === "ctn") return text ? formatCtn(text) : "";
  return text;
}

export function SaleDetail({
  sheet,
  sale,
  onClose,
  onDeleted,
}: {
  sheet: string;
  sale: SheetSale;
  onClose: () => void;
  onDeleted: (message: string) => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // 삭제 요청 중에는 창을 닫지 않는다 (Esc·배경 클릭·닫기 버튼 모두)
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
    if (result.ok) onDeleted(result.message);
    else setDeleteError(result.message);
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
              {sheet} 시트 · {sale.row}행 · No.{sale.no}
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
            disabled={deleting}
            className="h-9 shrink-0 rounded-lg border border-line px-3 text-sm font-semibold text-ink-sub hover:bg-zinc-50"
          >
            닫기
          </button>
        </header>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-5">
          {SECTIONS.map((section) => (
            <section
              key={section.title}
              className="rounded-xl border border-line"
            >
              <h3 className="border-b border-line bg-zinc-50 px-4 py-2.5 text-sm font-bold text-ink">
                {section.title}
              </h3>
              <dl className="divide-y divide-line">
                {section.keys.map((key) => (
                  <div
                    key={key}
                    className="flex items-start justify-between gap-4 px-4 py-2.5 text-sm"
                  >
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
                ))}
              </dl>
            </section>
          ))}
        </div>

        <footer className="border-t border-line px-5 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
          {deleteError && (
            <p
              role="alert"
              className="mb-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700"
            >
              ⚠ {deleteError}
            </p>
          )}
          <button
            type="button"
            onClick={handleDelete}
            disabled={deleting}
            aria-busy={deleting}
            className="flex h-11 w-full items-center justify-center gap-2 rounded-lg border border-rose-300 bg-white text-[15px] font-semibold text-rose-600 hover:bg-rose-50 disabled:cursor-wait disabled:opacity-70"
          >
            {deleting && (
              <span
                aria-hidden
                className="h-4 w-4 animate-spin rounded-full border-2 border-rose-200 border-t-rose-600"
              />
            )}
            {deleting ? "삭제 중..." : "판매 삭제"}
          </button>
          <p className="mt-1.5 text-center text-xs text-ink-muted">
            장표의 행과 No.는 그대로 두고 이 판매 건의 입력 내용만 지웁니다.
          </p>
        </footer>
      </div>
    </div>
  );
}
