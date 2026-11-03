/*
 * 검수완료(G)·수납완료(H)·카드실적 등록완료(AG)·검수 보완 요청 — 회귀 테스트
 * [마스킹 적용 후 기대값 변경] 4번 보완 기록 키가 판매 ID(월|id:…)로, 고객·CTN 칸은 마스킹 값. 그 밖은 수정 전과 같다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { setup, register, report, list, byName, markDone, cardCheck, review, edit, deleteSale } from "../harness/web.ts";
import { PEOPLE, tMaskName as MN, tMaskPhone as MP } from "../harness/fake-people.ts";
import { colNum as L } from "../harness/formula.ts";

const [A, B, C] = PEOPLE;

for (const [field, col] of [["inspected", "G"], ["paid", "H"]] as const) {
  test(`1) ${col}열 완료: 그 칸만 O 로 (다른 칸·수식·No. 그대로)`, async () => {
    const { ss } = setup();
    await register(report(A.name, A.ctn), report(B.name, B.ctn));
    const s = byName(await list(), A.name);
    const snapOther = JSON.stringify(ss.month().rows.map((r, i) => (i + 1 === s.row ? null : r)));
    const writes0 = ss.month().writes.length;
    const r = await markDone(s, field);
    assert.equal(r.ok, true, r.message);
    assert.equal(ss.month().value(s.row, L(col)), "O");
    assert.deepEqual(ss.month().writes.slice(writes0), [`setValue ${s.row},${L(col)} 1x1`]);
    assert.equal(JSON.stringify(ss.month().rows.map((r, i) => (i + 1 === s.row ? null : r))), snapOther);
  });
}

test("2) 완료: 화면에서 본 값이 다르거나(그사이 O), 판매 확인이 다르면 거부", async () => {
  const { ss } = setup();
  await register(report(A.name, A.ctn));
  const s = byName(await list(), A.name);
  ss.month().cell(s.row, L("G")).value = "O";
  assert.equal((await markDone(s, "inspected")).ok, false);
  const s2 = byName(await list(), A.name);
  const snap = JSON.stringify(ss.month().rows);
  assert.equal((await markDone({ ...s2, ctn: MP(B.ctn) }, "paid")).ok, false);
  assert.equal((await markDone({ ...s2, customer: MN(B.name) }, "paid")).ok, false);
  assert.equal((await markDone({ ...s2, saleId: "S-AAAAAAAAAAAAAAAAAAAA" }, "paid")).ok, false);
  assert.equal(JSON.stringify(ss.month().rows), snap);
});

test("3) 카드실적 등록완료: AG열만 O", async () => {
  const { ss } = setup();
  await register(report(A.name, A.ctn, { extra: "제카 : 우리\n" }));
  const s = byName(await list(), A.name);
  const w0 = ss.month().writes.length;
  const r = await cardCheck(s);
  assert.equal(r.ok, true, r.message);
  assert.equal(ss.month().value(s.row, L("AG")), "O");
  assert.deepEqual(ss.month().writes.slice(w0), [`setValue ${s.row},${L("AG")} 1x1`]);
});

test("4) 보완 요청: 저장 → 목록에 붙음 → 취소, 기록은 검수보완 시트에 (판매 키 = 월|id:판매ID, 고객·CTN 칸은 마스킹)", async () => {
  const { ss } = setup();
  await register(report(A.name, A.ctn));
  let s = byName(await list(), A.name);
  const r = await review(s, "save", "가입신청서 서명 누락");
  assert.equal(r.ok, true, r.message);
  s = byName(await list(), A.name);
  assert.equal(s.review?.active?.content, "가입신청서 서명 누락");
  const sheet = ss.getSheetByName("검수보완")!;
  assert.equal(sheet.hidden, true);
  assert.equal(sheet.value(2, 2), `10월|id:${s.saleId}`);
  assert.deepEqual([sheet.value(2, 6), sheet.value(2, 7)], [MN(A.name), MP(A.ctn)]);
  assert.equal((await review(s, "cancel")).ok, true);
  assert.equal(byName(await list(), A.name).review?.active ?? null, null);
});

test("5) 보완 요청 → 검수완료(G=O) 하면 자동으로 닫힘(이력 보관)", async () => {
  setup();
  await register(report(A.name, A.ctn));
  let s = byName(await list(), A.name);
  await review(s, "save", "신분증 사본 필요");
  s = byName(await list(), A.name);
  const r = await markDone(s, "inspected");
  assert.equal(r.ok, true, r.message);
  assert.equal(r.reviewClosed, true);
  const s2 = byName(await list(), A.name);
  assert.equal(s2.review?.active ?? null, null);
  assert.ok((s2.review?.history ?? []).length >= 1);
});

test("6) 고객명 수정 → 보완 기록 키 이동 / 판매 삭제 → 보완 기록은 지우지 않고 보관(같은 판매로 다시 등록해도 안 붙음)", async () => {
  const { ss } = setup();
  await register(report(A.name, A.ctn));
  let s = byName(await list(), A.name);
  await review(s, "save", "서류 보완");
  s = byName(await list(), A.name);
  assert.equal((await edit(s, { customer: C.name })).ok, true);
  assert.equal(byName(await list(), C.name).review?.active?.content, "서류 보완");
  const c = byName(await list(), C.name);
  assert.equal((await deleteSale(c)).ok, true);
  const keys = ss.getSheetByName("검수보완")!.rows.slice(1).map((row) => String(row[1]?.value));
  assert.ok(keys.every((k) => k.startsWith("삭제|")), keys.join());
  await register(report(C.name, A.ctn));
  assert.equal(byName(await list(), C.name).review ?? null, null);
});
