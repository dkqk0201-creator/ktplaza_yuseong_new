"use client";

import { useState } from "react";
import { SaleDetail } from "@/components/sale-detail";
import {
  useFreshSalesData,
  useSalesData,
} from "@/components/sales-data-provider";
import { SalesDataGate, sheetLabel } from "@/components/sales-data-status";
import { EmptyBox, Notice } from "@/components/work-ui";
import { formatCtn, formatNumber } from "@/lib/format";
import {
  NO_POLICY_NAME_LABEL,
  buildPolicyReport,
  matchPolicyName,
  policyGroupKey,
  type PolicyEntry,
  type PolicyGroup,
} from "@/lib/model-policy";
import { monthDayText } from "@/lib/sale-display";
import type { SheetSale } from "@/lib/sheet-record";
import { isUmnpSale } from "@/lib/umnp";

/*
 * 예산관리 → 모델정책 정산 (선택한 월 시트 기준, 조회 + 판매 상세에서 정책명 수정).
 * 대상 = S열 모델정책 금액이 0 이 아니거나 정책명이 있는 판매 (UMNP 포함, 예산과 같은 기준).
 * 정책명이 없는 판매는 "정책명 없음" 으로 항상 따로 보여 준다 (누락 없음).
 */

export function ModelPolicyView() {
  useFreshSalesData();
  return (
    <SalesDataGate>
      {(data) => (
        // 월이 바뀌면 검색·선택을 처음으로
        <ModelPolicyBody key={data.sheet} sheet={data.sheet} sales={data.sales} />
      )}
    </SalesDataGate>
  );
}

function Won({ value }: { value: number }) {
  return (
    <span className={value < 0 ? "text-rose-600" : undefined}>
      {formatNumber(value)}
      <span className="ml-0.5 text-xs font-normal text-ink-muted">원</span>
    </span>
  );
}

const UNNAMED_ID = "__unnamed__";
const groupId = (g: PolicyGroup) =>
  g.name ? `n:${policyGroupKey(g.name)}` : UNNAMED_ID;

