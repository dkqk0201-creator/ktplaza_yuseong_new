"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { copyText } from "@/components/copy-text";
import { OXMark } from "@/components/inspection-view";
import {
  useFreshSalesData,
  useSalesData,
} from "@/components/sales-data-provider";
import { SalesDataGate } from "@/components/sales-data-status";
import {
  EmptyBox,
  FilterChips,
  Notice,
  StaffSelect,
  StatusBadge,
  SummaryTile,
} from "@/components/work-ui";
import { postCardCheck } from "@/lib/card-check-api";
import {
  cardName,
  cardPendingListMessage,
  cardPendingMessage,
  isCardTarget,
} from "@/lib/card-message";
import { formatCtn } from "@/lib/format";
import { dateText } from "@/lib/sale-display";
import { isO, type SheetSale } from "@/lib/sheet-record";

/*
 * 카드실적: 제카(AE) = O 인 판매 중 카드실적 검수(AG)가 O 가 아닌 건을 찾는다.
 * 제카가 O 가 아닌 판매는 목록에 나오지 않는다. 카드 종류는 AF열 값을 보여준다.
 * 점장이 장표 AG 칸에 O 를 입력하고 새로고침하면 완료로 바뀐다.
 * 행을 누르면 상세보기, 미검수 건은 직원에게 보낼 카톡용 글을 복사할 수 있다 (CTN 은 전체 번호).
 * 미검수 상세의 "등록완료": 장표 AG열만 O 로 저장 → Apps Script 저장 확인 후에만 화면을 완료로 바꾼다.
 */

type CheckResult = { ok: true; message: string } | { ok: false; message: string };

/** 등록완료한 판매 표시용 키: 행 + CTN 숫자 + 고객 (행만으로 다른 판매에 잘못 붙지 않게) */
function saleKey(s: SheetSale): string {
  return `${s.row}|${s.ctn.replace(/\D/g, "")}|${s.customer}`;
}

type Filter = "pending" | "all" | "done";

export function cardSales(sales: SheetSale[]): SheetSale[] {
  return sales.filter(isCardTarget);
}

export function CardView() {
  useFreshSalesData();
  return (
    <SalesDataGate>
      {(data) => (
        // 월이 바뀌면 등록완료 표시 상태도 새로 시작
        <CardList key={data.sheet} sheet={data.sheet} sales={data.sales} />
      )}
    </SalesDataGate>
  );
}

