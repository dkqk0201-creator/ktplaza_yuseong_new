"use client";

import { useState } from "react";
import { publishSalesConfig, useSalesConfig } from "@/components/use-sales-config";
import { todayInKorea } from "@/lib/format";
import { inflowOptionsError, sortedOptions, type InflowOption } from "@/lib/inflow-options";
import {
  CAMPAIGN_STATUSES,
  CAMPAIGN_TYPES,
  campaignInputError,
  sortedCampaigns,
  suggestedStatus,
  type Campaign,
  type CampaignInput,
} from "@/lib/campaigns";
import { parseSalesConfig } from "@/lib/sales-config";

/*
 * 유입경로 항목 · 캠페인 관리 (점장 전용 — 유입·캠페인 분석 화면의 "항목 관리" 탭).
 * 저장은 운영 무선장표의 숨김 보조 시트(웹앱유입경로·웹앱캠페인·웹앱캠페인이력)에만. 월 시트는 바꾸지 않는다.
 *   - 유입경로: 항목 추가·사용 안 함·별칭·순서. 이름 변경·삭제는 없음 (판매에 저장된 이름이 깨지지 않게)
 *   - 캠페인: 등록·수정·사용 안 함 (삭제 없음). 이름을 바꿔도 캠페인ID 로 판매 연결 유지
 *   - 캠페인을 만든 뒤 "원문이 같은 판매 연결": 캠페인ID 없이 보고 원문만 있는 판매 중 이름·별칭이 같은 판매만 연결
 */

const splitList = (text: string) => text.split(",").map((a) => a.trim()).filter(Boolean);

export function SalesSettingsView() {
  const { config, loaded, error, reload } = useSalesConfig();
  // 저장하면 버전이 바뀌어 항목 표가 새로 그려지므로, 저장 결과 안내는 바깥에서 보관한다
  const [inflowMessage, setInflowMessage] = useState<SettingsMessage>(null);
  if (!loaded) return <p className="text-sm text-ink-muted">설정을 불러오는 중…</p>;
  return (
    <div className="space-y-8">
      {(error || config.fallback) && (
        <p role="alert" className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
          유입경로·캠페인 설정을 스프레드시트에서 읽지 못해 기본값을 보여 줍니다
          {error ? ` (${error})` : " (Apps Script 에 config-handler.gs 가 아직 없을 수 있습니다)"}.{" "}
          <button type="button" onClick={() => void reload()} className="font-semibold underline">다시 읽기</button>
        </p>
      )}
      <InflowSettings key={`inflow-${config.inflowVersion}`} options={config.inflows} version={config.inflowVersion} message={inflowMessage} setMessage={setInflowMessage} />
      <CampaignSettings campaigns={config.campaigns} version={config.campaignVersion} />
    </div>
  );
}

async function postJson(url: string, body: unknown): Promise<Record<string, unknown>> {
  try {
    const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return (await r.json()) as Record<string, unknown>;
  } catch {
    return { ok: false, message: "서버와 통신하지 못했습니다. 저장되었는지 새로고침해 확인해 주세요." };
  }
}

interface InflowRowDraft {
  name: string;
  aliases: string;
  active: boolean;
  order: string;
  isNew: boolean;
}

type SettingsMessage = { tone: "ok" | "error"; text: string } | null;

