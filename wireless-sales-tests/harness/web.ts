/*
 * 실제 웹앱 서버 코드(Next.js route handler)를 가짜 Apps Script 에 연결해 부른다 (테스트 전용).
 * - fetch 를 가로채 Apps Script 호출만 가짜 doPost 로 보낸다 (외부 네트워크 없음)
 * - 서버 console 출력도 모아 개인정보 검사에 쓴다
 */
import { createHash, createHmac, pbkdf2Sync, randomBytes } from "node:crypto";
import { FakeSpreadsheet } from "./fake-spreadsheet.ts";
import { makeGas, type Gas, type GasOptions } from "./gas.ts";
import { STAFF_NAMES as LEGACY_STAFF } from "./staff.ts";
import { parseQuickReports } from "@/lib/quick-report";
import { getSheetSales } from "@/lib/data/sheet-sales";
import { diffSale } from "@/lib/sale-edit";
import { diffNotes } from "@/lib/sale-form-layout";
import { planVSplit } from "@/lib/v-split";
import type { SheetSale } from "@/lib/sheet-record";
import { POST as quickPOST } from "@/app/api/sales/quick/route";
import { POST as updatePOST } from "@/app/api/sales/update/route";
import { POST as deletePOST } from "@/app/api/sales/delete/route";
import { POST as markDonePOST } from "@/app/api/sales/mark-done/route";
import { POST as cardPOST } from "@/app/api/sales/card-check/route";
import { POST as reviewPOST } from "@/app/api/sales/review/route";

process.env.APPS_SCRIPT_URL = "https://apps-script.invalid/exec";
process.env.APPS_SCRIPT_API_SECRET = "x";

/*
 * 로그인 (테스트 전용 가짜 비밀값 — 실행할 때마다 새로 만들고 어디에도 저장하지 않음).
 * 업무 테스트는 setup() 이 만든 정상 세션 쿠키로 부르고, 로그인 자체는 tests/12-auth 에서 따로 시험한다.
 */
export const TEST_PASSWORD = "test-only-" + randomBytes(9).toString("base64url");
export const TEST_TOTP_KEY = randomBytes(20);
const salt = randomBytes(16);
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const base32 = (b: Buffer) => { let bits = 0, v = 0, o = ""; for (const x of b) { v = (v << 8) | x; bits += 8; while (bits >= 5) { o += B32[(v >>> (bits - 5)) & 31]; bits -= 5; } } return bits ? o + B32[(v << (5 - bits)) & 31] : o; };
export const TEST_ITERATIONS = 100_000;
process.env.AUTH_PASSWORD_HASH = `pbkdf2-sha256$${TEST_ITERATIONS}$${salt.toString("base64url")}$${pbkdf2Sync(TEST_PASSWORD, salt, TEST_ITERATIONS, 32, "sha256").toString("base64url")}`;
process.env.AUTH_TOTP_SECRET = base32(TEST_TOTP_KEY);
process.env.AUTH_SESSION_SECRET = randomBytes(32).toString("base64url");
export const ORIGIN = "https://test.invalid";
let authCookie = "";
let loginStep = 0;
/** 이 가짜 Apps Script 에 세션을 등록하고 쿠키를 만든다 (로그인 성공과 같은 상태) */
export function signIn(gas: Gas): string {
  const key = Buffer.from(process.env.AUTH_SESSION_SECRET!, "utf8");
  const sid = randomBytes(24).toString("base64url");
  const exp = Math.floor(Date.now() / 1000) + 3600;
  loginStep += 1;
  const r = gas.doPost({ action: "auth-login", result: "ok", session: createHash("sha256").update(sid).digest("hex"), exp, step: loginStep });
  if (!r.ok) throw new Error("테스트 로그인 실패: " + JSON.stringify(r));
  const data = `v2.${sid}.${exp}.${Math.floor(Date.now() / 1000) + 1800}`;
  authCookie = `__Host-ws_session=${data}.${createHmac("sha256", key).update(data).digest("base64url")}`;
  return authCookie;
}
/** 로그인한 브라우저가 이 사이트에서 보내는 요청 */
export function authed(url: string, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers);
  if (authCookie) headers.set("cookie", authCookie);
  if (init.method && init.method !== "GET") headers.set("origin", ORIGIN);
  return new Request(new URL(url, ORIGIN), { ...init, headers });
}

