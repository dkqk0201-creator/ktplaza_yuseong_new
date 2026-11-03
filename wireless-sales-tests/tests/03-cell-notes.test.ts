/*
 * 셀 메모(Note)가 저장·정렬·삭제 때 어떻게 되는지 (판매 ID 를 B열 메모에 두는 설계의 근거).
 * [판매 ID 구현 후 기대값 변경] 2~4번은 수정 전 "[현재 동작]"(B열 메모가 자리에 남음·삭제 때 메모 유지)을
 *   기록했던 테스트다. 구현 후에는 B열 판매 ID 메모가 판매를 따라 움직이고, 새 판매·삭제 때 남은 메모를 지우는지 확인한다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { setup, register, report, list, byName, deleteSale } from "../harness/web.ts";
import { PEOPLE, tMaskName as MN } from "../harness/fake-people.ts";
import { colNum as L } from "../harness/formula.ts";

const [A, B, C] = PEOPLE;

test("1) O열(SPOT) 메모는 정렬로 판매가 다른 행으로 밀려도 판매를 따라감", async () => {
  const { ss } = setup();
  await register(report(A.name, A.ctn, { date: "10.07" }));
  const a = byName(await list(), A.name);
  ss.month().cell(a.row, L("O")).note = "스팟3 3만";
  await register(report(B.name, B.ctn, { date: "10.03" })); // 더 이른 날짜 → A 가 한 줄 아래로
  const a2 = byName(await list(), A.name);
  assert.equal(a2.row, a.row + 1);
  assert.equal(ss.month().cell(a2.row, L("O")).note, "스팟3 3만");
  assert.equal(ss.month().cell(a.row, L("O")).note, "");
  assert.equal(a2.spotNote, "스팟3 3만");
});

test("2) B열 판매 ID 메모는 정렬 때 판매를 따라감 (자리에 남지 않음)", async () => {
  const { ss } = setup();
  await register(report(A.name, A.ctn, { date: "10.07" }));
  const a = byName(await list(), A.name);
  const idNote = ss.month().cell(a.row, 2).note;
  assert.match(idNote, /웹앱 판매ID: S-/);
  await register(report(B.name, B.ctn, { date: "10.03" }));
  const sales = await list();
  const b = byName(sales, B.name);
  const a2 = byName(sales, A.name);
  assert.equal(b.row, a.row); // B 가 A 의 원래 자리로
  assert.equal(a2.row, a.row + 1);
  assert.equal(ss.month().cell(a2.row, 2).note, idNote, "A 의 ID 메모가 A 를 따라감");
  assert.equal(a2.saleId, a.saleId);
  assert.notEqual(b.saleId, a.saleId);
  assert.match(ss.month().cell(b.row, 2).note, new RegExp(String(b.saleId)));
});

test("3) 새 판매가 들어가는 빈 자리: 남아 있던 메모(B열 포함)는 지우고 새 판매 ID 메모만", async () => {
  const { ss } = setup();
  ss.month().cell(9, 2).note = "예전 메모 웹앱 판매ID: S-OLDOLDOLDOLDOLDOLD12";
  ss.month().cell(9, L("O")).note = "예전 스팟 메모";
  await register(report(A.name, A.ctn));
  const a = byName(await list(), A.name);
  assert.equal(a.row, 9);
  assert.equal(ss.month().cell(9, L("O")).note, "");
  assert.notEqual(a.saleId, "S-OLDOLDOLDOLDOLDOLD12");
  assert.doesNotMatch(ss.month().cell(9, 2).note, /예전 메모|OLDOLD/);
  assert.match(ss.month().cell(9, 2).note, new RegExp(String(a.saleId)));
});

test("4) 판매 삭제: 그 행의 셀 메모(B열 판매 ID·O열 등)를 모두 지움 → 그 자리의 새 판매가 물려받지 않음", async () => {
  const { ss } = setup();
  await register(report(A.name, A.ctn, { date: "10.03" }), report(C.name, C.ctn, { date: "10.04" }));
  const a = byName(await list(), A.name);
  ss.month().cell(a.row, L("O")).note = "스팟1 1만";
  assert.equal((await deleteSale(a)).ok, true);
  assert.equal(ss.month().cell(a.row, 2).note, "");
  assert.equal(ss.month().cell(a.row, L("O")).note, "");
  await register(report(B.name, B.ctn, { date: "10.03" }));
  const b = byName(await list(), B.name);
  assert.equal(b.row, a.row);
  assert.notEqual(b.saleId, a.saleId);
  assert.equal(ss.month().cell(b.row, L("O")).note, "");
  // 남은 판매 C 의 ID 는 그대로
  assert.equal(byName(await list(), C.name).saleId !== undefined, true);
});

test("5) 시트에서 직접 행을 복사하면 메모도 복사됨 (가짜 시트로 흉내) → 같은 판매 ID 2행 = 중복 표시", async () => {
  const { ss } = setup();
  await register(report(A.name, A.ctn));
  const a = byName(await list(), A.name);
  const m = ss.month();
  for (let c = 1; c <= 38; c++) { const src = m.cell(a.row, c); const dst = m.cell(a.row + 1, c); dst.value = c === 2 ? a.row - 7 : src.value; dst.formula = src.formula.replace(new RegExp(String(a.row), "g"), String(a.row + 1)); dst.note = src.note; }
  const sales = await list();
  const twins = sales.filter((s) => s.customer === MN(A.name));
  assert.equal(twins.length, 2);
  assert.equal(m.cell(a.row, 2).note, m.cell(a.row + 1, 2).note);
  assert.deepEqual(twins.map((s) => s.saleIdProblem), ["duplicate", "duplicate"]);
});
