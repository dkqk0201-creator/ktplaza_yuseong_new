/*
 * 셀 메모(Note)가 저장·정렬·삭제 때 어떻게 되는지 (판매 ID 를 B열 메모에 두는 설계의 근거).
 * "[현재 동작]" 테스트는 지금 코드의 동작을 기록한다 — ID 구현 시 바뀌어야 하는 부분은 09-privacy-spec 의 todo 로.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { setup, register, report, list, byName, deleteSale } from "../harness/web.ts";
import { PEOPLE } from "../harness/fake-people.ts";
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

test("2) [현재 동작] B열(No.) 메모는 정렬 때 판매를 따라가지 않고 행 자리에 남음 → 그대로 ID 로 쓰면 다른 판매에 붙음", async () => {
  const { ss } = setup();
  await register(report(A.name, A.ctn, { date: "10.07" }));
  const a = byName(await list(), A.name);
  ss.month().cell(a.row, 2).note = "판매ID:TEST-A";
  await register(report(B.name, B.ctn, { date: "10.03" }));
  const sales = await list();
  assert.equal(byName(sales, B.name).row, a.row); // B 가 A 의 원래 자리로
  assert.equal(ss.month().cell(a.row, 2).note, "판매ID:TEST-A"); // 메모는 그 자리에 → 이제 B 의 행
  assert.equal(ss.month().cell(byName(sales, A.name).row, 2).note, "");
});

test("3) [현재 동작] 새 판매가 들어가는 빈 자리: A·C~AL 메모는 지워지지만 B열 메모는 남음", async () => {
  const { ss } = setup();
  ss.month().cell(9, 2).note = "예전 메모";
  ss.month().cell(9, L("O")).note = "예전 스팟 메모";
  await register(report(A.name, A.ctn));
  const a = byName(await list(), A.name);
  assert.equal(a.row, 9);
  assert.equal(ss.month().cell(9, L("O")).note, "");
  assert.equal(ss.month().cell(9, 2).note, "예전 메모");
});

test("4) [현재 동작] 판매 삭제 시 그 행 셀 메모 처리 기록", async () => {
  const { ss } = setup();
  await register(report(A.name, A.ctn, { date: "10.03" }), report(C.name, C.ctn, { date: "10.04" }));
  const a = byName(await list(), A.name);
  ss.month().cell(a.row, 2).note = "판매ID:TEST-A";
  ss.month().cell(a.row, L("O")).note = "스팟1 1만";
  assert.equal((await deleteSale(a)).ok, true);
  // 삭제는 값만 빈 자리 모양으로 되돌린다 — 메모는 지우지 않는다 (현재)
  assert.equal(ss.month().cell(a.row, 2).note, "판매ID:TEST-A");
  assert.equal(ss.month().cell(a.row, L("O")).note, "스팟1 1만");
  // 그 자리에 새 판매가 들어오면 O 메모는 지워지고 B 메모는 남는다 (3번과 같음)
  await register(report(B.name, B.ctn, { date: "10.03" }));
  const b = byName(await list(), B.name);
  assert.equal(b.row, a.row);
  assert.equal(ss.month().cell(b.row, L("O")).note, "");
  assert.equal(ss.month().cell(b.row, 2).note, "판매ID:TEST-A");
});

test("5) 시트에서 직접 행을 복사하면 메모도 복사됨 (가짜 시트로 흉내) → ID 중복 상황 재현용", async () => {
  const { ss } = setup();
  await register(report(A.name, A.ctn));
  const a = byName(await list(), A.name);
  const m = ss.month();
  m.cell(a.row, 2).note = "판매ID:TEST-A";
  for (let c = 1; c <= 38; c++) { const src = m.cell(a.row, c); const dst = m.cell(a.row + 1, c); dst.value = c === 2 ? a.row - 7 : src.value; dst.formula = src.formula.replace(new RegExp(String(a.row), "g"), String(a.row + 1)); dst.note = src.note; }
  const sales = await list();
  assert.equal(sales.filter((s) => s.customer === A.name).length, 2);
  assert.deepEqual([m.cell(a.row, 2).note, m.cell(a.row + 1, 2).note], ["판매ID:TEST-A", "판매ID:TEST-A"]);
});
