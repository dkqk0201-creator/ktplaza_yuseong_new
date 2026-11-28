/*
 * 예산관리 기타 예산 (2026-11-28) — 가짜 시트만.
 * 별도 시트 "기타예산내역"·"기타예산변경이력" 에만 저장, 월별 장표·기존 예산 계산값은 그대로,
 * 최종 매장 총예산 = 기존 매장 총예산 + 기타 예산 순증감, AC열 검증은 기존 총예산 기준 유지.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { setup, register, report, list, authed } from "../harness/web.ts";
import { PEOPLE } from "../harness/fake-people.ts";
import { STAFF_NAMES } from "../harness/staff.ts";
import { POST, GET } from "@/app/api/budget/other/route";
import { POST as gPOST, GET as gGET } from "@/app/api/budget/gobulbi/route";
import { calculateBudget } from "@/lib/budget";
import { applyGobulbi, checkAgainstSheetAc } from "@/lib/gobulbi";
import { applyOtherBudget, otherBeforeOf, parseOtherAmount, type OtherBudgetItem } from "@/lib/other-budget";
import type { FakeSheet } from "../harness/fake-spreadsheet.ts";

const post = (b: unknown) => POST(authed("/api/budget/other", { method: "POST", body: JSON.stringify(b) })).then(async (r) => ({ status: r.status, ...(await r.json()) }));
const month = (m: string) => GET(authed(`/api/budget/other?month=${m}`)).then(async (r) => ({ status: r.status, ...(await r.json()) }));
let n = 0;
const id = () => `oth-test-${String(++n).padStart(4, "0")}`;

test("1) 확보(+)·차감(-)·여러 항목 등록 → 월 합계, 기존 장표·고객혜택·스팟·현금 예산 불변", async () => {
  const { ss } = setup();
  await register(report(PEOPLE[0].name, PEOPLE[0].ctn, { use: "ㄴ추가지원금 : 5만\n" }));
  const sheetBefore = JSON.stringify(ss.month().rows);
  const budgetBefore = calculateBudget(await list());
  const a = await post({ op: "create", month: "2026-10", id: id(), name: "별도 영업지원금", kind: "gain", amount: 300000, memo: "회사 정책" });
  const b = await post({ op: "create", month: "2026-10", id: id(), name: "운영비 차감", kind: "deduct", amount: 50000, memo: "" });
  const c = await post({ op: "create", month: "2026-10", id: id(), name: "정책비 추가 확보", kind: "gain", amount: 20000 });
  assert.equal(a.ok && b.ok && c.ok, true, JSON.stringify([a, b, c]));
  const l = await month("2026-10");
  assert.equal(l.data.items.length, 3);
  assert.equal(l.data.gain, 320000);
  assert.equal(l.data.deduct, 50000);
  assert.equal(l.data.net, 270000);
  assert.equal(JSON.stringify(ss.month().rows), sheetBefore, "월별 장표는 그대로");
  const budgetAfter = calculateBudget(await list());
  assert.deepEqual(budgetAfter, budgetBefore, "고객혜택·추가지원금·스팟·현금 예산 불변");
  assert.ok(ss.sheets.get("기타예산내역"));
  assert.ok(ss.sheets.get("기타예산변경이력"));
});

test("2) 계산 예시: 기존 -2,983,037 + (300,000 − 50,000) = -2,733,037 / AC 검증은 기존 총예산 기준", async () => {
  assert.deepEqual(applyOtherBudget(-2983037, 300000 - 50000), { existingTotal: -2983037, net: 250000, finalTotal: -2733037 });
  const { ss } = setup();
  await register(report(PEOPLE[0].name, PEOPLE[0].ctn, { use: "ㄴ추가지원금 : 5만\n" }));
  const sales = await list();
  const g = await gPOST(authed("/api/budget/gobulbi", { method: "POST", body: JSON.stringify({ op: "create", month: "2026-10", id: "gob-test-0001", content: "가짜", amount: 10000, seller: STAFF_NAMES[0] }) })).then((r) => r.json());
  assert.equal(g.ok, true, g.message);
  await post({ op: "create", month: "2026-10", id: id(), name: "별도 지원금", kind: "gain", amount: 300000 });
  await post({ op: "create", month: "2026-10", id: id(), name: "운영비 정산", kind: "deduct", amount: 50000 });
  const gob = (await gGET(authed("/api/budget/gobulbi?month=2026-10")).then((r) => r.json())).data.total;
  const other = (await month("2026-10")).data;
  const applied = applyGobulbi(calculateBudget(sales), gob);
  const acTotal = sales.reduce((t, s) => t + (s.finalTotal ?? 0), 0);
  assert.equal(acTotal, Number(ss.month().value(8, 29)), "AC8 합계");
  assert.equal(checkAgainstSheetAc(acTotal, applied).ok, true, "AC 검증은 기존 매장 총예산 기준 그대로 일치");
  const final = applyOtherBudget(applied.total, other.net);
  assert.equal(final.finalTotal, applied.total + 250000);
  assert.notEqual(final.finalTotal, acTotal - gob, "최종 총예산은 AC 와 직접 비교하지 않음 (비교하면 불일치)");
});

test("3) 월별 구분: 다른 달 항목은 섞이지 않음", async () => {
  setup();
  await post({ op: "create", month: "2026-10", id: id(), name: "10월 항목", kind: "gain", amount: 1000 });
  await post({ op: "create", month: "2026-11", id: id(), name: "11월 항목", kind: "deduct", amount: 2000 });
  const oct = (await month("2026-10")).data;
  const nov = (await month("2026-11")).data;
  assert.deepEqual([oct.items.length, oct.net], [1, 1000]);
  assert.deepEqual([nov.items.length, nov.net], [1, -2000]);
});

test("4) 수정·삭제·복구: 화면에서 본 값과 같을 때만, 이력 보존, 합계 재계산", async () => {
  const { ss } = setup();
  const i1 = id();
  await post({ op: "create", month: "2026-10", id: i1, name: "회사 특별지원금", kind: "gain", amount: 100000, memo: "1차" });
  let item: OtherBudgetItem = (await month("2026-10")).data.items[0];
  const u = await post({ op: "update", id: i1, before: otherBeforeOf(item), name: "회사 특별지원금", kind: "gain", amount: 150000, memo: "2차" });
  assert.equal(u.ok, true, u.message);
  assert.equal((await month("2026-10")).data.net, 150000);
  // 예전 화면 값(before)으로 다시 수정 → 거부
  const stale = await post({ op: "update", id: i1, before: otherBeforeOf(item), name: "x", kind: "deduct", amount: 1, memo: "" });
  assert.equal(stale.ok, false);
  assert.match(stale.message, /그사이/);
  item = (await month("2026-10")).data.items[0];
  const d = await post({ op: "delete", id: i1, before: otherBeforeOf(item) });
  assert.equal(d.ok, true, d.message);
  let l = (await month("2026-10")).data;
  assert.deepEqual([l.items.length, l.deleted.length, l.net], [0, 1, 0], "삭제하면 합계에서 빠지고 복구 목록에 남음");
  const r = await post({ op: "restore", id: i1, before: otherBeforeOf(l.deleted[0]) });
  assert.equal(r.ok, true, r.message);
  l = (await month("2026-10")).data;
  assert.deepEqual([l.items.length, l.net], [1, 150000]);
  const hist = (ss.sheets.get("기타예산변경이력") as FakeSheet).allText().join("\n");
  for (const w of ["등록", "수정", "삭제", "복구", "100000", "150000"]) assert.ok(hist.includes(w), w);
  // 행은 지우지 않음
  assert.equal((ss.sheets.get("기타예산내역") as FakeSheet).getLastRow(), 2);
});

test("5) 중복 요청 방지·입력값 검증·글자 그대로 보관", async () => {
  const { ss } = setup();
  const i1 = id();
  const body = { op: "create", month: "2026-10", id: i1, name: "=SUM(A1)", kind: "deduct", amount: 50000, memo: "007" };
  const a = await post(body);
  const b = await post(body);
  assert.equal(a.ok, true);
  assert.equal(b.duplicate, true);
  assert.equal((await month("2026-10")).data.items.length, 1);
  const sheet = ss.sheets.get("기타예산내역") as FakeSheet;
  assert.equal(sheet.peek(2, 3)!.formula, "", "항목명이 수식으로 바뀌지 않음");
  assert.equal(sheet.value(2, 3), "=SUM(A1)");
  assert.equal(sheet.value(2, 6), "007");
  assert.equal((await post({ ...body, name: "다른 내용" })).ok, false, "같은 ID 다른 내용 거부");
  for (const bad of [
    { amount: 0 }, { amount: -5000 }, { amount: 1.5 }, { amount: "30000" }, { kind: "plus" }, { name: "" }, { name: "a".repeat(41) }, { month: "2026-13" },
  ]) {
    const r = await post({ ...body, id: id(), ...bad });
    assert.equal(r.ok, false, JSON.stringify(bad));
    assert.equal(r.status, 400);
  }
  assert.equal(parseOtherAmount("300,000원"), 300000);
  assert.equal(parseOtherAmount("30만"), 300000);
  assert.equal(parseOtherAmount("-5"), null);
});

test("6) 관리자 외 사용자(로그인 없음) 등록·조회 차단 — Apps Script 로 아무것도 보내지 않음", async () => {
  const { gas, ss } = setup();
  const before = gas.calls.length;
  const r = await POST(new Request("https://test.invalid/api/budget/other", { method: "POST", headers: { origin: "https://test.invalid" }, body: JSON.stringify({ op: "create", month: "2026-10", id: id(), name: "x", kind: "gain", amount: 1 }) }));
  assert.equal(r.status, 401);
  const g = await GET(new Request("https://test.invalid/api/budget/other?month=2026-10"));
  assert.equal(g.status, 401);
  assert.equal(gas.calls.length, before);
  assert.equal(ss.sheets.get("기타예산내역"), undefined);
});

test("7) 시트 제목이 바뀌었으면 읽지도 쓰지도 않음", async () => {
  const { ss } = setup();
  await post({ op: "create", month: "2026-10", id: id(), name: "a", kind: "gain", amount: 1 });
  (ss.sheets.get("기타예산내역") as FakeSheet).cell(1, 5).value = "금액(원)";
  assert.equal((await month("2026-10")).ok, false);
  assert.equal((await post({ op: "create", month: "2026-10", id: id(), name: "b", kind: "gain", amount: 1 })).ok, false);
});
