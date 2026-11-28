/*
 * 예산 현황 속도 개선 (2026-11-28) — 가짜 시트만.
 * /api/budget/extras: 로그인 확인 1번 + 고불비사용·기타 예산 조회를 동시에, 결과는 기존 API 와 똑같이.
 * 브라우저 저장소(lib/budget-extras): 월 섞임 없음, 실패는 0원으로 저장하지 않음, 같은 월 동시 조회는 1번만.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { setup, authed } from "../harness/web.ts";
import { STAFF_NAMES } from "../harness/staff.ts";
import { GET as extrasGET } from "@/app/api/budget/extras/route";
import { GET as gGET, POST as gPOST } from "@/app/api/budget/gobulbi/route";
import { GET as oGET, POST as oPOST } from "@/app/api/budget/other/route";
import {
  cachedBudgetExtras,
  clearBudgetExtras,
  loadBudgetExtras,
  prefetchBudgetExtras,
  storeGobulbi,
  isFresh,
  BUDGET_EXTRAS_FRESH_MS,
} from "@/lib/budget-extras";

const extras = (m: string) => extrasGET(authed(`/api/budget/extras?month=${m}`)).then(async (r) => ({ status: r.status, ...(await r.json()) }));
const jsonOf = (r: Promise<Response>) => r.then((x) => x.json());
const postG = (b: unknown) => jsonOf(gPOST(authed("/api/budget/gobulbi", { method: "POST", body: JSON.stringify(b) })));
const postO = (b: unknown) => jsonOf(oPOST(authed("/api/budget/other", { method: "POST", body: JSON.stringify(b) })));

async function seed() {
  // 시험 시계 = 2026-10 (고불비사용 신규 등록은 이번 달만 가능)
  const { ss, gas } = setup({ months: ["10월", "11월"] });
  const g1 = await postG({ op: "create", month: "2026-10", id: "gob-test-0001", content: "가짜 사용", amount: 30000, seller: STAFF_NAMES[0] });
  assert.equal(g1.ok, true, JSON.stringify(g1));
  for (const b of [
    { op: "create", month: "2026-10", id: "oth-test-0001", name: "가짜 확보", kind: "gain", amount: 500000 },
    { op: "create", month: "2026-10", id: "oth-test-0002", name: "가짜 차감", kind: "deduct", amount: 20000 },
    { op: "create", month: "2026-11", id: "oth-test-0003", name: "11월 가짜", kind: "gain", amount: 1000 },
  ]) {
    const r = await postO(b);
    assert.equal(r.ok, true, JSON.stringify(r));
  }
  return { ss, gas };
}

test("1) 한 번에 조회 = 기존 고불비사용·기타 예산 API 결과와 똑같음 (월별 구분 유지)", async () => {
  await seed();
  for (const m of ["2026-10", "2026-11"]) {
    const e = await extras(m);
    assert.equal(e.status, 200);
    assert.equal(e.month, m);
    const g = await jsonOf(gGET(authed(`/api/budget/gobulbi?month=${m}`)));
    const o = await jsonOf(oGET(authed(`/api/budget/other?month=${m}`)));
    assert.deepEqual(e.gobulbi, { ok: true, data: g.data });
    assert.deepEqual(e.other, { ok: true, data: o.data });
  }
  const oct = await extras("2026-10");
  assert.deepEqual([oct.gobulbi.data.total, oct.other.data.net], [30000, 480000]);
  const nov = await extras("2026-11");
  assert.deepEqual([nov.gobulbi.data.total, nov.other.data.net], [0, 1000]);
});

test("2) Apps Script 호출: 로그인 확인 1번 + 조회 2번 (따로 부르면 확인 2번 + 조회 2번)", async () => {
  const { gas } = await seed();
  const before = gas.calls.length;
  await extras("2026-10");
  const made = gas.calls.slice(before).map((c) => String(c.body.action) + (c.body.op ? ":" + c.body.op : ""));
  assert.equal(made.filter((a) => a.startsWith("auth-")).length, 1, made.join(","));
  assert.equal(made.length, 3, made.join(","));
  const b2 = gas.calls.length;
  await gGET(authed("/api/budget/gobulbi?month=2026-11"));
  await oGET(authed("/api/budget/other?month=2026-11"));
  assert.equal(gas.calls.length - b2, 4);
});

test("3) 한쪽 조회 실패 → 다른 쪽은 그대로, 실패는 실패로 (0원으로 바꾸지 않음)", async () => {
  await seed();
  const real = globalThis.fetch;
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    if (body.action === "other-budget") throw new TypeError("network down");
    return real(url, init);
  }) as typeof fetch;
  try {
    const e = await extras("2026-10");
    assert.equal(e.ok, true);
    assert.equal(e.gobulbi.ok, true);
    assert.equal(e.gobulbi.data.total, 30000);
    assert.equal(e.other.ok, false);
    assert.equal("data" in e.other, false, "실패한 쪽에 금액(0원) 없음");
    assert.match(e.other.message, /연결|다시/);
  } finally {
    globalThis.fetch = real;
  }
});

test("4) 로그인 없거나 월 형식이 틀리면 Apps Script 조회 없이 거부", async () => {
  const { gas } = await seed();
  const b = gas.calls.length;
  const bad = await extras("2026-1");
  assert.equal(bad.status, 400);
  assert.equal(gas.calls.slice(b).filter((c) => !String(c.body.action).startsWith("auth-")).length, 0);
  const noCookie = await extrasGET(new Request("https://test.invalid/api/budget/extras?month=2026-11"));
  assert.equal(noCookie.status, 401);
});

/** 브라우저 저장소 시험: fetch 를 가짜 응답으로 바꿔 /api/budget/extras 만 흉내 */
function fakeClient(reply: (month: string) => unknown) {
  const real = globalThis.fetch;
  let count = 0;
  globalThis.fetch = (async (url: string) => {
    count += 1;
    const m = new URL(url, "https://x.invalid").searchParams.get("month")!;
    await new Promise((r) => setTimeout(r, 5));
    return Response.json(reply(m));
  }) as typeof fetch;
  return { count: () => count, restore: () => { globalThis.fetch = real; } };
}
const gData = (month: string, total: number) => ({ month, items: [], total });
const oData = (month: string, net: number) => ({ month, items: [], gain: Math.max(net, 0), deduct: Math.max(-net, 0), net });

