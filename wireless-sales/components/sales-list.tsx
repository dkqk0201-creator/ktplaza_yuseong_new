"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CategoryBadge } from "@/components/category-badge";
import { useSalesData } from "@/components/sales-data-provider";
import { postDeleteSale } from "@/lib/delete-sale-api";
import { formatCtn, formatNumber } from "@/lib/format";
import { amountText, dateText, maskedCtn, sumAmount } from "@/lib/sale-display";
import type { SheetSale } from "@/lib/sheet-record";

/* 장표에서 불러온 판매내역 목록 + 상세 보기 */

function matches(sale: SheetSale, keyword: string): boolean {
  const k = keyword.replace(/\s/g, "").toLowerCase();
  if (!k) return true;
  return [sale.customer, sale.ctn.replace(/\D/g, ""), sale.model, sale.staff]
    .join("|")
    .replace(/\s/g, "")
    .toLowerCase()
    .includes(k.replace(/-/g, ""));
}

export function SalesList({
  sheet,
  sales,
}: {
  sheet: string;
  sales: SheetSale[];
}) {
  const { invalidate } = useSalesData();
  const [keyword, setKeyword] = useState("");
  const [selectedRow, setSelectedRow] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const filtered = useMemo(
    () => sales.filter((sale) => matches(sale, keyword)),
    [sales, keyword],
  );
  const selected = sales.find((sale) => sale.row === selectedRow) ?? null;

  const sum = (pick: (s: SheetSale) => number | null) => sumAmount(sales, pick);

  return (
    <>
      {/* 요약 */}
      <section
        aria-label={`${sheet} 시트 요약`}
        className="grid grid-cols-2 gap-3 lg:grid-cols-4"
      >
        <SummaryCard label={`${sheet} 등록 건수`} value={`${sales.length}건`} />
        <SummaryCard
          label="총 확보금액 합계"
          value={`${formatNumber(sum((s) => s.securedTotal))}원`}
        />
        <SummaryCard
          label="총 사용금액 합계"
          value={`${formatNumber(sum((s) => s.usedTotal))}원`}
        />
        <SummaryCard
          label="최종 합계"
          value={`${formatNumber(sum((s) => s.finalTotal))}원`}
          emphasis
        />
      </section>

      {notice && (
        <div
          role="status"
          className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800"
        >
          <span>✓ {notice}</span>
          <button
            type="button"
            onClick={() => setNotice(null)}
            className="text-xs font-medium text-emerald-700 underline underline-offset-2"
          >
            닫기
          </button>
        </div>
      )}

      {/* 검색·새로고침 */}
      <div className="mt-6 mb-3 flex flex-wrap items-center gap-2">
        <h2 className="mr-auto text-lg font-bold text-ink">{sheet} 판매내역</h2>
        <input
          type="search"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          placeholder="고객명·CTN·모델·직원 검색"
          aria-label="판매내역 검색"
          className="h-10 w-full rounded-lg border border-line bg-white px-3 text-base outline-none focus:border-brand focus:ring-2 focus:ring-brand/15 sm:w-64 sm:text-sm"
        />
      </div>

      {sales.length === 0 ? (
        <EmptyBox text={`${sheet} 시트에 등록된 판매내역이 없습니다.`} />
      ) : filtered.length === 0 ? (
        <EmptyBox text="검색 결과가 없습니다." />
      ) : (
        <>
          {/* PC·태블릿: 표 */}
          <div className="hidden overflow-x-auto rounded-xl border border-line bg-white md:block">
            <table className="w-full min-w-[980px] text-sm">
              <thead className="border-b border-line bg-zinc-50">
                <tr>
                  {[
                    "No.",
                    "개통일",
                    "고객",
                    "CTN",
                    "구분",
                    "모델명",
                    "요금제",
                    "직원명",
                  ].map((h) => (
                    <th
                      key={h}
                      className="px-3 py-3 text-left text-xs font-semibold whitespace-nowrap text-ink-sub"
                    >
                      {h}
                    </th>
                  ))}
                  {["총 확보금액", "총 사용금액", "최종 합계"].map((h) => (
                    <th
                      key={h}
                      className="px-3 py-3 text-right text-xs font-semibold whitespace-nowrap text-ink-sub"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {filtered.map((sale) => (
                  <tr
                    key={sale.row}
                    onClick={() => setSelectedRow(sale.row)}
                    className="cursor-pointer hover:bg-zinc-50"
                  >
                    <td className="px-3 py-3.5 whitespace-nowrap text-ink-muted tabular-nums">
                      {/* 키보드로도 열 수 있도록 No.를 버튼으로 둔다 */}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedRow(sale.row);
                        }}
                        aria-label={`No.${sale.no} ${sale.customer} 상세 보기`}
                        className="rounded font-medium text-ink-sub underline-offset-2 hover:underline"
                      >
                        {sale.no || "-"}
                      </button>
                    </td>
                    <td className="px-3 py-3.5 whitespace-nowrap text-ink-sub tabular-nums">
                      {dateText(sale.activatedAt)}
                    </td>
                    <td className="px-3 py-3.5 font-medium whitespace-nowrap text-ink">
                      {sale.customer || "-"}
                    </td>
                    <td className="px-3 py-3.5 whitespace-nowrap text-ink-sub tabular-nums">
                      {sale.ctn ? maskedCtn(sale.ctn) : "-"}
                    </td>
                    <td className="px-3 py-3.5">
                      <CategoryBadge category={sale.category} />
                    </td>
                    <td className="px-3 py-3.5 whitespace-nowrap text-ink">
                      {sale.model || "-"}
                    </td>
                    <td className="px-3 py-3.5 whitespace-nowrap text-ink-sub">
                      {sale.plan || "-"}
                    </td>
                    <td className="px-3 py-3.5 whitespace-nowrap text-ink">
                      {sale.staff || "-"}
                    </td>
                    <td className="px-3 py-3.5 text-right font-semibold whitespace-nowrap text-ink tabular-nums">
                      {amountText(sale.securedTotal)}
                    </td>
                    <td className="px-3 py-3.5 text-right font-semibold whitespace-nowrap text-ink tabular-nums">
                      {amountText(sale.usedTotal)}
                    </td>
                    <td className="px-3 py-3.5 text-right font-bold whitespace-nowrap text-ink tabular-nums">
                      {amountText(sale.finalTotal)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* 모바일: 카드 목록 */}
          <ul className="space-y-3 md:hidden">
            {filtered.map((sale) => (
              <li key={sale.row}>
                <button
                  type="button"
                  onClick={() => setSelectedRow(sale.row)}
                  className="w-full rounded-xl border border-line bg-white p-4 text-left active:bg-zinc-50"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-ink-muted tabular-nums">
                        No.{sale.no}
                      </span>
                      <CategoryBadge category={sale.category} />
                    </div>
                    <span className="text-xs text-ink-sub tabular-nums">
                      {dateText(sale.activatedAt)}
                    </span>
                  </div>
                  <div className="mt-2.5 flex items-baseline justify-between gap-2">
                    <span className="text-base font-semibold text-ink">
                      {sale.customer || "-"}
                    </span>
                    <span className="text-sm text-ink-sub tabular-nums">
                      {sale.ctn ? maskedCtn(sale.ctn) : "-"}
                    </span>
                  </div>
                  <p className="mt-1 truncate text-sm text-ink-sub">
                    {[sale.model, sale.plan, sale.staff]
                      .filter(Boolean)
                      .join(" · ") || "-"}
                  </p>
                  <div className="mt-3 flex items-center justify-between border-t border-line pt-3 text-sm">
                    <span className="text-ink-muted">최종 합계</span>
                    <span className="font-bold text-ink tabular-nums">
                      {amountText(sale.finalTotal)}
                    </span>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {selected && (
        <SaleDetail
          sheet={sheet}
          sale={selected}
          onClose={() => setSelectedRow(null)}
          onDeleted={(message) => {
            setSelectedRow(null);
            setNotice(message);
            // 공유 데이터를 무효화하고 장표에서 다시 읽는다 (대시보드도 함께 갱신)
            void invalidate();
          }}
        />
      )}
    </>
  );
}

function SummaryCard({
  label,
  value,
  emphasis = false,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border bg-white p-4 ${emphasis ? "border-brand/30" : "border-line"}`}
    >
      <p className="text-xs font-medium text-ink-sub">{label}</p>
      <p
        className={`mt-1.5 truncate text-lg font-bold tabular-nums sm:text-xl ${emphasis ? "text-brand" : "text-ink"}`}
      >
        {value}
      </p>
    </div>
  );
}

function EmptyBox({ text }: { text: string }) {
  return (
    <div className="rounded-xl border border-dashed border-line bg-white px-6 py-14 text-center text-sm text-ink-sub">
      {text}
    </div>
  );
}

/* ---------- 상세 보기 ---------- */

type DetailItem = {
  label: string;
  column: string;
  value: string;
  strong?: boolean;
};

function DetailSection({
  title,
  items,
}: {
  title: string;
  items: DetailItem[];
}) {
  return (
    <section className="rounded-xl border border-line">
      <h3 className="border-b border-line bg-zinc-50 px-4 py-2.5 text-sm font-bold text-ink">
        {title}
      </h3>
      <dl className="divide-y divide-line">
        {items.map((item) => (
          <div
            key={item.column}
            className="flex items-start justify-between gap-4 px-4 py-2.5 text-sm"
          >
            <dt className="shrink-0 text-ink-sub">
              {item.label}
              <span className="ml-1.5 text-[11px] text-ink-muted">
                {item.column}열
              </span>
            </dt>
            <dd
              className={`text-right break-all whitespace-pre-wrap tabular-nums ${item.strong ? "font-bold text-ink" : "text-ink"}`}
            >
              {item.value || "-"}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function SaleDetail({
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

  const a = amountText;

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

        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))]">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              ["총 확보금액", sale.securedTotal],
              ["총 사용금액", sale.usedTotal],
              ["중고 잔여", sale.usedPhoneRemaining],
              ["최종 합계", sale.finalTotal],
            ].map(([label, value]) => (
              <div
                key={label as string}
                className="rounded-lg bg-zinc-50 px-3 py-2.5"
              >
                <p
                  className={`text-[11px] ${label === "최종 합계" ? "font-semibold text-brand" : "text-ink-muted"}`}
                >
                  {label as string}
                </p>
                <p
                  className={`mt-0.5 truncate text-sm font-bold tabular-nums ${label === "최종 합계" ? "text-brand" : "text-ink"}`}
                >
                  {a(value as number | null)}
                </p>
              </div>
            ))}
          </div>

          <DetailSection
            title="1. 기본 개통정보"
            items={[
              {
                label: "개통일",
                column: "C",
                value: dateText(sale.activatedAt),
              },
              { label: "고객", column: "D", value: sale.customer },
              {
                label: "CTN",
                column: "E",
                value: sale.ctn ? formatCtn(sale.ctn) : "",
              },
              { label: "개통구분", column: "H", value: sale.category },
              { label: "모델명", column: "I", value: sale.model },
              { label: "요금제", column: "J", value: sale.plan },
              {
                label: "요금제 유지/변경",
                column: "K",
                value: sale.planChange,
              },
              { label: "직원명", column: "L", value: sale.staff },
              {
                label: "추후 고객약속",
                column: "A",
                value: sale.customerPromise,
              },
            ]}
          />
          <DetailSection
            title="2. 업무 처리 확인"
            items={[
              { label: "검수", column: "F", value: sale.inspected },
              { label: "수납", column: "G", value: sale.paid },
            ]}
          />
          <DetailSection
            title="3. 확보금액"
            items={[
              { label: "SPOT 정책", column: "N", value: a(sale.spot) },
              { label: "디초/삼초", column: "O", value: a(sale.securedDicho) },
              { label: "애플매니아", column: "P", value: a(sale.appleMania) },
              { label: "2ND", column: "Q", value: a(sale.securedSecond) },
              { label: "모델인센", column: "R", value: a(sale.modelIncentive) },
              {
                label: "총 확보금액",
                column: "M",
                value: a(sale.securedTotal),
                strong: true,
              },
            ]}
          />
          <DetailSection
            title="4. 고객혜택 / 사용금액"
            items={[
              {
                label: "고객혜택 총액",
                column: "S",
                value: a(sale.customerBenefitTotal),
              },
              { label: "모델/요금", column: "U", value: a(sale.usedModelPlan) },
              { label: "디초/삼초", column: "V", value: a(sale.usedDicho) },
              { label: "2ND", column: "W", value: a(sale.usedSecond) },
              { label: "민원건", column: "X", value: a(sale.complaint) },
              {
                label: "총 사용금액",
                column: "T",
                value: a(sale.usedTotal),
                strong: true,
              },
            ]}
          />
          <DetailSection
            title="5. 중고판매"
            items={[
              { label: "판매금액", column: "Y", value: a(sale.usedPhoneSale) },
              { label: "사용금액", column: "Z", value: a(sale.usedPhoneUsed) },
              {
                label: "잔여금액",
                column: "AA",
                value: a(sale.usedPhoneRemaining),
                strong: true,
              },
            ]}
          />
          <DetailSection
            title="6. 추가 관리"
            items={[
              {
                label: "2ND 실적",
                column: "AC",
                value: sale.secondPerformance,
              },
              { label: "제카 실적", column: "AD", value: sale.jecaPerformance },
              { label: "판매무기 종류", column: "AE", value: sale.weaponType },
              {
                label: "판매무기 등록",
                column: "AF",
                value: sale.weaponRegistered,
              },
              {
                label: "제카 확보예산",
                column: "AG",
                value: a(sale.jecaBudget),
              },
              { label: "필S", column: "AH", value: sale.pilS },
              { label: "필L", column: "AI", value: sale.pilL },
              { label: "동판", column: "AJ", value: sale.dongpan },
              {
                label: "유선 가능일",
                column: "AK",
                value: dateText(sale.wiredAvailableDate),
              },
            ]}
          />
          <DetailSection
            title="합계"
            items={[
              {
                label: "최종 합계",
                column: "AB",
                value: a(sale.finalTotal),
                strong: true,
              },
            ]}
          />
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