function CardList({ sheet, sales }: { sheet: string; sales: SheetSale[] }) {
  const { invalidate } = useSalesData();
  const [filter, setFilter] = useState<Filter>("pending");
  // 이 화면에서 등록완료(장표 저장 확인됨)한 판매 — 다시 읽기 전에도 바로 완료로 보이게
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set());
  const [staff, setStaff] = useState("");
  const [selectedRow, setSelectedRow] = useState<number | null>(null);
  const [copyState, setCopyState] = useState<
    { ok: true; message: string } | { ok: false; text: string } | null
  >(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => clearTimeout(hideTimer.current ?? undefined), []);

  async function copy(text: string, message: string) {
    clearTimeout(hideTimer.current ?? undefined);
    if (await copyText(text)) {
      setCopyState({ ok: true, message });
      hideTimer.current = setTimeout(() => setCopyState(null), 2500);
    } else {
      // 자동 복사가 막힌 환경: 글을 보여주고 직접 복사하게 한다
      setCopyState({ ok: false, text });
    }
  }

  const cards = useMemo(
    () =>
      cardSales(sales).map((s) =>
        !isO(s.cardChecked) && checked.has(saleKey(s))
          ? { ...s, cardChecked: "O" }
          : s,
      ),
    [sales, checked],
  );

  /** 등록완료: 장표 AG = O 저장이 확인된 뒤에만 화면을 완료로 */
  async function complete(sale: SheetSale): Promise<CheckResult> {
    const result = await postCardCheck({
      target: {
        sheet,
        row: sale.row,
        no: sale.no,
        activatedAt: sale.activatedAt,
        customer: sale.customer,
        ctn: sale.ctn,
      },
      before: sale.cardChecked,
    });
    if (!result.ok) return result;
    setChecked((prev) => new Set(prev).add(saleKey(sale)));
    void invalidate(); // 다른 화면(검수관리 등)도 최신 장표를 다시 읽도록
    return { ok: true, message: result.message };
  }
  const staffNames = useMemo(
    () => [...new Set(cards.map((s) => s.staff).filter(Boolean))].sort(),
    [cards],
  );
  const byStaff = cards.filter((s) => !staff || s.staff === staff);
  const done = byStaff.filter((s) => isO(s.cardChecked));
  const pending = byStaff.filter((s) => !isO(s.cardChecked));
  const rows = (filter === "all" ? byStaff : filter === "done" ? done : pending)
    .slice()
    .sort((a, b) => a.row - b.row);
  const selected = cards.find((s) => s.row === selectedRow) ?? null;

  return (
    <>
      {copyState?.ok && (
        <Notice
          message={copyState.message}
          onClose={() => setCopyState(null)}
        />
      )}
      {copyState && !copyState.ok && (
        <ManualCopy text={copyState.text} onClose={() => setCopyState(null)} />
      )}
      <section aria-label="카드실적 요약" className="grid grid-cols-3 gap-3">
        <SummaryTile
          label="총 카드건수"
          value={`${byStaff.length}건`}
          active={filter === "all"}
          onClick={() => setFilter("all")}
        />
        <SummaryTile
          label="검수완료"
          value={`${done.length}건`}
          tone="good"
          active={filter === "done"}
          onClick={() => setFilter("done")}
        />
        <SummaryTile
          label="미검수"
          value={`${pending.length}건`}
          tone={pending.length ? "warn" : "default"}
          active={filter === "pending"}
          onClick={() => setFilter("pending")}
        />
      </section>

      <div className="mt-5 mb-3 flex flex-wrap items-center gap-2">
        <FilterChips
          label="카드실적 검수 상태"
          value={filter}
          onChange={setFilter}
          options={[
            { value: "pending", label: "미검수", count: pending.length },
            { value: "all", label: "전체", count: byStaff.length },
            { value: "done", label: "완료", count: done.length },
          ]}
        />
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <StaffSelect staff={staffNames} value={staff} onChange={setStaff} />
          <button
            type="button"
            onClick={() =>
              void copy(
                cardPendingListMessage(pending),
                `미검수 ${pending.length}건 카톡용 내용이 복사되었습니다.`,
              )
            }
            disabled={pending.length === 0}
            className="h-9 rounded-lg bg-brand px-3 text-sm font-semibold text-white disabled:opacity-40"
          >
            미검수 전체 복사{staff ? ` (${staff})` : ""}
          </button>
        </div>
      </div>

      {rows.length === 0 ? (
        <EmptyBox
          text={
            cards.length === 0
              ? "제카(카드)가 있는 판매가 없습니다."
              : "조건에 맞는 카드 판매가 없습니다."
          }
        />
      ) : (
        <>
          <div className="hidden overflow-x-auto rounded-xl border border-line bg-white md:block">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="border-b border-line bg-zinc-50 text-xs text-ink-sub">
                <tr>
                  {[
                    "No.",
                    "개통일",
                    "직원명",
                    "고객",
                    "CTN",
                    "카드 종류",
                    "카드실적 검수",
                    "상태",
                  ].map((h) => (
                    <th
                      key={h}
                      className="px-3 py-3 text-left font-semibold whitespace-nowrap"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((sale) => (
                  <tr
                    key={sale.row}
                    onClick={() => setSelectedRow(sale.row)}
                    className="cursor-pointer hover:bg-zinc-50"
                  >
                    <td className="px-3 py-3 text-ink-muted tabular-nums">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedRow(sale.row);
                        }}
                        aria-label={`No.${sale.no || "없음"} ${sale.customer} 카드 상세 보기`}
                        className="font-medium text-ink-sub hover:underline"
                      >
                        {sale.no || "-"}
                      </button>
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap text-ink-sub tabular-nums">
                      {dateText(sale.activatedAt)}
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap text-ink">
                      {sale.staff || "-"}
                    </td>
                    <td className="px-3 py-3 font-medium whitespace-nowrap text-ink">
                      {sale.customer || "-"}
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap text-ink-sub tabular-nums">
                      {sale.ctn ? formatCtn(sale.ctn) : "-"}
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap text-ink">
                      {cardName(sale)}
                    </td>
                    <td className="px-3 py-3">
                      <OXMark value={sale.cardChecked} />
                    </td>
                    <td className="px-3 py-3">
                      <StatusBadge
                        tone={isO(sale.cardChecked) ? "good" : "warn"}
                      >
                        {isO(sale.cardChecked) ? "완료" : "미검수"}
                      </StatusBadge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <ul className="space-y-2.5 md:hidden">
            {rows.map((sale) => (
              <li key={sale.row}>
                <button
                  type="button"
                  onClick={() => setSelectedRow(sale.row)}
                  className="w-full rounded-xl border border-line bg-white p-4 text-left active:bg-zinc-50"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-ink-muted tabular-nums">
                      No.{sale.no || "-"} · {dateText(sale.activatedAt)}
                    </span>
                    <StatusBadge tone={isO(sale.cardChecked) ? "good" : "warn"}>
                      {isO(sale.cardChecked) ? "완료" : "미검수"}
                    </StatusBadge>
                  </div>
                  <div className="mt-2 flex items-baseline justify-between gap-2">
                    <span className="text-base font-semibold text-ink">
                      {sale.customer || "-"}
                    </span>
                    <span className="text-sm font-semibold text-ink">
                      {cardName(sale)}
                    </span>
                  </div>
                  <div className="mt-1 flex justify-between text-sm text-ink-sub">
                    <span>{sale.staff || "-"}</span>
                    <span className="tabular-nums">
                      {sale.ctn ? formatCtn(sale.ctn) : ""}
                    </span>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="mt-3 text-xs text-ink-muted">
        미검수 상세의 [등록완료]를 누르면 장표 카드실적 검수(AG열)에 O 가
        저장되고 바로 완료로 바뀝니다. 장표 AG열에 직접 O 를 입력한 경우는
        새로고침하면 완료로 바뀝니다.
      </p>

      {selected && (
        <CardDetail
          sale={selected}
          copyNotice={copyState}
          onCopy={() =>
            void copy(
              cardPendingMessage(selected),
              "카톡용 내용이 복사되었습니다.",
            )
          }
          onComplete={() => complete(selected)}
          onClose={() => setSelectedRow(null)}
        />
      )}
    </>
  );
}

function ManualCopy({ text, onClose }: { text: string; onClose: () => void }) {
  return (
    <div
      role="alert"
      className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold">
          자동 복사가 안 되는 환경입니다. 아래 내용을 길게 눌러 직접 복사해
          주세요.
        </span>
        <button
          type="button"
          onClick={onClose}
          className="text-xs font-medium underline underline-offset-2"
        >
          닫기
        </button>
      </div>
      <pre className="mt-2 rounded bg-white p-2 text-xs whitespace-pre-wrap text-ink">
        {text}
      </pre>
    </div>
  );
}

function CardDetail({
  sale,
  copyNotice,
  onCopy,
  onComplete,
  onClose,
}: {
  sale: SheetSale;
  copyNotice:
    | { ok: true; message: string }
    | { ok: false; text: string }
    | null;
  onCopy: () => void;
  onComplete: () => Promise<CheckResult>;
  onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const pending = !isO(sale.cardChecked);
  const [saving, setSaving] = useState(false);
  const [checkResult, setCheckResult] = useState<CheckResult | null>(null);
  // 저장 중에는 창을 닫지 않는다 (Esc·배경·닫기 모두)
  const savingRef = useRef(false);
  const close = () => {
    if (!savingRef.current) onCloseRef.current();
  };

  async function handleComplete() {
    if (savingRef.current) return; // 중복 클릭 방지
    savingRef.current = true;
    setSaving(true);
    setCheckResult(null);
    const result = await onComplete();
    savingRef.current = false;
    setSaving(false);
    setCheckResult(result);
  }

  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) =>
      e.key === "Escape" && !savingRef.current && onCloseRef.current();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const rows: [string, string][] = [
    ["No.", sale.no || "-"],
    ["개통일", dateText(sale.activatedAt)],
    ["직원명", sale.staff || "-"],
    ["고객명", sale.customer || "-"],
    ["CTN", sale.ctn ? formatCtn(sale.ctn) : "-"],
    ["카드 종류", cardName(sale)],
    [
      "카드실적 검수",
      pending ? `미검수 (${sale.cardChecked || "빈칸"})` : "완료 (O)",
    ],
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4"
      onClick={close}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="card-detail-title"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-t-2xl bg-white p-5 shadow-xl sm:rounded-2xl"
      >
        <div className="flex items-center justify-between gap-2">
          <h2 id="card-detail-title" className="text-lg font-bold text-ink">
            카드실적 상세
          </h2>
          <StatusBadge tone={pending ? "warn" : "good"}>
            {pending ? "미검수" : "완료"}
          </StatusBadge>
        </div>
        <dl className="mt-4 divide-y divide-line rounded-xl border border-line">
          {rows.map(([label, value]) => (
            <div key={label} className="flex justify-between gap-3 px-4 py-2.5">
              <dt className="text-sm text-ink-sub">{label}</dt>
              <dd className="text-right text-sm font-semibold text-ink tabular-nums">
                {value}
              </dd>
            </div>
          ))}
        </dl>
        {copyNotice?.ok && (
          <p
            role="status"
            className="mt-3 text-sm font-semibold text-emerald-700"
          >
            ✓ {copyNotice.message}
          </p>
        )}
        {checkResult && (
          <p
            role={checkResult.ok ? "status" : "alert"}
            className={`mt-3 text-sm font-semibold ${
              checkResult.ok ? "text-emerald-700" : "text-rose-600"
            }`}
          >
            {checkResult.ok ? `✓ ${checkResult.message}` : checkResult.message}
          </p>
        )}
        <div
          className={`mt-5 grid gap-2 ${pending ? "grid-cols-3" : "grid-cols-2"}`}
        >
          <button
            ref={closeRef}
            type="button"
            onClick={close}
            disabled={saving}
            className="h-11 rounded-lg border border-line text-[15px] font-semibold text-ink-sub hover:bg-zinc-50 disabled:opacity-40"
          >
            닫기
          </button>
          <button
            type="button"
            onClick={onCopy}
            disabled={!pending}
            title={pending ? undefined : "검수 완료된 카드입니다."}
            className="h-11 rounded-lg bg-brand text-[15px] font-semibold text-white disabled:opacity-40"
          >
            카톡용 복사
          </button>
          {pending && (
            <button
              type="button"
              onClick={() => void handleComplete()}
              disabled={saving}
              className="h-11 rounded-lg bg-emerald-600 text-[15px] font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
            >
              {saving ? "처리 중..." : "등록완료"}
            </button>
          )}
        </div>
        {!pending && (
          <p className="mt-2 text-center text-xs text-ink-muted">
            검수 완료된 카드는 안내를 보낼 필요가 없습니다.
          </p>
        )}
      </div>
    </div>
  );
}
