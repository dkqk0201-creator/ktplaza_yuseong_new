/*
 * 실제 Apps Script(.gs) 파일을 가짜 스프레드시트에 붙여 실행 (테스트 전용).
 * doPost 는 저장소에 없으므로 운영과 같은 순서로 흉내 낸다:
 *   wsHandleSaleUpdate_(판매 수정·보완 요청·고불비) → 목표 → 저장 → 삭제 → 조회 → (없으면) 알 수 없는 요청
 */
import vm from "node:vm";
import { readFileSync, existsSync } from "node:fs";
import { randomUUID, createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { FakeSpreadsheet } from "./fake-spreadsheet.ts";

export const SECRET = "test-secret";
const here = path.dirname(fileURLToPath(import.meta.url));
export const WS_DIR = process.env.WS_ROOT || path.resolve(here, "../../wireless-sales");
export const APPS_SCRIPT_DIR = process.env.GS_DIR || path.resolve(WS_DIR, "apps-script");
/** 테스트 전용 진입 파일 (테스트 전용 Apps Script 프로젝트에만 들어감) */
export const TEST_ENTRY_PATH = path.resolve(WS_DIR, "apps-script-test", "test-entry.gs");
/**
 * GAS_ENTRY=test-entry 로 실행하면 모든 테스트가 운영 흉내 순서 대신 test-entry.gs 의 실제 doPost 를 거친다
 * (독립 프로젝트 흉내: 붙은 시트 없음, 스크립트 속성 SPREADSHEET_ID 로 여는 가짜 시트).
 */
export const DEFAULT_ENTRY: "emulated" | "test-entry" = process.env.GAS_ENTRY === "test-entry" ? "test-entry" : "emulated";
/** 테스트 프로젝트에 넣는 파일 (total-row.gs 제외 — 편집기 실행용 공개 함수가 있어 테스트 프로젝트에는 넣지 않음) */
export const TEST_PROJECT_FILES = ["common", "notes", "save-handler", "update-handler", "delete-handler", "list-handler", "inspection-review", "gobulbi", "goal-handler", "auth-handler"];

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
  /** emulated: 운영 doPost 흉내 순서 / test-entry: test-entry.gs 의 doPost (기본: GAS_ENTRY 환경변수) */
  entry?: "emulated" | "test-entry";
  /** test-entry: 시트에 붙은 프로젝트 흉내 (getActiveSpreadsheet 가 시트를 돌려줌) */
  bound?: boolean;
  /** 스크립트 속성 덮어쓰기 (null = 지움) */
  props?: Record<string, string | null>;
  /** openById 로 열 수 있는 다른 가짜 시트 (예: 운영 흉내) */
  others?: { getId(): string }[];
  /** test-entry.gs 소스 바꿔치기 (보호 장치 시험용) */
  entrySource?: (src: string) => string;
  /** 추가로 넣을 .gs 소스 (예: 기존 Code.gs 흉내) */
  extraSource?: string;
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
  const entry = opts.entry ?? DEFAULT_ENTRY;
  const props = new Map<string, string>([["API_SECRET", SECRET]]);
  if (entry === "test-entry") props.set("SPREADSHEET_ID", ss.getId());
  for (const [k, v] of Object.entries(opts.props ?? {})) { if (v === null) props.delete(k); else props.set(k, v); }
  const opened: string[] = [];
  const openById = (id: string) => {
    opened.push(String(id));
    if (id === ss.getId()) return ss;
    const other = (opts.others ?? []).find((o) => o.getId() === id);
    if (other) return other;
    throw new Error("문서에 액세스할 수 없습니다: " + id);
  };
  const logs: string[] = [];
  const ctx: Record<string, unknown> = {
    Date: ClockDate,
    console: { log: (...a: unknown[]) => logs.push(a.join(" ")), error: (...a: unknown[]) => logs.push(a.join(" ")), warn: (...a: unknown[]) => logs.push(a.join(" ")) },
    Logger: { log: (...a: unknown[]) => logs.push(a.join(" ")) },
    ContentService: { MimeType: { JSON: "json" }, createTextOutput: (t: string) => ({ setMimeType: () => ({ text: t }) }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k: string) => props.get(k) ?? null, setProperty: (k: string, v: string) => props.set(k, v) }) },
    SpreadsheetApp: entry === "test-entry"
      ? { getActiveSpreadsheet: () => (opts.bound ? ss : null), openById, flush: () => {} }
      : { getActiveSpreadsheet: () => ss, openById: () => ss, flush: () => {} },
    LockService: { getScriptLock: () => ({ tryLock: () => !opts.busy, releaseLock: () => {} }) },
    Utilities: {
      formatDate,
      getUuid: () => randomUUID(),
      DigestAlgorithm: { SHA_256: "sha256" },
      Charset: { UTF_8: "utf8" },
      // Apps Script 처럼 -128~127 바이트 배열
      computeDigest: (alg: string, text: string) => [...createHash(alg).update(String(text), "utf8").digest()].map((b) => (b > 127 ? b - 256 : b)),
    },
  };
  vm.createContext(ctx);
  const files = opts.files ?? (entry === "test-entry" ? TEST_PROJECT_FILES : DEFAULT_FILES);
  let src = files.map((f) => {
    const p = path.join(APPS_SCRIPT_DIR, `${f}.gs`);
    return existsSync(p) ? readFileSync(p, "utf8") : "";
  }).join("\n");
  if (entry === "test-entry") {
    const e = readFileSync(TEST_ENTRY_PATH, "utf8");
    src += "\n" + (opts.entrySource ? opts.entrySource(e) : e);
  }
  if (opts.extraSource) src += "\n" + opts.extraSource;
  vm.runInContext(src, ctx, { filename: "apps-script.gs" });
  const chain = ["wsHandleSaleUpdate_", "handleListRequest_", "handleDeleteRequest_", "handleSaveRequest_", "handleGoalRequest_"]; // 운영 Code.gs doPost 순서 (2026-11-09 점장 확인)
  const calls: { body: Record<string, unknown>; reply: Record<string, unknown> }[] = [];
  function doPost(body: Record<string, unknown>) {
    const e = { postData: { contents: JSON.stringify({ secret: SECRET, ...body }) } };
    if (entry === "test-entry") {
      const reply = JSON.parse((ctx.doPost as (e: unknown) => { text: string })(e).text);
      calls.push({ body, reply });
      return reply;
    }
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
  /** 원본 그대로의 요청 (secret 을 직접 정할 때) */
  const rawPost = (contents: string) => JSON.parse((ctx.doPost as (e: unknown) => { text: string })({ postData: { contents } }).text);
  return { doPost, rawPost, calls, logs, fn, ctx, props, opened, entry };
}
export type Gas = ReturnType<typeof makeGas>;
