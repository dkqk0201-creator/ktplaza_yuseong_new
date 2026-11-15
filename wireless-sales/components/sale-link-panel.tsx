"use client";

import { useState } from "react";
import { SaleFieldGroups, type FieldView } from "@/components/sale-fields";
import { useSalesConfig } from "@/components/use-sales-config";
import { LINK_HINT } from "@/lib/sale-form-layout";
import { CAMPAIGN_MAX, emptyLink, linkValueError, type SaleLink, type SaleLinkField } from "@/lib/sale-link";
import { selectableInflows } from "@/lib/inflow-options";
import { linkSummary } from "@/lib/sale-link-edit";
import type { SheetSale } from "@/lib/sheet-record";

/*
 * 판매 상세의 "판매연결" 칸 (유입경로·캠페인·리본) — 2026-11-15부터 보기 전용.
 * 고칠 때는 [판매 수정]에서 판매 내용과 함께 한 번에 저장한다 (lib/sale-link-edit.ts).
 * 이 칸에서 직접 저장하는 경우는 두 가지뿐:
 *   - 판매 수정은 저장됐는데 판매연결만 저장하지 못했을 때: "판매연결만 다시 저장" (판매 내용은 다시 쓰지 않음)
 *   - 판매의 개통일·CTN 이 판매연결 기록과 다를 때(장표에서 값만 옮긴 경우 등): "새 판매 ID 로 다시 연결"
 * 같은 ID 가 다른 행에도 있으면(시트에서 행 복사 등) 연결 정보를 보여 주지도 저장하지도 않는다.
 */

const RELINK_FIELDS: readonly SaleLinkField[] = ["inflow", "campaign", "goodbye"];
const LABEL: Record<string, string> = { inflow: "유입경로", campaign: "캠페인", goodbye: "리본" };

export interface PendingLink {
  patches: { field: SaleLinkField; before: string; value: string }[];
}

