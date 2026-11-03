/*
 * 참고내용(웹앱참고)·정책명 연결 — 같은 고객으로 보이는 판매가 있을 때.
 * [판매 ID 구현 후 기대값 변경] 신규 판매의 연결 키는 월|id:판매ID.
 *   1·2번: 시트에서 값만 복사한 행(B열 ID 메모 없음 = ID 분실)에는 참고내용이 붙지 않고 수정도 거부, 원래 판매는 그대로 동작.
 *   3번: 수정 전에는 같은 키로 다시 등록하면 기존 참고내용을 덮어썼다(위험) → 이제 판매마다 따로 보관.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { setup, register, report, list, edit } from "../harness/web.ts";
import { PEOPLE, tMaskName as MN } from "../harness/fake-people.ts";

const [A, B] = PEOPLE;

test("1) 값만 복사한 행(판매 ID 없음)에는 참고내용이 붙지 않음 — 원래 판매에만", async () => {
  const { ss } = setup();
  await register(report(A.name, A.ctn, { extra: "중고폰&현물 판매 : 리본\n" }));
  // 시트에서 직접 같은 개통일·고객·CTN 판매를 하나 더 만든 상황 (2회선 등)
  const m = ss.month();
  const src = (await list())[0].row;
  for (let c = 1; c <= 38; c++) { const a = m.cell(src, c); const b = m.cell(src + 1, c); b.value = c === 2 ? 2 : a.value; b.formula = a.formula.replace(new RegExp(String(src), "g"), String(src + 1)); }
  const sales = await list();
  assert.equal(sales.length, 2);
  assert.deepEqual(sales.map((s) => [s.notes?.usedPhone ?? null, s.saleIdProblem ?? null]), [["리본", null], [null, "missing"]]);
});

test("2) 판매 ID 없는 복사 행의 참고내용·판매 수정은 거부, 원래 판매 수정은 복사 행에 영향 없음", async () => {
  const { ss } = setup();
  await register(report(A.name, A.ctn));
  const m = ss.month();
  const src = (await list())[0].row;
  for (let c = 1; c <= 38; c++) { const a = m.cell(src, c); const b = m.cell(src + 1, c); b.value = c === 2 ? 2 : a.value; b.formula = a.formula.replace(new RegExp(String(src), "g"), String(src + 1)); }
  const [orig, copy] = await list();
  const copyRow = JSON.stringify(m.rows[copy.row - 1]);
  const r = await edit(copy, {}, { usedPhone: "새 메모" } as Record<string, string>);
  assert.equal(r.ok, false);
  assert.match(r.message, /판매 ID 없음/);
  assert.equal((await edit(copy, { customerBenefit: "1" })).ok, false);
  const ok = await edit(orig, {}, { usedPhone: "원래 판매 메모" } as Record<string, string>);
  assert.equal(ok.ok, true, ok.message);
  assert.equal(JSON.stringify(m.rows[copy.row - 1]), copyRow);
  const after = await list();
  assert.deepEqual(after.map((s) => s.notes?.usedPhone ?? null), ["원래 판매 메모", null]);
});

test("3) 같은 개통일·고객·CTN 으로 또 등록해도 기존 참고내용을 덮어쓰지 않음 (판매마다 따로)", async () => {
  const { ss } = setup();
  await register(report(A.name, A.ctn, { extra: "중고폰&현물 판매 : 첫판매메모\n" }));
  await register(report(A.name, A.ctn, { extra: "중고폰&현물 판매 : 둘째판매메모\n" })); // 같은 개통일·고객·CTN
  const rows = ss.getSheetByName("웹앱참고")!.rows.slice(1).filter((r) => r[0]?.value);
  assert.equal(rows.length, 2);
  assert.match(String(rows[0][5].value), /첫판매메모/);
  assert.match(String(rows[1][5].value), /둘째판매메모/);
  const sales = await list();
  assert.deepEqual(sales.map((s) => s.notes?.usedPhone).sort(), ["둘째판매메모", "첫판매메모"]);
});

test("4) 다른 사람(키가 다름)의 참고내용은 섞이지 않음", async () => {
  setup();
  await register(report(A.name, A.ctn, { extra: "중고폰&현물 판매 : A메모\n" }), report(B.name, B.ctn, { extra: "중고폰&현물 판매 : B메모\n" }));
  const sales = await list();
  assert.deepEqual(sales.map((s) => [s.customer, s.notes?.usedPhone]), [[MN(A.name), "A메모"], [MN(B.name), "B메모"]]);
});
