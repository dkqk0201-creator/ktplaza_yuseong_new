/*
 * 실제 웹앱 서버 코드(Next.js route handler)를 가짜 Apps Script 에 연결해 부른다 (테스트 전용).
 * - fetch 를 가로채 Apps Script 호출만 가짜 doPost 로 보낸다 (외부 네트워크 없음)
 * - 서버 console 출력도 모아 개인정보 검사에 쓴다
 */
import { FakeSpreadsheet } from "./fake-spreadsheet.ts";
import { makeGas, type Gas, type GasOptions } from "./gas.ts";
import { STAFF_NAMES as LEGACY_STAFF } from "./staff.ts";
import { parseQuickReports } from "@/lib/quick-report";
import { getSheetSales } from "@/lib/data/sheet-sales";
import { diffSale } from "@/lib/sale-edit";
import { diffNotes } from "@/lib/sale-form-layout";
import { planVSplit } from "@/lib/v-split";
import type { SheetSale } from "@/lib/sheet-record";
import { tMaskName } from "./fake-people.ts";
import { POST as quickPOST } from "@/app/api/sales/quick/route";
import { POST as updatePOST } from "@/app/api/sales/update/route";
import { POST as deletePOST } from "@/app/api/sales/delete/route";
import { POST as markDonePOST } from "@/app/api/sales/mark-done/route";
import { POST as cardPOST } from "@/app/api/sales/card-check/route";
import { POST as reviewPOST } from "@/app/api/sales/review/route";

process.env.APPS_SCRIPT_URL = "https://apps-script.invalid/exec";
process.env.APPS_SCRIPT_API_SECRET = "x";

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
  return { ss, gas };
}
export function connect(gas: Gas) {
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    const { secret: _s, ...body } = JSON.parse(String(init.body));
    return Response.json(gas.doPost(body));
  }) as typeof fetch;
}

const post = (handler: (r: Request) => Promise<Response>, body: unknown) =>
  handler(new Request("http://test.invalid", { method: "POST", body: JSON.stringify(body) })).then(json);

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
/**
 * 고객명으로 판매 찾기. 화면에는 마스킹 이름(가나*)만 오므로 원본·마스킹 어느 쪽으로 불러도 찾는다
 * (수정 전 코드 = 원본 그대로 오는 경우도 같은 테스트로 비교할 수 있게).
 */
export const byName = (sales: SheetSale[], customer: string) => {
  const found = sales.filter((s) => s.customer === customer || s.customer === tMaskName(customer));
  if (found.length !== 1) throw new Error(`판매 ${tMaskName(customer)} ${found.length}건`);
  return found[0];
};
/** 화면이 보내는 판매 식별값 (판매 ID 가 있으면 함께 — components 의 saleTargetOf 와 같은 모양) */
export const target = (s: SheetSale, sheet = "10월") => {
  const id = (s as { saleId?: string }).saleId;
  return { sheet, row: s.row, no: s.no, activatedAt: s.activatedAt, customer: s.customer, ctn: s.ctn, ...(id ? { saleId: id } : {}) };
};

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
