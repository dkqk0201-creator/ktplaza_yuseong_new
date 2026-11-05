/* 판매 수정·삭제 (update-handler / delete-handler) — 현재 동작 회귀 테스트 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { setup, register, report, list, byName, edit, deleteSale, target, authed } from "../harness/web.ts";
import { PEOPLE, digits } from "../harness/fake-people.ts";
import { colNum as L } from "../harness/formula.ts";
import { POST as updatePOST } from "@/app/api/sales/update/route";

const [A, B, C] = PEOPLE;
const raw = (body: unknown) => updatePOST(authed("/api/sales/update", { method: "POST", body: JSON.stringify(body) })).then(async (r) => ({ status: r.status, ...(await r.json()) }));

test("1) 금액 수정: 바꾼 칸만 쓰고 N·U·AB·AC 수식 유지, 다른 판매 그대로", async () => {
  const { ss } = setup();
  await register(report(A.name, A.ctn, { date: "10.03" }), report(B.name, B.ctn, { date: "10.04" }));
  const s = byName(await list(), A.name);
  const otherBefore = JSON.stringify(ss.month().rows[byName(await list(), B.name).row - 1]);
  const r = await edit(s, { customerBenefit: "70000" });
  assert.equal(r.ok, true, r.message);
  const m = ss.month();
  assert.equal(m.value(s.row, L("T")), 70000);
  assert.equal(m.value(s.row, L("N")), 70000);
  assert.equal(m.peek(s.row, L("N"))!.formula, `=SUM(O${s.row}:T${s.row})`);
  assert.equal(JSON.stringify(m.rows[byName(await list(), B.name).row - 1]), otherBefore);
});

test("2) 그사이 장표가 바뀌었으면(화면에서 본 값과 다름) 덮어쓰지 않음", async () => {
  const { ss } = setup();
  await register(report(A.name, A.ctn));
  const s = byName(await list(), A.name);
  ss.month().cell(s.row, L("T")).value = 60000; // 다른 사람이 장표에서 직접 고침
  const snap = JSON.stringify(ss.month().rows);
  const r = await edit(s, { customerBenefit: "70000" });
  assert.equal(r.ok, false);
  assert.match(r.message, /화면과 달라/);
  assert.equal(JSON.stringify(ss.month().rows), snap);
});

test("3) 판매 확인: 행·No.·개통일·고객·CTN 중 하나라도 다르면 거부 (아무것도 안 씀) — 같은 요청을 맞는 판매로 보내면 저장됨", async () => {
  const { ss } = setup();
  await register(report(A.name, A.ctn));
  const s = byName(await list(), A.name);
  const snap = JSON.stringify(ss.month().rows);
  const change = [{ key: "customerBenefit", before: "50000", after: "1" }];
  for (const bad of [{ customer: B.name }, { ctn: B.ctn }, { activatedAt: "2026-10-06" }, { no: "7" }, { row: s.row + 1 }]) {
    const r = await raw({ target: { ...target(s), ...bad }, changes: change });
    assert.equal(r.ok, false, JSON.stringify(bad));
    assert.match(r.message, /화면과 달라|행이|판매 내용이 없는|없습니다/, JSON.stringify(bad) + " " + r.message);
  }
  assert.equal(JSON.stringify(ss.month().rows), snap);
  const ok = await raw({ target: target(s), changes: change }); // 대조군: 형식은 맞는 요청
  assert.equal(ok.ok, true, ok.message);
  assert.equal(ss.month().value(s.row, L("T")), 1);
});

test("4) B열(No.)·C열(개통일)·N·U·AB·AC 수식 칸은 웹앱 서버와 Apps Script 양쪽에서 거부", async () => {
  const { ss, gas } = setup();
  await register(report(A.name, A.ctn));
  const s = byName(await list(), A.name);
  const snap = JSON.stringify(ss.month().rows);
  for (const key of ["no", "activatedAt", "securedTotal", "usedTotal", "usedPhoneRemaining", "finalTotal"]) {
    const r = await raw({ target: target(s), changes: [{ key, before: String(ss.month().value(s.row, 2)), after: "9" }] });
    assert.equal(r.ok, false, key);
  }
  // 웹앱을 거치지 않고 Apps Script 에 직접 보내도 거부
  for (const col of [1, 2, L("N") - 1, L("U") - 1, L("AB") - 1, L("AC") - 1]) {
    const r = gas.doPost({ action: "sale-update", target: target(s), changes: [{ col, before: String(ss.month().value(s.row, col + 1) ?? ""), value: "9" }] });
    assert.equal(r.ok, false, `col ${col}: ${r.message}`);
  }
  assert.equal(JSON.stringify(ss.month().rows), snap);
  const ok = gas.doPost({ action: "sale-update", target: target(s), changes: [{ col: L("T") - 1, before: "50000", value: 70000 }] }); // 대조군
  assert.equal(ok.ok, true, ok.message);
});

test("5) 고객명·CTN 수정 → 웹앱참고 연결 키도 새 값으로 옮김 (참고내용 유지)", async () => {
  const { ss } = setup();
  await register(report(A.name, A.ctn, { extra: "중고폰&현물 판매 : x\n" }));
  const s = byName(await list(), A.name);
  const r = await edit(s, { customer: C.name, ctn: C.ctn });
  assert.equal(r.ok, true, r.message);
  const keys = ss.getSheetByName("웹앱참고")!.rows.slice(1).map((row) => String(row[0]?.value));
  assert.deepEqual(keys, [`10월|2026-10-05|${digits(C.ctn)}|${C.name}`]);
  assert.equal(byName(await list(), C.name).notes?.usedPhone, "x");
});

test("6) 삭제: 그 행만 빈 판매 자리 모양으로 (아래 판매는 그대로, 빈 자리도 번호 유지), 참고내용도 지움", async () => {
  const { ss } = setup();
  await register(report(A.name, A.ctn, { date: "10.03", extra: "중고폰&현물 판매 : x\n" }), report(B.name, B.ctn, { date: "10.04" }));
  const s = byName(await list(), A.name);
  const r = await deleteSale(s);
  assert.equal(r.ok, true, r.message);
  const sales = await list();
  assert.deepEqual(sales.map((x) => [x.row, x.customer, x.no]), [[10, B.name, "2"]]);
  const m = ss.month();
  assert.deepEqual([m.value(9, 2), m.value(9, L("D")), m.value(9, L("E")), m.value(9, L("N"))], [1, "", "", "-"]);
  const notes = ss.getSheetByName("웹앱참고")!;
  assert.equal(notes.rows.slice(1).filter((row) => String(row[0]?.value ?? "").includes(digits(A.ctn))).length, 0);
});

test("7) 삭제도 판매 확인이 다르면 거부 (다른 판매를 지우지 않음)", async () => {
  const { ss } = setup();
  await register(report(A.name, A.ctn));
  const s = byName(await list(), A.name);
  const snap = JSON.stringify(ss.month().rows);
  const r = await deleteSale({ ...s, customer: B.name });
  assert.equal(r.ok, false);
  assert.equal(JSON.stringify(ss.month().rows), snap);
});
