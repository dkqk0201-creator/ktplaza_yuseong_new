"use client";

import { useCallback, useEffect, useState } from "react";
import { defaultSalesConfig, parseSalesConfig, type SalesConfig } from "@/lib/sales-config";

/*
 * 유입경로 항목·캠페인 목록 (화면 공용). 한 번 읽으면 이 탭 안에서 같이 쓰고,
 * 항목 관리·캠페인 저장 후에는 그 응답으로 바로 바꾼다. 못 읽으면 기본 유입경로 5개·캠페인 없음.
 */
let cache: SalesConfig | null = null;
let inflight: Promise<SalesConfig> | null = null;
const listeners = new Set<(c: SalesConfig) => void>();
let lastError: string | null = null;

async function load(): Promise<SalesConfig> {
  try {
    const response = await fetch("/api/settings/config", { cache: "no-store" });
    const body = (await response.json()) as Record<string, unknown>;
    if (body?.ok !== true) throw new Error(typeof body?.message === "string" ? body.message : "설정을 불러오지 못했습니다.");
    lastError = null;
    return parseSalesConfig(body);
  } catch (error) {
    lastError = error instanceof Error ? error.message : "설정을 불러오지 못했습니다.";
    return defaultSalesConfig();
  }
}

export function publishSalesConfig(config: SalesConfig) {
  cache = config;
  for (const l of listeners) l(config);
}

export function useSalesConfig() {
  const [config, setConfig] = useState<SalesConfig>(() => cache ?? defaultSalesConfig());
  const [loaded, setLoaded] = useState(cache !== null);
  const [error, setError] = useState<string | null>(lastError);

  const reload = useCallback(async () => {
    inflight = inflight ?? load().finally(() => (inflight = null));
    const next = await inflight;
    publishSalesConfig(next);
    setError(lastError);
    setLoaded(true);
  }, []);

  useEffect(() => {
    const listener = (c: SalesConfig) => setConfig(c);
    listeners.add(listener);
    if (!cache) void reload();
    return () => {
      listeners.delete(listener);
    };
  }, [reload]);

  return { config, loaded, error, reload };
}