export const serverLogs: string[] = [];
for (const k of ["log", "error", "warn", "info"] as const) {
  const orig = console[k].bind(console);
  console[k] = (...a: unknown[]) => { serverLogs.push(a.map(String).join(" ")); if (process.env.TEST_VERBOSE) orig(...a); };
}

export const responses: unknown[] = [];
async function json(res: Response) { const body = await res.json(); responses.push(body); return { status: res.status, ...body }; }

export function setup(opts: GasOptions & { months?: string[]; slots?: number } = {}) {
  const ss = new FakeSpreadsheet(opts.months ?? ["10월"], opts.slots ?? 15);
  const gas = makeGas(ss, opts);
  connect(gas);
  signIn(gas);
  return { ss, gas };
}
export function connect(gas: Gas) {
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    const { secret: _s, ...body } = JSON.parse(String(init.body));
    return Response.json(gas.doPost(body));
  }) as typeof fetch;
}

const post = (handler: (r: Request) => Promise<Response>, body: unknown) =>
  handler(authed("/api", { method: "POST", body: JSON.stringify(body) })).then(json);

/** 간편등록 (보고 글 → 화면과 같은 해석 → 저장 API) */
export async function register(...texts: string[]) {
  const items = texts.map((t) => ({ fields: parseQuickReports(t)[0].fields }));
  return post(quickPOST, { items });
}
let seq = 0;
export interface ReportOpt { date?: string; staff?: string; category?: string; extra?: string; use?: string; benefit?: string }
/** 직원 보고 양식 (가짜 고객) */
export function report(name: string, ctn: string, o: ReportOpt = {}) {
  seq++;
  return [
    `개통일자 : ${o.date ?? "10.05"}`,
    `직원명 : ${o.staff ?? LEGACY_STAFF[0]}`,
    `고객명 : ${name}`,
    `CTN : ${ctn}`,
    `개통구분 : ${o.category ?? "기변"}`,
    `모델명 : 테스트폰${seq}`,
    `요금제 : 베이직플랜`,
    `ㄴ유지/변경 : 유지`,
    `정책`,
    `ㄴ고객혜택 : ${o.benefit ?? "5만"}`,
    `정책사용`,
    o.use ?? "",
    o.extra ?? "",
  ].join("\n");
}

export async function list(sheet = "10월"): Promise<SheetSale[]> {
  const r = await getSheetSales(sheet);
  responses.push(r);
  if (!r.ok) throw new Error("조회 실패: " + (r as { message?: string }).message);
  return [...r.sales].sort((a, b) => a.row - b.row);
}
export const byName = (sales: SheetSale[], customer: string) => {
  const found = sales.filter((s) => s.customer === customer);
  if (found.length !== 1) throw new Error(`판매 ${customer} ${found.length}건`);
  return found[0];
};
export const target = (s: SheetSale, sheet = "10월") => ({ sheet, row: s.row, no: s.no, activatedAt: s.activatedAt, customer: s.customer, ctn: s.ctn });

/** 판매 수정 (판매 상세 화면과 같은 방식으로 바뀐 칸·참고 항목만 보냄) */
export async function edit(s: SheetSale, edited: Record<string, string>, notes: Record<string, string> = {}, v: { plan?: string; installment?: string } = {}) {
  const plan = planVSplit(s, v);
  const all = plan.vAfter !== undefined ? { ...edited, usedModelPlan: plan.vAfter } : edited;
  const changes = diffSale(s, all as never);
  const noteChanges = [...diffNotes(s, notes as never), ...plan.notes];
  return post(updatePOST, { target: target(s), changes, ...(noteChanges.length ? { notes: noteChanges } : {}) });
}
export const deleteSale = (s: SheetSale) => post(deletePOST, target(s));
export const markDone = (s: SheetSale, field: "inspected" | "paid") => post(markDonePOST, { target: target(s), field, before: (s as Record<string, unknown>)[field] ?? "" });
export const cardCheck = (s: SheetSale) => post(cardPOST, { target: target(s), before: s.cardChecked ?? "" });
export const review = (s: SheetSale, op: "save" | "cancel", content = "", before = s.review?.active?.content ?? "") =>
  post(reviewPOST, { target: target(s), op, before, content });
