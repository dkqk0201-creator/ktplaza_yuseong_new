/*
 * 2026-11-16 운영 오류 재현·회귀: 점장이 항목 관리에서 추가한 유입경로(권매)로 판매 수정 저장 시
 *   "판매연결: 유입경로는 목록에서 골라 주세요." 로 거부되던 문제.
 * 원인: Apps Script 가 잠금 전 "형식 검사"(cfg 없이)에서 고정 기본 목록(WS_INFLOW_SOURCES 5개+미확인)으로
 *       유입경로 이름까지 검사함 (update-handler.gs 판매 수정, sale-link.gs 판매연결만 저장).
 * 기대: 항목 관리의 사용 중 항목이면 무엇이든 저장, 목록에 없거나 사용 안 함 항목은 거부(장표·판매연결 불변).
 * 가짜 데이터·가짜 스프레드시트만 사용.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setup, register, registerWithIds, report, list, byName, target, authed } from "../harness/web.ts";
import { PEOPLE } from "../harness/fake-people.ts";
import { type InflowOption } from "@/lib/inflow-options";
import { inflowRows } from "@/lib/sales-analysis";
import { POST as updatePOST } from "@/app/api/sales/update/route";
import { POST as linkPOST } from "@/app/api/sales/link/route";
import { GET as configGET } from "@/app/api/settings/config/route";
import { POST as inflowPOST } from "@/app/api/settings/inflow/route";

const [A, B, C, D] = PEOPLE;
const json = (r: Response) => r.json() as Promise<Record<string, unknown>>;
const post = (h: (r: Request) => Promise<Response>, body: unknown) => h(authed("/api", { method: "POST", body: JSON.stringify(body) })).then(json);
const get = (h: (r: Request) => Promise<Response>, url: string) => h(authed(url)).then(json);

/** 운영과 같은 순서로 권매 추가 (기본 5개 뒤, 순서 6) */
async function addItem(name: string, aliases: string[] = [name]) {
  const cfg = await get(configGET, "/api/settings/config");
  const items = [...(cfg.inflows as InflowOption[]), { name, aliases, active: true, order: (cfg.inflows as InflowOption[]).length + 1 }];
  const saved = await post(inflowPOST, { items, version: cfg.inflowVersion });
  assert.equal(saved.ok, true, JSON.stringify(saved));
}

const linkSheetRows = (ss: ReturnType<typeof setup>["ss"]) =>
  JSON.stringify(ss.getSheetByName("웹앱판매연결")?.rows.map((r) => r.map((c) => c.value)) ?? []);

test("1) 추가한 항목(권매): 신규 등록 저장 → 판매연결 권매 / 유입경로 분석에 권매 따로 집계", async () => {
  setup();
  await addItem("권매");
  await register(report(A.name, A.ctn, { extra: "유입경로 : 권매" }), report(B.name, B.ctn, { extra: "유입경로 : 네이버" }));
  const sales = await list();
  assert.equal(byName(sales, A.name).link?.inflow, "권매");
  assert.equal(byName(sales, B.name).link?.inflow, "네이버", "기존 항목도 그대로");
  const cfg = (await get(configGET, "/api/settings/config")) as unknown as { inflows: InflowOption[] };
  const rows = inflowRows(sales, cfg.inflows);
  assert.equal(rows.find((r) => r.inflow === "권매")?.sales, 1);
  assert.equal(rows.find((r) => r.inflow === "네이버")?.sales, 1);
});

test("2) 기존 판매 유입경로를 권매로 바꿔 판매 수정 저장 (장표 칸 + 판매연결 함께) — 운영 오류 재현", async () => {
  const { ss } = setup();
  await register(report(A.name, A.ctn, { extra: "유입경로 : TM" }));
  await addItem("권매");
  const a = byName(await list(), A.name);
  const r = await post(updatePOST, {
    target: target(a),
    changes: [{ key: "model", before: a.model, after: "모델수정" }],
    link: { saleId: a.saleId, staff: a.staff, patches: [{ field: "inflow", before: "TM", value: "권매" }] },
  });
  assert.equal(r.ok, true, JSON.stringify(r));
  const a2 = byName(await list(), A.name);
  assert.deepEqual([a2.model, a2.link?.inflow], ["모델수정", "권매"]);
  assert.equal((await list()).filter((s) => s.customer === A.name).length, 1, "중복 행 없음");
  void ss;
});

test("3) 판매연결만 수정(장표 칸 변경 없음) · 판매 상세의 판매연결 저장(sale-link-set)도 권매 저장", async () => {
  setup();
  await register(report(A.name, A.ctn, { extra: "유입경로 : 내방" }), report(B.name, B.ctn));
  await addItem("권매");
  const a = byName(await list(), A.name);
  const only = await post(updatePOST, { target: target(a), changes: [], link: { saleId: a.saleId, staff: a.staff, patches: [{ field: "inflow", before: "내방", value: "권매" }] } });
  assert.equal(only.ok, true, JSON.stringify(only));
  assert.equal(byName(await list(), A.name).link?.inflow, "권매");
  const b = byName(await list(), B.name);
  const viaLink = await post(linkPOST, { target: target(b), saleId: b.saleId, staff: b.staff, patches: [{ field: "inflow", before: b.link?.inflow ?? "", value: "권매" }] });
  assert.equal(viaLink.ok, true, JSON.stringify(viaLink));
  assert.equal(byName(await list(), B.name).link?.inflow, "권매");
});

