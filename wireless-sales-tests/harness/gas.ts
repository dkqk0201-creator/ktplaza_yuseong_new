/*
 * 실제 Apps Script(.gs) 파일을 가짜 스프레드시트에 붙여 실행 (테스트 전용).
 * doPost 는 저장소에 없으므로 운영과 같은 순서로 흉내 낸다:
 *   wsHandleSaleUpdate_(판매 수정·보완 요청·고불비) → 목표 → 저장 → 삭제 → 조회 → (없으면) 알 수 없는 요청
 */
import vm from "node:vm";
import { readFileSync, existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { FakeSpreadsheet } from "./fake-spreadsheet.ts";

export const SECRET = "test-secret";
const here = path.dirname(fileURLToPath(import.meta.url));
export const APPS_SCRIPT_DIR = process.env.GS_DIR || path.resolve(process.env.WS_ROOT || path.resolve(here, "../../wireless-sales"), "apps-script");

const pad = (n: number) => String(n).padStart(2, "0");
function formatDate(v: Date, _tz: string, f: string) {
  // 한국 시간 기준 yyyy·yy·MM·M·dd·d·HH·mm·ss 패턴 (Apps Script Utilities.formatDate 와 같은 표기)
  const k = new Date(v.getTime() + 9 * 3600_000);
  const parts: Record<string, string> = {
    yyyy: String(k.getUTCFullYear()), yy: String(k.getUTCFullYear()).slice(2),
    MM: pad(k.getUTCMonth() + 1), M: String(k.getUTCMonth() + 1),
    dd: pad(k.getUTCDate()), d: String(k.getUTCDate()),
    HH: pad(k.getUTCHours()), mm: pad(k.getUTCMinutes()), ss: pad(k.getUTCSeconds()),
  };
  return f.replace(/yyyy|yy|MM|M|dd|d|HH|mm|ss/g, (t) => parts[t]);
}

export interface GasOptions {
  /** 시각 고정 (기본: 실제 시각) — 저장 대상 월 시트 = 이 시각의 달 */
  now?: () => number;
  /** 잠금 실패 흉내 */
  busy?: boolean;
  files?: string[];
}
export const DEFAULT_FILES = ["common", "save-handler", "update-handler", "delete-handler", "list-handler", "notes", "inspection-review", "goal-handler", "gobulbi", "total-row", "auth-handler"];

export function makeGas(ss: FakeSpreadsheet, opts: GasOptions = {}) {
  const now = opts.now ?? (() => Date.now());
  const RealDate = Date;
  class ClockDate extends RealDate {
    constructor(...a: unknown[]) { if (a.length === 0) super(now()); else super(...(a as [number])); }
    static now() { return now(); }
    static [Symbol.hasInstance](x: unknown) { return Object.prototype.toString.call(x) === "[object Date]"; }
  }
  const props = new Map<string, string>([["API_SECRET", SECRET]]);
  const logs: string[] = [];
  const ctx: Record<string, unknown> = {
    Date: ClockDate,
    console: { log: (...a: unknown[]) => logs.push(a.join(" ")), error: (...a: unknown[]) => logs.push(a.join(" ")), warn: (...a: unknown[]) => logs.push(a.join(" ")) },
    Logger: { log: (...a: unknown[]) => logs.push(a.join(" ")) },
    ContentService: { MimeType: { JSON: "json" }, createTextOutput: (t: string) => ({ setMimeType: () => ({ text: t }) }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k: string) => props.get(k) ?? null, setProperty: (k: string, v: string) => props.set(k, v) }) },
    SpreadsheetApp: { getActiveSpreadsheet: () => ss, openById: () => ss, flush: () => {} },
    LockService: { getScriptLock: () => ({ tryLock: () => !opts.busy, releaseLock: () => {} }) },
    Utilities: { formatDate, getUuid: () => randomUUID() },
  };
  vm.createContext(ctx);
  const files = opts.files ?? DEFAULT_FILES;
  const src = files.map((f) => {
    const p = path.join(APPS_SCRIPT_DIR, `${f}.gs`);
    return existsSync(p) ? readFileSync(p, "utf8") : "";
  }).join("\n");
  vm.runInContext(src, ctx, { filename: "apps-script.gs" });
  const chain = ["wsHandleSaleUpdate_", "handleGoalRequest_", "handleSaveRequest_", "handleDeleteRequest_", "handleListRequest_"];
  const calls: { body: Record<string, unknown>; reply: Record<string, unknown> }[] = [];
  function doPost(body: Record<string, unknown>) {
    const e = { postData: { contents: JSON.stringify({ secret: SECRET, ...body }) } };
    for (const fn of chain) {
      const f = ctx[fn];
      if (typeof f !== "function") continue;
      const out = (f as (e: unknown) => { text: string } | null)(e);
      if (out) {
        const reply = JSON.parse(out.text);
        calls.push({ body, reply });
        return reply;
      }
    }
    const reply = { ok: false, message: "알 수 없는 요청입니다." };
    calls.push({ body, reply });
    return reply;
  }
  /** .gs 안의 함수를 직접 부를 때 (예: setupWirelessTotalRows) */
  const fn = (name: string) => ctx[name] as (...a: unknown[]) => unknown;
  return { doPost, calls, logs, fn, ctx };
}
export type Gas = ReturnType<typeof makeGas>;