function InflowSettings({
  options,
  version,
  message,
  setMessage,
}: {
  options: InflowOption[];
  version: string;
  message: SettingsMessage;
  setMessage: (m: SettingsMessage) => void;
}) {
  const initial = (): InflowRowDraft[] =>
    sortedOptions(options).map((o) => ({ name: o.name, aliases: o.aliases.join(", "), active: o.active, order: String(o.order), isNew: false }));
  const [rows, setRows] = useState<InflowRowDraft[]>(initial);
  const [saving, setSaving] = useState(false);
  const items: InflowOption[] = rows.map((r) => ({ name: r.name.trim(), aliases: splitList(r.aliases), active: r.active, order: Number(r.order) }));
  const problem = inflowOptionsError(items, options);
  const dirty = JSON.stringify(rows) !== JSON.stringify(initial());
  const update = (i: number, patch: Partial<InflowRowDraft>) => setRows((prev) => prev.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  async function save() {
    if (problem || !dirty) return;
    setSaving(true);
    setMessage(null);
    const body = await postJson("/api/settings/inflow", { items, version });
    setSaving(false);
    if (body.ok === true) {
      publishSalesConfig(parseSalesConfig(body));
      setMessage({ tone: "ok", text: "유입경로 항목을 저장했습니다." });
    } else {
      setMessage({ tone: "error", text: String(body.message || "저장하지 못했습니다.") });
    }
  }

  const input = "h-9 w-full rounded-lg border border-line px-2.5 text-sm";
  return (
    <section aria-label="유입경로 항목" className="rounded-xl border border-line bg-white p-4">
      <h2 className="text-base font-bold text-ink">유입경로 항목</h2>
      <p className="mt-1 text-xs text-ink-sub">
        카톡 보고의 &ldquo;유입경로 :&rdquo; 값을 항목 이름·별칭과 비교해 자동으로 고릅니다 (띄어쓰기·대소문자 무시). 목록에 없는 표현은
        원문만 저장하고 &ldquo;확인 필요&rdquo;로 둡니다. &ldquo;미확인&rdquo;은 항목과 별도로 항상 고를 수 있습니다. 이미 저장된 판매가 있으므로 항목 이름은 바꾸거나 지울 수 없고, 대신 사용 안 함으로 바꿉니다.
      </p>
      <table className="mt-3 w-full text-sm">
        <thead className="text-xs text-ink-sub">
          <tr>
            <th scope="col" className="w-28 py-1.5 text-left font-semibold">항목</th>
            <th scope="col" className="py-1.5 text-left font-semibold">별칭 (쉼표로 구분)</th>
            <th scope="col" className="w-20 py-1.5 text-left font-semibold">순서</th>
            <th scope="col" className="w-20 py-1.5 text-left font-semibold">사용</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="align-top">
              <td className="py-1 pr-2">
                {r.isNew ? (
                  <input aria-label={`새 항목 ${i + 1} 이름`} value={r.name} maxLength={10} onChange={(e) => update(i, { name: e.target.value })} className={input} />
                ) : (
                  <span className="inline-block py-2 font-semibold text-ink">{r.name}</span>
                )}
              </td>
              <td className="py-1 pr-2">
                <input aria-label={`${r.name || "새 항목"} 별칭`} value={r.aliases} onChange={(e) => update(i, { aliases: e.target.value })} className={input} />
              </td>
              <td className="py-1 pr-2">
                <input aria-label={`${r.name || "새 항목"} 순서`} value={r.order} inputMode="numeric" onChange={(e) => update(i, { order: e.target.value.replace(/\D/g, "") })} className={input} />
              </td>
              <td className="py-1">
                <label className="inline-flex items-center gap-1.5 py-2 text-xs">
                  <input type="checkbox" checked={r.active} onChange={(e) => update(i, { active: e.target.checked })} />
                  {r.active ? "사용" : "사용 안 함"}
                </label>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {problem && dirty && <p role="alert" className="mt-2 text-sm font-semibold text-rose-600">{problem}</p>}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setRows((prev) => [...prev, { name: "", aliases: "", active: true, order: String(prev.length + 1), isNew: true }])}
          className="h-9 rounded-lg border border-line px-3 text-sm font-semibold text-ink-sub"
        >
          항목 추가
        </button>
        <button type="button" onClick={() => void save()} disabled={saving || !dirty || !!problem} className="h-9 rounded-lg bg-brand px-4 text-sm font-bold text-white disabled:opacity-50">
          {saving ? "저장 중…" : "유입경로 저장"}
        </button>
        {dirty && !saving && (
          <button type="button" onClick={() => setRows(initial())} className="text-sm font-semibold text-ink-muted underline">되돌리기</button>
        )}
      </div>
      {message && (
        <p role={message.tone === "error" ? "alert" : "status"} className={`mt-2 text-sm font-semibold ${message.tone === "error" ? "text-rose-600" : "text-emerald-700"}`}>
          {message.text}
        </p>
      )}
    </section>
  );
}

interface CampaignDraft {
  id?: string;
  name: string;
  aliases: string;
  type: string;
  start: string;
  end: string;
  status: string;
  active: boolean;
}

const emptyDraft = (): CampaignDraft => ({ name: "", aliases: "", type: "매장 행사", start: "", end: "", status: "진행", active: true });