function ModelPolicyBody({ sheet, sales }: { sheet: string; sales: SheetSale[] }) {
  const { invalidate } = useSalesData();
  const report = buildPolicyReport(sales);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [detailRow, setDetailRow] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const visibleNamed = report.named.filter((g) => matchPolicyName(g.name, query));
  const unnamed = report.unnamed;
  const tableGroups = [...visibleNamed, ...(unnamed.count > 0 ? [unnamed] : [])];
  const selectedGroup =
    [...report.named, unnamed].find((g) => groupId(g) === selected) ?? null;
  // 고객 목록: 선택한 정책명 / 선택이 없으면 검색 결과 전체 (검색어가 없으면 정책명 없음 포함)
  const entries: { entry: PolicyEntry; group: PolicyGroup }[] = selectedGroup
    ? selectedGroup.entries.map((entry) => ({ entry, group: selectedGroup }))
    : [...visibleNamed, ...(query.trim() ? [] : [unnamed])].flatMap((group) =>
        group.entries.map((entry) => ({ entry, group })),
      );
  const listAmount = entries.reduce((sum, e) => sum + e.entry.amount, 0);
  const detail = detailRow === null ? null : sales.find((s) => s.row === detailRow) ?? null;

  const toggle = (id: string) => setSelected((cur) => (cur === id ? null : id));

  return (
    <div className="space-y-4">
      {notice && <Notice message={notice} onClose={() => setNotice(null)} />}

      <section
        aria-label="모델정책 합계"
        className="grid grid-cols-2 gap-3 lg:grid-cols-4"
      >
        {(
          [
            ["모델정책 판매", `${formatNumber(report.total.count)}건`, "S열 금액 또는 정책명이 있는 판매"],
            ["S열 모델정책 합계", report.total.amount, "대상 판매 S열 합계"],
            ["정책명 수", `${formatNumber(report.named.length)}개`, "정책명별 묶음"],
            [
              "정책명 없음",
              `${formatNumber(unnamed.count)}건 · ${formatNumber(unnamed.amount)}원`,
              "정책명을 아직 입력하지 않은 판매",
            ],
          ] as const
        ).map(([label, value, hint]) => (
          <div
            key={label}
            className={`rounded-xl border bg-white p-4 ${
              label === "정책명 없음" && unnamed.count > 0
                ? "border-amber-300"
                : "border-line"
            }`}
          >
            <p className="text-xs font-medium text-ink-sub">{label}</p>
            <p className="mt-1 text-lg font-bold text-ink tabular-nums">
              {typeof value === "number" ? <Won value={value} /> : value}
            </p>
            <p className="mt-1 text-[11px] text-ink-muted">{hint}</p>
          </div>
        ))}
      </section>

      {report.unlinkableCount > 0 && (
        <p
          role="alert"
          className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900"
        >
          ⚠ 정책명을 연결할 수 없는 판매 {report.unlinkableCount}건: 개통일·CTN 이
          없거나, 같은 개통일·고객명·CTN 판매가 2건 이상입니다. 다른 고객에 정책명이
          붙지 않도록 이 판매는 &ldquo;{NO_POLICY_NAME_LABEL}&rdquo;으로 보이고
          정책명을 저장할 수 없습니다.
        </p>
      )}

      <div className="relative">
        <label htmlFor="policy-search" className="sr-only">
          정책명 검색
        </label>
        <input
          id="policy-search"
          type="search"
          enterKeyHint="search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSelected(null);
          }}
          placeholder="정책명 검색 (일부만 입력해도 됩니다)"
          autoComplete="off"
          className="h-11 w-full rounded-lg border border-line bg-white pr-10 pl-3 text-base outline-none focus:border-brand focus:ring-2 focus:ring-brand/15"
        />
        {query && (
          <button
            type="button"
            onClick={() => {
              setQuery("");
              setSelected(null);
            }}
            aria-label="검색어 지우기"
            className="absolute top-1/2 right-2 -translate-y-1/2 rounded px-1.5 text-lg text-ink-muted hover:text-ink"
          >
            ×
          </button>
        )}
      </div>

      {report.total.count === 0 ? (
        <EmptyBox text="이 월 시트에 S열 모델정책 금액이나 정책명이 있는 판매가 없습니다." />
      ) : (
        <section
          aria-label={`${sheetLabel(sheet)} 정책명별 정산`}
          className="overflow-x-auto rounded-xl border border-line bg-white"
        >
          <table className="w-full min-w-[360px] text-sm">
            <caption className="border-b border-line px-4 py-3 text-left text-sm font-bold text-ink">
              {sheetLabel(sheet)} 정책명별 정산
              <span className="ml-2 text-xs font-normal text-ink-muted">
                정책명을 누르면 그 정책의 고객만
              </span>
            </caption>
            <thead className="bg-zinc-50 text-xs text-ink-sub">
              <tr>
                <th scope="col" className="px-4 py-2.5 text-left font-semibold">정책명</th>
                <th scope="col" className="px-4 py-2.5 text-right font-semibold">건수</th>
                <th scope="col" className="px-4 py-2.5 text-right font-semibold">모델정책 합계</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line tabular-nums">
              {visibleNamed.length === 0 && query.trim() && (
                <tr>
                  <td colSpan={3} className="px-4 py-4 text-center text-sm text-ink-sub">
                    &ldquo;{query.trim()}&rdquo; 정책명이 없습니다.
                  </td>
                </tr>
              )}
              {tableGroups.map((g) => {
                const id = groupId(g);
                const active = id === selected;
                const isUnnamed = !g.name;
                return (
                  <tr
                    key={id}
                    className={
                      active
                        ? "bg-brand-soft/40"
                        : isUnnamed
                          ? "bg-amber-50/60"
                          : undefined
                    }
                  >
                    <th scope="row" className="px-4 py-2.5 text-left">
                      <button
                        type="button"
                        onClick={() => toggle(id)}
                        aria-expanded={active}
                        className={`text-left font-semibold underline-offset-2 hover:underline ${
                          isUnnamed ? "text-amber-800" : "text-brand"
                        }`}
                      >
                        {g.label}
                      </button>
                    </th>
                    <td className="px-4 py-2.5 text-right text-ink">
                      {formatNumber(g.count)}
                      <span className="ml-0.5 text-xs text-ink-muted">건</span>
                    </td>
                    <td className="px-4 py-2.5 text-right font-semibold text-ink">
                      <Won value={g.amount} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="border-t-2 border-line bg-brand-soft/40 tabular-nums">
              <tr>
                <th scope="row" className="px-4 py-2.5 text-left font-bold text-ink">
                  전체 (정책명 없음 포함)
                </th>
                <td className="px-4 py-2.5 text-right font-bold text-ink">
                  {formatNumber(report.total.count)}
                  <span className="ml-0.5 text-xs font-normal text-ink-muted">건</span>
                </td>
                <td className="px-4 py-2.5 text-right font-bold text-ink">
                  <Won value={report.total.amount} />
                </td>
              </tr>
            </tfoot>
          </table>
        </section>
      )}

      {report.total.count > 0 && (
        <section
          aria-label="고객 목록"
          className="overflow-x-auto rounded-xl border border-line bg-white"
        >
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line px-4 py-3">
            <h3 className="text-sm font-bold text-ink">
              {selectedGroup
                ? `${selectedGroup.label} 고객`
                : query.trim()
                  ? `"${query.trim()}" 검색 결과 고객`
                  : "전체 고객"}{" "}
              {formatNumber(entries.length)}건 · {formatNumber(listAmount)}원
            </h3>
            {selectedGroup && (
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="text-xs font-medium text-ink-sub underline underline-offset-2"
              >
                선택 해제
              </button>
            )}
            <span className="ml-auto text-xs text-ink-muted">
              고객을 누르면 판매 상세 (정책명 수정 가능)
            </span>
          </div>
          {entries.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-ink-sub">
              해당하는 판매가 없습니다.
            </p>
          ) : (
            <table className="w-full min-w-[640px] text-sm">
              <thead className="bg-zinc-50 text-xs text-ink-sub">
                <tr>
                  <th scope="col" className="px-3 py-2.5 text-left font-semibold">정책명</th>
                  <th scope="col" className="px-3 py-2.5 text-left font-semibold">개통일</th>
                  <th scope="col" className="px-3 py-2.5 text-left font-semibold">고객명</th>
                  <th scope="col" className="px-3 py-2.5 text-left font-semibold">CTN</th>
                  <th scope="col" className="px-3 py-2.5 text-left font-semibold">직원명</th>
                  <th scope="col" className="px-3 py-2.5 text-right font-semibold">모델정책 금액</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line tabular-nums text-ink">
                {entries.map(({ entry, group }) => (
                  <tr
                    key={entry.sale.row}
                    onClick={() => setDetailRow(entry.sale.row)}
                    className="cursor-pointer hover:bg-zinc-50"
                  >
                    <td className="px-3 py-2.5">
                      {group.name ? (
                        <span className="break-all">{group.name}</span>
                      ) : (
                        <span className="font-semibold text-amber-700">
                          {NO_POLICY_NAME_LABEL}
                        </span>
                      )}
                      {entry.unlinkable && (
                        <span className="mt-0.5 block text-[11px] text-amber-700">
                          연결 불가 (같은 개통일·고객·CTN 2건 이상 또는 CTN 없음)
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      {monthDayText(entry.sale.activatedAt) || "-"}
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setDetailRow(entry.sale.row);
                        }}
                        className="font-semibold text-ink underline-offset-2 hover:underline"
                      >
                        {entry.sale.customer || "(고객명 없음)"}
                      </button>
                      {isUmnpSale(entry.sale) && (
                        <span className="ml-1.5 rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-semibold text-amber-800">
                          UMNP
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      {formatCtn(entry.sale.ctn) || "-"}
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      {entry.sale.staff || "-"}
                    </td>
                    <td className="px-3 py-2.5 text-right whitespace-nowrap font-semibold">
                      <Won value={entry.amount} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}

      <p className="text-xs leading-relaxed text-ink-muted">
        모델정책 금액 = S열(모델정책) 값 · 대상 = S열 금액 또는 정책명이 있는 판매
        (UMNP 포함) · 정책명은 장표에 저장하지 않고 웹앱 보관 시트에 판매
        건별(개통일·고객명·CTN)로 보관하므로 날짜 정렬·No. 변경에도 다른 고객에
        붙지 않습니다 · 같은 정책명은 띄어쓰기·대소문자 차이를 무시하고 묶습니다.
      </p>

      {detail && (
        <SaleDetail
          sheet={sheet}
          sale={detail}
          onClose={() => setDetailRow(null)}
          onDeleted={(message) => {
            setDetailRow(null);
            setNotice(message);
            void invalidate();
          }}
          onUpdated={(message) => {
            setNotice(message);
            void invalidate();
          }}
        />
      )}
    </div>
  );
}