export function SaleLinkPanel({
  sheet,
  sale,
  readOnly,
  pending,
  onSaved,
}: {
  sheet: string;
  sale: SheetSale;
  readOnly: boolean;
  /** 판매 수정 때 저장하지 못한 판매연결 변경 (다시 저장용) */
  pending?: PendingLink | null;
  onSaved: (next: SheetSale, message: string) => void;
}) {
  const { config } = useSalesConfig();
  const [draft, setDraft] = useState<Partial<Record<SaleLinkField, string>>>({});
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [relink, setRelink] = useState(false);

  const state = sale.saleIdState;
  const duplicate = state === "duplicate";
  const mismatch = state === "mismatch";
  // Apps Script 가 판매 ID 상태를 돌려주지 않으면(sale-link.gs 미배포) 저장할 수 없다
  const unavailable = state === undefined;
  const summary = linkSummary(sale, config.inflows, config.campaigns);

  async function post(patches: PendingLink["patches"], extra: Record<string, unknown>, okText: string) {
    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch("/api/sales/link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          target: { sheet, row: sale.row, no: sale.no, activatedAt: sale.activatedAt, customer: sale.customer, ctn: sale.ctn },
          saleId: sale.saleId ?? "",
          staff: sale.staff,
          patches,
          ...extra,
        }),
      });
      const body = (await response.json()) as { ok: boolean; saleId?: string; link?: SaleLink; message?: string };
      if (body.ok && body.saleId && body.link) {
        setDraft({});
        setRelink(false);
        setMessage({ tone: "ok", text: okText });
        onSaved({ ...sale, saleId: body.saleId, saleIdState: "ok", link: body.link }, okText);
      } else {
        setMessage({ tone: "error", text: body.message || "저장하지 못했습니다." });
      }
    } catch {
      setMessage({ tone: "error", text: "서버와 통신하지 못했습니다. 저장되었는지 새로고침해 확인해 주세요." });
    }
    setSaving(false);
  }

  // 다시 연결(relink): 유입경로·캠페인 원문·리본을 새로 입력
  const valueOf = (f: SaleLinkField) => draft[f] ?? "";
  const relinkChanged = RELINK_FIELDS.filter((f) => valueOf(f).trim() !== "");
  const problems = Object.fromEntries(RELINK_FIELDS.map((f) => [f, linkValueError(f, valueOf(f), config.inflows)]));
  const canRelink = relink && !saving && relinkChanged.length > 0 && RELINK_FIELDS.every((f) => !problems[f]);
  const view = (f: SaleLinkField): FieldView => ({
    id: `sale-link-${f}`,
    label: LABEL[f],
    hint: LINK_HINT,
    note: true,
    value: valueOf(f),
    onChange: saving ? undefined : (v) => setDraft((d) => ({ ...d, [f]: v })),
    disabled: saving,
    options: f === "inflow" ? selectableInflows(config.inflows) : f === "goodbye" ? ["O", "X"] : undefined,
    suggestions: f === "campaign" ? config.campaigns.filter((c) => c.active).map((c) => c.name) : undefined,
    maxLength: f === "campaign" ? CAMPAIGN_MAX : undefined,
    placeholder: f === "inflow" ? "미입력" : f === "goodbye" ? "판정 안 함" : "없음",
    problems: problems[f] ? [problems[f]!] : undefined,
  });

  return (
    <section className="rounded-xl border border-dashed border-line px-4 py-4" aria-label="판매연결">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h4 className="text-sm font-bold text-ink">판매연결 (유입경로·캠페인·리본)</h4>
        <span className="text-xs text-ink-muted">
          {state === "ok" ? "판매 ID 있음" : state === "none" ? "판매 ID 없음 — 판매 수정에서 처음 저장할 때 이 판매에만 만듭니다" : ""}
        </span>
      </div>
      {duplicate && (
        <p role="alert" className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">
          같은 판매 ID 가 장표의 다른 행에도 있습니다 (시트에서 행을 복사한 경우 등). 잘못된 판매에 연결되지 않도록
          판매연결을 보여 주거나 저장하지 않습니다. 점장 확인이 필요합니다.
        </p>
      )}
      {mismatch && (
        <div role="alert" className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <p className="font-semibold">
            이 판매의 개통일·CTN 이 저장된 판매연결 기록과 다릅니다 (장표에서 값만 옮기거나 직접 고친 경우 등).
            다른 판매의 유입경로가 붙지 않도록 연결 정보를 보여 주지 않습니다.
          </p>
          {!readOnly && !relink && (
            <button type="button" onClick={() => setRelink(true)} className="mt-2 rounded-lg border border-amber-600 px-3 py-1.5 text-sm font-semibold text-amber-900">
              새 판매 ID 로 다시 연결 (유입경로를 새로 입력)
            </button>
          )}
          {relink && <p className="mt-1 text-xs">예전 기록은 옮기지 않고 분리됩니다. 아래에 유입경로 등을 새로 입력해 저장하세요.</p>}
        </div>
      )}
      {unavailable && (
        <p className="mb-3 rounded-lg bg-zinc-100 px-3 py-2 text-sm text-ink-sub">
          판매연결 기능이 아직 스프레드시트(Apps Script)에 배포되지 않아 저장할 수 없습니다.
        </p>
      )}
      {!duplicate && !mismatch && (
        <dl className="divide-y divide-line rounded-lg border border-line text-sm">
          {(
            [
              ["유입경로", summary.inflow],
              ["캠페인", summary.campaign],
              ["리본", summary.ribbon],
            ] as const
          ).map(([label, value]) => (
            <div key={label} className="flex items-start justify-between gap-4 px-3 py-2">
              <dt className="shrink-0 text-ink-sub">{label}</dt>
              <dd className="text-right text-ink">{value}</dd>
            </div>
          ))}
        </dl>
      )}
      {!readOnly && !duplicate && !mismatch && !unavailable && !pending && (
        <p className="mt-2 text-xs text-ink-muted">고칠 때는 아래 [판매 수정]에서 판매 내용과 함께 저장합니다.</p>
      )}
      {!readOnly && pending && !mismatch && !duplicate && (
        <div role="alert" className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          <p className="font-semibold">판매 수정은 저장됐지만 판매연결은 저장하지 못했습니다.</p>
          <button
            type="button"
            onClick={() => void post(pending.patches, {}, "판매연결 정보를 저장했습니다.")}
            disabled={saving}
            className="mt-2 rounded-lg bg-rose-600 px-3 py-1.5 text-sm font-bold text-white disabled:opacity-50"
          >
            {saving ? "저장 중…" : "판매연결만 다시 저장"}
          </button>
        </div>
      )}
      {relink && (
        <>
          <SaleFieldGroups groups={[{ title: "판매연결 다시 입력", fields: RELINK_FIELDS.map(view) }]} />
          <div className="mt-3 flex items-center gap-3">
            <button
              type="button"
              onClick={() =>
                void post(
                  relinkChanged.map((f) => ({ field: f, before: "", value: valueOf(f).trim() })),
                  { relink: true },
                  "새 판매 ID 로 다시 연결했습니다.",
                )
              }
              disabled={!canRelink}
              className="rounded-lg bg-brand px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
            >
              {saving ? "저장 중…" : "다시 연결 저장"}
            </button>
            <button type="button" onClick={() => { setRelink(false); setDraft({}); }} className="text-sm font-semibold text-ink-muted underline">
              취소
            </button>
          </div>
        </>
      )}
      {message && (
        <p role={message.tone === "error" ? "alert" : "status"} className={`mt-2 text-sm font-semibold ${message.tone === "error" ? "text-rose-600" : "text-emerald-700"}`}>
          {message.text}
        </p>
      )}
    </section>
  );
}