test("4) 항목을 하나 더 추가해도(예: 소개) 같은 방식으로 저장 — 고정 목록 아님", async () => {
  setup();
  await addItem("권매");
  await addItem("소개", ["소개", "지인소개"]);
  await register(report(A.name, A.ctn, { extra: "유입경로 : 지인소개" }));
  const a = byName(await list(), A.name);
  assert.equal(a.link?.inflow, "소개");
  const r = await post(updatePOST, { target: target(a), changes: [], link: { saleId: a.saleId, staff: a.staff, patches: [{ field: "inflow", before: "소개", value: "권매" }] } });
  assert.equal(r.ok, true, JSON.stringify(r));
  const back = await post(updatePOST, { target: target(a), changes: [], link: { saleId: a.saleId, staff: a.staff, patches: [{ field: "inflow", before: "권매", value: "미확인" }] } });
  assert.equal(back.ok, true, JSON.stringify(back));
});

test("5) 기존 유입경로 5개·미확인은 그대로 저장", async () => {
  setup();
  await register(report(A.name, A.ctn));
  await addItem("권매");
  let before = "";
  for (const v of ["네이버", "자점", "TM", "내방", "외부영업", "미확인"]) {
    const a = byName(await list(), A.name);
    const r = await post(updatePOST, { target: target(a), changes: [], link: { saleId: a.saleId, staff: a.staff, patches: [{ field: "inflow", before, value: v }] } });
    assert.equal(r.ok, true, v + " " + JSON.stringify(r));
    assert.equal(byName(await list(), A.name).link?.inflow, v);
    before = v;
  }
});

test("6) 등록되지 않은 임의 값·사용 안 함 항목은 웹·Apps Script 모두 거부, 장표·판매연결 그대로", async () => {
  const { ss, gas } = setup();
  await register(report(A.name, A.ctn, { extra: "유입경로 : 네이버" }));
  await addItem("권매");
  const a = byName(await list(), A.name);
  const month0 = JSON.stringify(ss.month().rows.map((r) => r.map((c) => c.value)));
  const link0 = linkSheetRows(ss);
  // 웹 서버
  const bad = await post(updatePOST, { target: target(a), changes: [{ key: "model", before: a.model, after: "X수정" }], link: { saleId: a.saleId, staff: a.staff, patches: [{ field: "inflow", before: "네이버", value: "블로그광고" }] } });
  assert.equal(bad.ok, false);
  // Apps Script 직접 (웹 검사를 건너뛴 요청): 판매 수정·판매연결만 저장 모두 거부
  const direct = gas.doPost({ action: "sale-link-set", target: target(a), saleId: a.saleId, staffId: "", patches: [{ field: "inflow", before: "네이버", value: "블로그광고" }] });
  assert.equal(direct.ok, false);
  assert.match(String(direct.message), /목록에서 골라/);
  // 너무 긴 값은 잠금 전 형식 검사에서 거부
  const long = gas.doPost({ action: "sale-link-set", target: target(a), saleId: a.saleId, staffId: "", patches: [{ field: "inflow", before: "네이버", value: "가".repeat(11) }] });
  assert.equal(long.ok, false);
  // 권매 사용 안 함 → 새로 저장 불가
  const cfg = await get(configGET, "/api/settings/config");
  const off = (cfg.inflows as InflowOption[]).map((o) => (o.name === "권매" ? { ...o, active: false } : o));
  assert.equal((await post(inflowPOST, { items: off, version: cfg.inflowVersion })).ok, true);
  const offDirect = gas.doPost({ action: "sale-link-set", target: target(a), saleId: a.saleId, staffId: "", patches: [{ field: "inflow", before: "네이버", value: "권매" }] });
  assert.equal(offDirect.ok, false, "사용 안 함 항목은 Apps Script 도 거부");
  const offWeb = await post(updatePOST, { target: target(a), changes: [], link: { saleId: a.saleId, staff: a.staff, patches: [{ field: "inflow", before: "네이버", value: "권매" }] } });
  assert.equal(offWeb.ok, false);
  assert.equal(JSON.stringify(ss.month().rows.map((r) => r.map((c) => c.value))), month0, "장표 그대로");
  assert.equal(linkSheetRows(ss).replace(/"\d{4}-[^"]*"/g, ""), link0.replace(/"\d{4}-[^"]*"/g, ""), "판매연결 그대로");
});

test("7) 권매 판매 등록 재전송(같은 등록요청 ID)은 판매 1건 / 다른 판매·기존 판매연결 보존", async () => {
  setup();
  await register(report(C.name, C.ctn, { extra: "유입경로 : 자점" }));
  await addItem("권매");
  const rid = randomUUID();
  const text = report(D.name, D.ctn, { extra: "유입경로 : 권매" });
  await registerWithIds([{ text, requestId: rid }]);
  const again = (await registerWithIds([{ text, requestId: rid }])).results as { ok: boolean; repeated?: boolean }[];
  assert.equal(again[0].repeated, true);
  const sales = await list();
  assert.equal(sales.filter((s) => s.customer === D.name).length, 1);
  assert.equal(byName(sales, D.name).link?.inflow, "권매");
  assert.equal(byName(sales, C.name).link?.inflow, "자점");
});