function CampaignSettings({ campaigns, version }: { campaigns: Campaign[]; version: string }) {
  const today = todayInKorea();
  const [draft, setDraft] = useState<CampaignDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [attach, setAttach] = useState<{ id: string; name: string; count: number | null } | null>(null);
  const input: CampaignInput | null = draft
    ? { name: draft.name, aliases: splitList(draft.aliases), type: draft.type, start: draft.start, end: draft.end, status: draft.status, active: draft.active }
    : null;
  const problem = input ? campaignInputError(input, campaigns.filter((c) => c.id !== draft?.id)) : null;
  const suggestion = draft ? suggestedStatus(draft.start, draft.end, today) : null;

  async function save() {
    if (!draft || !input || problem) return;
    setSaving(true);
    setMessage(null);
    const body = await postJson("/api/settings/campaigns", { campaign: { ...(draft.id ? { id: draft.id } : {}), ...input }, version });
    setSaving(false);
    if (body.ok === true) {
      publishSalesConfig(parseSalesConfig(body));
      const id = String(body.id);
      setMessage({ tone: "ok", text: String(body.message || "저장했습니다.") });
      setDraft(null);
      // 원문이 같은 미연결 판매가 있는지 바로 확인 (연결은 점장이 누를 때만)
      const preview = await postJson("/api/settings/campaigns", { attach: { campaignId: id, apply: false } });
      const count = preview.ok === true ? Number(preview.count) : 0;
      setAttach(count > 0 ? { id, name: input.name, count } : null);
    } else {
      setMessage({ tone: "error", text: String(body.message || "저장하지 못했습니다.") });
    }
  }

  async function checkAttach(c: Campaign) {
    setMessage(null);
    const preview = await postJson("/api/settings/campaigns", { attach: { campaignId: c.id, apply: false } });
    if (preview.ok !== true) {
      setMessage({ tone: "error", text: String(preview.message || "확인하지 못했습니다.") });
      return;
    }
    setAttach({ id: c.id, name: c.name, count: Number(preview.count) });
  }

  async function applyAttach() {
    if (!attach) return;
    const body = await postJson("/api/settings/campaigns", { attach: { campaignId: attach.id, apply: true } });
    if (body.ok === true) {
      setMessage({ tone: "ok", text: `${attach.name}: ${body.count}건을 연결했습니다. 판매 목록은 새로고침하면 반영됩니다.` });
      setAttach(null);
    } else {
      setMessage({ tone: "error", text: String(body.message || "연결하지 못했습니다.") });
    }
  }

  const field = "h-9 w-full rounded-lg border border-line px-2.5 text-sm";
  return (
    <section aria-label="캠페인" className="rounded-xl border border-line bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-bold text-ink">캠페인</h2>
        <button type="button" onClick={() => { setDraft(emptyDraft()); setMessage(null); }} className="h-9 rounded-lg bg-ink px-3 text-sm font-semibold text-white">
          캠페인 등록
        </button>
      </div>
      <p className="mt-1 text-xs text-ink-sub">
        직원 보고의 &ldquo;캠페인 :&rdquo; 값이 캠페인명이나 별칭과 같을 때만 연결됩니다 (예: 캠페인명 &ldquo;2026년 11월 게릴라 세일&rdquo; + 별칭 &ldquo;11월 게릴라 세일&rdquo;). 행사 기간에 팔렸다는 이유만으로는 연결하지 않으며, 사전예약처럼 개통일이 기간을 넘어도 연결됩니다. 종료된 캠페인도 사용 중이면 계속 연결됩니다.
      </p>

      {draft && (
        <div className="mt-3 grid grid-cols-1 gap-3 rounded-lg border border-line p-3 md:grid-cols-2" aria-label="캠페인 입력">
          <label className="text-xs font-semibold text-ink-sub">
            캠페인명
            <input aria-label="캠페인명" value={draft.name} maxLength={40} onChange={(e) => setDraft({ ...draft, name: e.target.value })} className={`${field} mt-1`} />
          </label>
          <label className="text-xs font-semibold text-ink-sub">
            별칭 (쉼표로 구분, 직원이 보고에 쓰는 이름)
            <input aria-label="캠페인 별칭" value={draft.aliases} onChange={(e) => setDraft({ ...draft, aliases: e.target.value })} className={`${field} mt-1`} />
          </label>
          <label className="text-xs font-semibold text-ink-sub">
            유형
            <select aria-label="캠페인 유형" value={draft.type} onChange={(e) => setDraft({ ...draft, type: e.target.value })} className={`${field} mt-1 bg-white`}>
              {CAMPAIGN_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs font-semibold text-ink-sub">
              시작일
              <input type="date" aria-label="캠페인 시작일" value={draft.start} onChange={(e) => setDraft({ ...draft, start: e.target.value })} className={`${field} mt-1`} />
            </label>
            <label className="text-xs font-semibold text-ink-sub">
              종료일
              <input type="date" aria-label="캠페인 종료일" value={draft.end} onChange={(e) => setDraft({ ...draft, end: e.target.value })} className={`${field} mt-1`} />
            </label>
          </div>
          <label className="text-xs font-semibold text-ink-sub">
            상태 {suggestion && suggestion !== draft.status && <span className="font-normal text-amber-700">(기간으로 보면 {suggestion})</span>}
            <select aria-label="캠페인 상태" value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value })} className={`${field} mt-1 bg-white`}>
              {CAMPAIGN_STATUSES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          <label className="mt-5 inline-flex items-center gap-2 text-sm">
            <input type="checkbox" checked={draft.active} onChange={(e) => setDraft({ ...draft, active: e.target.checked })} />
            사용 (끄면 새 판매에 연결하지 않음, 지난 판매·조회는 그대로)
          </label>
          {problem && <p role="alert" className="text-sm font-semibold text-rose-600 md:col-span-2">{problem}</p>}
          <div className="flex gap-2 md:col-span-2">
            <button type="button" onClick={() => void save()} disabled={saving || !!problem} className="h-9 rounded-lg bg-brand px-4 text-sm font-bold text-white disabled:opacity-50">
              {saving ? "저장 중…" : draft.id ? "캠페인 수정 저장" : "캠페인 등록"}
            </button>
            <button type="button" onClick={() => setDraft(null)} className="h-9 rounded-lg border border-line px-3 text-sm font-semibold text-ink-sub">취소</button>
          </div>
        </div>
      )}

      {message && (
        <p role={message.tone === "error" ? "alert" : "status"} className={`mt-2 text-sm font-semibold ${message.tone === "error" ? "text-rose-600" : "text-emerald-700"}`}>
          {message.text}
        </p>
      )}
      {attach && (
        <div className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900" role="status">
          {attach.count === 0 ? (
            <>{attach.name}: 원문이 같은 미연결 판매가 없습니다.</>
          ) : (
            <>
              {attach.name}: 보고 원문이 이 캠페인 이름·별칭과 같은데 아직 연결되지 않은 판매가 {attach.count}건 있습니다.{" "}
              <button type="button" onClick={() => void applyAttach()} className="font-bold underline">원문이 같은 판매 연결</button>
            </>
          )}
        </div>
      )}

      {campaigns.length === 0 ? (
        <p className="mt-3 text-sm text-ink-muted">등록된 캠페인이 없습니다.</p>
      ) : (
        <ul className="mt-3 divide-y divide-line rounded-lg border border-line">
          {sortedCampaigns(campaigns).map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-2 px-3 py-2.5 text-sm">
              <span className="font-semibold text-ink">{c.name}</span>
              <span className="text-xs text-ink-muted">{c.id} · {c.type} · {c.start || "?"} ~ {c.end || "?"} · {c.status}{c.active ? "" : " · 사용 안 함"}</span>
              {c.aliases.length > 0 && <span className="text-xs text-ink-sub">별칭: {c.aliases.join(", ")}</span>}
              <div className="ml-auto flex gap-2">
                {c.active && (
                  <button type="button" onClick={() => void checkAttach(c)} className="h-8 rounded-lg border border-line px-2.5 text-xs font-semibold text-ink-sub">미연결 판매 확인</button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setDraft({ id: c.id, name: c.name, aliases: c.aliases.join(", "), type: c.type, start: c.start, end: c.end, status: c.status, active: c.active });
                    setMessage(null);
                  }}
                  className="h-8 rounded-lg border border-line px-2.5 text-xs font-semibold text-ink-sub"
                >
                  수정
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
