import "server-only";
import { AppsScriptError, getSalesConfigFromAppsScript } from "@/lib/server/apps-script";
import { defaultSalesConfig, type SalesConfig } from "@/lib/sales-config";

/*
 * 서버에서 쓰는 판매 설정 (유입경로 항목·캠페인 목록). 간편등록 저장마다 Apps Script 를 다시 부르지 않도록
 * 이 서버 인스턴스 안에서 30초 동안 기억한다. 점장이 설정을 바꾸면 그 응답으로 바로 바꾼다.
 * Apps Script 에 config-handler.gs 가 아직 없으면 기본 유입경로 5개·캠페인 없음으로 동작한다 (판매 저장은 그대로).
 */
const TTL_MS = 30_000;
let cached: { at: number; config: SalesConfig } | null = null;

export async function getSalesConfig(options: { fresh?: boolean } = {}): Promise<SalesConfig> {
  if (!options.fresh && cached && Date.now() - cached.at < TTL_MS) return cached.config;
  try {
    const config = await getSalesConfigFromAppsScript();
    cached = { at: Date.now(), config };
    return config;
  } catch (error) {
    // 설정만의 문제: 기본값으로 계속 (통신 실패도 기본값 — 저장 단계에서 Apps Script 가 다시 검사)
    if (error instanceof AppsScriptError) return defaultSalesConfig();
    throw error;
  }
}

export function rememberSalesConfig(config: SalesConfig): void {
  cached = { at: Date.now(), config };
}

/** 테스트용: 기억한 설정 지우기 */
export function forgetSalesConfig(): void {
  cached = null;
}