test("5) 저장소: 같은 월 동시 조회는 1번, 월별로 따로 저장, 60초 안이면 미리 조회도 안 함", async () => {
  clearBudgetExtras();
  const c = fakeClient((m) => ({ ok: true, month: m, gobulbi: { ok: true, data: gData(m, m === "2026-11" ? 30000 : 7000) }, other: { ok: true, data: oData(m, 480000) } }));
  try {
    const [a, b] = await Promise.all([loadBudgetExtras("2026-11"), loadBudgetExtras("2026-11")]);
    assert.equal(c.count(), 1, "동시에 두 번 불러도 요청 1번");
    assert.equal(a, b);
    await loadBudgetExtras("2026-10");
    assert.equal(cachedBudgetExtras("2026-11")!.gobulbi!.data.total, 30000);
    assert.equal(cachedBudgetExtras("2026-10")!.gobulbi!.data.total, 7000, "10월·11월 섞이지 않음");
    prefetchBudgetExtras("2026-11");
    assert.equal(c.count(), 2, "60초 안 값이 있으면 다시 부르지 않음");
    assert.equal(isFresh(Date.now() - BUDGET_EXTRAS_FRESH_MS - 1), false);
  } finally {
    c.restore();
  }
});

test("6) 저장소: 다른 달 응답·실패 응답은 저장하지 않음 (이전 값 유지, 0원 저장 없음)", async () => {
  clearBudgetExtras();
  // 11월을 물었는데 10월 응답 → 버림
  let c = fakeClient(() => ({ ok: true, month: "2026-10", gobulbi: { ok: true, data: gData("2026-10", 7000) }, other: { ok: true, data: oData("2026-10", 1) } }));
  try {
    const r = await loadBudgetExtras("2026-11");
    assert.equal(r.ok, false);
    assert.equal(cachedBudgetExtras("2026-11"), undefined);
  } finally {
    c.restore();
  }
  // 다른 달 데이터를 직접 넣으려 해도 무시
  storeGobulbi("2026-11", gData("2026-10", 7000) as never);
  assert.equal(cachedBudgetExtras("2026-11")?.gobulbi, undefined);
  // 정상 값 저장 후, 기타 예산만 실패 → 고불비는 새 값, 기타 예산은 이전 값 그대로 (0원 아님)
  c = fakeClient((m) => ({ ok: true, month: m, gobulbi: { ok: true, data: gData(m, 30000) }, other: { ok: true, data: oData(m, 480000) } }));
  try { await loadBudgetExtras("2026-11"); } finally { c.restore(); }
  c = fakeClient((m) => ({ ok: true, month: m, gobulbi: { ok: true, data: gData(m, 40000) }, other: { ok: false, message: "연결 실패", notDeployed: false } }));
  try {
    const r = await loadBudgetExtras("2026-11");
    assert.equal(r.ok && r.other.ok, false);
    assert.equal(cachedBudgetExtras("2026-11")!.gobulbi!.data.total, 40000);
    assert.equal(cachedBudgetExtras("2026-11")!.other!.data.net, 480000);
  } finally {
    c.restore();
  }
  // 네트워크 자체 실패 → ok:false, 저장소 변화 없음
  const real = globalThis.fetch;
  globalThis.fetch = (async () => { throw new TypeError("offline"); }) as typeof fetch;
  try {
    const r = await loadBudgetExtras("2026-11");
    assert.equal(r.ok, false);
    assert.equal(cachedBudgetExtras("2026-11")!.gobulbi!.data.total, 40000);
  } finally {
    globalThis.fetch = real;
  }
  clearBudgetExtras();
});
