"use client";

import { useMemo, useState } from "react";
import { useSalesData } from "@/components/sales-data-provider";
import { SaleFieldGroups, type FieldView } from "@/components/sale-fields";
import { LINK_HINT } from "@/lib/sale-form-layout";
import {
  CAMPAIGN_MAX,
  INFLOW_MISSING,
  INFLOW_SOURCES,
  emptyLink,
  linkValueError,
  usedCampaigns,
  type SaleLink,
  type SaleLinkField,
} from "@/lib/sale-link";
import type { SheetSale } from "@/lib/sheet-record";

/*
 * 판매 상세의 "판매연결" 칸: 유입경로·캠페인·굿바이를 보고 고친다 (판매 수정 저장과 따로 저장).
 * - 저장 위치: 보조 시트 "웹앱판매연결" (판매 고유 ID 로 연결, 월 시트 열은 그대로)
 * - 예전 판매(ID 없음)는 처음 저장할 때 그 행에만 ID 를 만든다 (행·No.·개통일·고객·CTN 확인 후)
 * - 같은 ID 가 다른 행에도 있으면(시트에서 행 복사 등) 저장하지 않고 "확인 필요"로 보여 준다
 */

const EDITABLE: readonly SaleLinkField[] = ["inflow", "campaign", "goodbye"];
const LABEL: Record<string, string> = { inflow: "유입경로", campaign: "캠페인", goodbye: "굿바이" };

export function SaleLinkPanel({
  sheet,
  sale,
  readOnly,
  onSaved,
}: {
  sheet: string;
  sale: SheetSale;
  readOnly: boolean;
  onSaved: (next: SheetSale, message: string) => void;
}) {
  const { data } = useSalesData();
  const campaigns = useMemo(() => usedCampaigns(data?.sales ?? []), [data]);
  const current = sale.link ?? emptyLink();
  const [draft, setDraft] = useState<Partial<Record<SaleLinkField, string>>>({});
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  const state = sale.saleIdState;
  const duplicate = state === "duplicate";
  // Apps Script 가 판매 ID 상태를 돌려주지 않으면(sale-link.gs 미배포) 저장할 수 없다
  const unavailable = state === undefined;
  const locked = readOnly || duplicate || unavailable || saving;

  const valueOf = (f: SaleLinkField) => draft[f] ?? current[f];
  const changed = EDITABLE.filter((f) => valueOf(f).trim() !== current[f].trim());
  const problems = Object.fromEntries(EDITABLE.map((f) => [f, linkValueError(f, valueOf(f))]));
  const canSave = !locked && changed.length > 0 && EDITABLE.every((f) => !problems[f]);

  const view = (f: SaleLinkField): FieldView => ({
    id: `sale-link-${f}`,
    label: LABEL[f],
    hint: LINK_HINT,
    note: true,
    value: valueOf(f),
    onChange: locked ? undefined : (v) => setDraft((d) => ({ ...d, [f]: v })),
    disabled: locked,
    changed: valueOf(f).trim() !== current[f].trim(),
    options: f === "inflow" ? INFLOW_SOURCES : f === "goodbye" ? ["O", "X"] : undefined,
    suggestions: f === "campaign" ? campaigns : undefined,
    maxLength: f === "campaign" ? CAMPAIGN_MAX : undefined,
    placeholder: f === "inflow" ? INFLOW_MISSING : f === "goodbye" ? "미입력" : "선택 입력",
    problems: problems[f] ? [problems[f]!] : undefined,
    info: f === "goodbye" ? "중고폰 보상판매 실적 표시 (인정 기준 확정 전 — O 만 실적)" : undefined,
  });

  async function save() {
    if (!canSave) return;
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
          patches: changed.map((f) => ({ field: f, before: current[f], value: valueOf(f).trim() })),
        }),
      });
      const body = (await response.json()) as { ok: boolean; saleId?: string; link?: SaleLink; message?: string };
      if (body.ok && body.saleId && body.link) {
        setDraft({});
        const next: SheetSale = { ...sale, saleId: body.saleId, saleIdState: "ok", link: body.link };
        setMessage({ tone: "ok", text: "판매연결 정보를 저장했습니다." });
        onSaved(next, "판매연결 정보(유입경로·캠페인·굿바이)를 저장했습니다.");
      } else {
        setMessage({ tone: "error", text: body.message || "저장하지 못했습니다." });
      }
    } catch {
      setMessage({ tone: "error", text: "서버와 통신하지 못했습니다. 저장되었는지 새로고침해 확인해 주세요." });
    }
    setSaving(false);
  }

  return (
    <section className="rounded-xl border border-dashed border-line px-4 py-4" aria-label="판매연결">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h4 className="text-sm font-bold text-ink">판매연결 (유입경로·캠페인·굿바이)</h4>
        <span className="text-xs text-ink-muted">
          {state === "ok" ? "판매 ID 있음" : state === "none" ? "판매 ID 없음 — 처음 저장할 때 이 판매에만 만듭니다" : ""}
        </span>
      </div>
      {duplicate && (
        <p role="alert" className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">
          같은 판매 ID 가 장표의 다른 행에도 있습니다 (시트에서 행을 복사한 경우 등). 잘못된 판매에 연결되지 않도록
          판매연결을 보여 주거나 저장하지 않습니다. 점장 확인이 필요합니다.
        </p>
      )}
      {unavailable && (
        <p className="mb-3 rounded-lg bg-zinc-100 px-3 py-2 text-sm text-ink-sub">
          판매연결 기능이 아직 스프레드시트(Apps Script)에 배포되지 않아 저장할 수 없습니다.
        </p>
      )}
      <SaleFieldGroups groups={[{ title: "판매연결", fields: EDITABLE.map(view) }]} />
      {!readOnly && !duplicate && !unavailable && (
        <div className="mt-3 flex items-center gap-3">
          <button
            type="button"
            onClick={() => void save()}
            disabled={!canSave}
            className="rounded-lg bg-brand px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
          >
            {saving ? "저장 중…" : "판매연결 저장"}
          </button>
          {changed.length > 0 && !saving && (
            <button type="button" onClick={() => setDraft({})} className="text-sm font-semibold text-ink-muted underline">
              되돌리기
            </button>
          )}
        </div>
      )}
      {message && (
        <p role={message.tone === "error" ? "alert" : "status"} className={`mt-2 text-sm font-semibold ${message.tone === "error" ? "text-rose-600" : "text-emerald-700"}`}>
          {message.text}
        </p>
      )}
    </section>
  );
}
