"use client";

import { useState } from "react";
import { InflowAnalysisView } from "@/components/inflow-analysis-view";
import { CampaignView } from "@/components/campaign-view";
import { SalesSettingsView } from "@/components/sales-settings-view";

/*
 * 유입·캠페인 분석 (점장 전용). 메뉴를 늘리지 않고 한 화면 안의 탭으로 나눈다.
 *   유입경로   : 기존 유입경로 분석 (일·주·월)
 *   캠페인     : 캠페인별 판매 고객 조회·실적·예산
 *   항목 관리  : 유입경로 항목·캠페인 등록·수정
 */
const TABS = [
  { key: "inflow", label: "유입경로" },
  { key: "campaign", label: "캠페인" },
  { key: "settings", label: "항목 관리" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

export function AnalysisTabs() {
  const [tab, setTab] = useState<TabKey>("inflow");
  return (
    <div className="space-y-5">
      <div role="tablist" aria-label="분석 종류" className="flex gap-1 rounded-lg bg-zinc-100 p-1">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={`h-9 flex-1 rounded-md text-sm font-semibold ${tab === t.key ? "bg-white text-ink shadow-sm" : "text-ink-sub"}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === "inflow" && <InflowAnalysisView />}
      {tab === "campaign" && <CampaignView />}
      {tab === "settings" && <SalesSettingsView />}
    </div>
  );
}
