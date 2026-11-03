/*
 * 개인정보 마스킹·판매 ID — 확정된 요구사항의 "기대 동작" (구현 전이라 todo 로 표시, 실패해도 전체 결과는 실패 아님).
 * 구현이 끝나면 todo 를 떼고 모두 통과해야 한다.
 *   고객명: 김수현 → 김수*   (한 글자 → *, 영문 → 앞 2글자 + *)
 *   전화:   010-1234-5678 → 010-12**-*678   (10자리 011-123-4567 → 011-12*-*567)
 *   판매 ID: B열(No.) 셀 메모, 정렬·삭제·복사에도 다른 판매에 붙지 않음, 분실·중복이면 안전하게 거부
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { setup, register, report, list, byName, edit, deleteSale, markDone, review, cardCheck, serverLogs, responses, target } from "../harness/web.ts";
import { PEOPLE, TWINS } from "../harness/fake-people.ts";
import { findOriginals, sheetTexts, jsonTexts } from "../harness/privacy.ts";
import { makeGas } from "../harness/gas.ts";
import { colNum as L } from "../harness/formula.ts";
import { cardPendingMessage } from "@/lib/card-message";
import { reviewMessage } from "@/lib/inspection-review";

const TODO = { todo: "마스킹·판매 ID 구현 전 (기대 동작)" };
const [A, B, C, D] = PEOPLE;
const mask = async () => (await import("@/lib/privacy-mask")) as { maskName: (s: string) => string; maskPhone: (s: string) => string; maskFreeText: (s: string) => string };
/** 기존(원본 그대로) 판매를 장표에 직접 넣는다 — 10월·11월 기존 데이터 흉내 */
function legacyRow(ss: ReturnType<typeof setup>["ss"], row: number, p: { name: string; ctn: string }, date = "2026-10-02") {
  const m = ss.month();
  const set = (c: string, v: unknown) => { m.cell(row, L(c)).value = v; };
  set("C", date); set("D", p.name); set("E", p.ctn); set("I", "기기변경"); set("M", "김수현"); set("T", 50000); set("G", "X"); set("H", "X");
  m.cell(row, L("N")).formula = `=SUM(O${row}:T${row})`; m.cell(row, L("U")).formula = `=SUM(V${row}:Y${row})`;
}

test("S1) 마스킹 규칙 (같은 값을 다시 넣어도 그대로)", TODO, async () => {
  const { maskName, maskPhone } = await mask();
  const cases: [string, string][] = [["김수현", "김수*"], ["이훈", "이*"], ["김", "*"], ["남궁민수", "남궁민*"], ["John Smith", "Jo********"], ["외국인", "외국*"], ["김수*", "김수*"], ["", ""]];
  for (const [i, o] of cases) assert.equal(maskName(i), o, i);
  const phones: [string, string][] = [["010-1234-5678", "010-12**-*678"], ["01012345678", "010-12**-*678"], ["010 1234 5678", "010-12**-*678"], ["011-123-4567", "011-12*-*567"], ["0111234567", "011-12*-*567"], ["010-12**-*678", "010-12**-*678"], ["", ""]];
  for (const [i, o] of phones) assert.equal(maskPhone(i), o, i);
});

test("S2) 신규 등록: 장표·웹앱참고·검수보완·응답·로그 어디에도 원본 이름·번호가 없음", TODO, async () => {
  const { ss, gas } = setup();
  serverLogs.length = 0; responses.length = 0;
  await register(report(A.name, A.ctn, { extra: "중고폰&현물 판매 : 메모\n" }), report(B.name, B.ctn, { date: "10.04" }));
  let a = byName(await list(), "가나*");
  await review(a, "save", "서류 보완");
  a = byName(await list(), "가나*");
  await markDone(a, "inspected");
  const hits = [...findOriginals(sheetTexts(ss), [A, B]), ...findOriginals(jsonTexts(responses), [A, B]), ...findOriginals(serverLogs, [A, B]), ...findOriginals(gas.logs, [A, B])];
  assert.deepEqual(hits, []);
  assert.deepEqual([ss.month().value(a.row, L("D")), ss.month().value(a.row, L("E"))], ["가나*", "010-00**-*111"]);
});

test("S3) Apps Script 도 마스킹을 강제: 웹앱을 거치지 않고 원본을 보내도 원본은 저장되지 않음", TODO, async () => {
  const { ss, gas } = setup();
  const row = Array(38).fill(null);
  row[2] = "2026-10-05"; row[3] = A.name; row[4] = A.ctn; row[8] = "기기변경"; row[12] = "김수현";
  gas.doPost({ action: "save", rows: [row] });
  assert.deepEqual(findOriginals(sheetTexts(ss), [A]), []);
});

test("S4) 마스킹을 확인할 수 없으면(예전 Apps Script 등) 신규 등록을 막고 아무것도 쓰지 않음", TODO, async () => {
  const env = setup({ files: ["common", "save-handler", "list-handler"] }); // 마스킹 확인 기능이 없는 예전 코드라고 가정
  const before = JSON.stringify(env.ss.month().rows);
  const r = await register(report(A.name, A.ctn));
  assert.equal(r.results?.[0]?.ok ?? r.ok, false);
  assert.equal(JSON.stringify(env.ss.month().rows), before);
});

test("S5) 기존 판매(장표에 원본): 조회 응답에는 마스킹 값만, 수정·검수완료·삭제는 그대로 됨, 원본 칸은 바뀌지 않음", TODO, async () => {
  const { ss } = setup();
  legacyRow(ss, 9, A); legacyRow(ss, 10, B);
  responses.length = 0;
  const sales = await list();
  assert.deepEqual(findOriginals(jsonTexts(responses), [A, B]), []);
  const a = byName(sales, "가나*");
  assert.equal((await markDone(a, "inspected")).ok, true);
  assert.equal((await edit(byName(await list(), "가나*"), { customerBenefit: "60000" })).ok, true);
  assert.deepEqual([ss.month().value(9, L("D")), ss.month().value(9, L("E"))], [A.name, A.ctn]); // 원본 장표 그대로
  assert.equal((await deleteSale(byName(await list(), "라마*"))).ok, true);
});

test("S6) 기존 판매: 마스킹하면 같아지는 다른 판매가 있어도 행·No.·개통일까지 맞는 1건에만 적용, 후보가 여러 건이면 거부", TODO, async () => {
  const { ss } = setup();
  legacyRow(ss, 9, TWINS[0]); legacyRow(ss, 10, TWINS[1]); // 같은 날, 마스킹하면 이름·번호가 같아짐
  const [t0, t1] = await list();
  assert.equal(t0.customer, t1.customer);
  assert.equal((await markDone(t0, "inspected")).ok, true);
  assert.deepEqual([ss.month().value(9, L("G")), ss.month().value(10, L("G"))], ["O", "X"]);
  // 참고내용 연결: 두 판매의 키가 같아지므로 어느 쪽에도 붙이지 않고 수정 거부
  const r = await edit(t1, {}, { usedPhone: "x" } as Record<string, string>);
  assert.equal(r.ok, false);
});

test("S7) 신규 판매 ID: B열 메모로 붙고 조회에 함께 오며, 정렬로 행이 바뀌어도 판매를 따라감", TODO, async () => {
  const { ss } = setup();
  await register(report(A.name, A.ctn, { date: "10.07" }));
  const a = (await list())[0] as Record<string, unknown> & { row: number };
  assert.match(String(a.saleId), /\S{8,}/);
  assert.match(ss.month().cell(a.row, 2).note, new RegExp(String(a.saleId)));
  await register(report(B.name, B.ctn, { date: "10.03" }));
  const moved = (await list()).find((s) => (s as Record<string, unknown>).saleId === a.saleId)!;
  assert.equal(moved.row, a.row + 1);
  assert.match(ss.month().cell(moved.row, 2).note, new RegExp(String(a.saleId)));
  assert.doesNotMatch(ss.month().cell(a.row, 2).note, new RegExp(String(a.saleId)));
});

test("S8) 판매 ID: 빈 자리에 남은 예전 B열 메모를 새 판매가 물려받지 않고, 삭제하면 그 판매 ID 메모도 지움", TODO, async () => {
  const { ss } = setup();
  ss.month().cell(9, 2).note = "웹앱 판매ID: OLD-STALE-0001";
  await register(report(A.name, A.ctn));
  assert.doesNotMatch(ss.month().cell(9, 2).note, /OLD-STALE/);
  const a = (await list())[0];
  assert.equal((await deleteSale(a)).ok, true);
  assert.doesNotMatch(ss.month().cell(a.row, 2).note, /판매ID/);
});

test("S9) 판매 ID 중복(행 복사): 수정·삭제·참고내용 연결을 모두 거부", TODO, async () => {
  const { ss } = setup();
  await register(report(A.name, A.ctn, { extra: "중고폰&현물 판매 : 메모\n" }));
  const a = (await list())[0];
  const m = ss.month();
  for (let c = 1; c <= 38; c++) { const s = m.cell(a.row, c); const d = m.cell(a.row + 1, c); d.value = c === 2 ? 2 : s.value; d.formula = s.formula.replace(new RegExp(String(a.row), "g"), String(a.row + 1)); d.note = s.note; }
  const sales = await list();
  assert.ok(sales.every((s) => !s.notes?.usedPhone));
  const snap = JSON.stringify(m.rows);
  assert.equal((await edit(sales[0], { customerBenefit: "1" })).ok, false);
  assert.equal((await deleteSale(sales[1])).ok, false);
  assert.equal(JSON.stringify(m.rows), snap);
});

test("S10) 판매 ID 분실(메모 삭제): 그 신규 판매의 수정·삭제·참고내용 연결을 거부 (다른 판매에 붙지 않음)", TODO, async () => {
  const { ss } = setup();
  await register(report(A.name, A.ctn, { extra: "중고폰&현물 판매 : 메모\n" }));
  const a = (await list())[0];
  ss.month().cell(a.row, 2).note = "";
  const s = (await list())[0];
  assert.equal(s.notes?.usedPhone, undefined);
  const snap = JSON.stringify(ss.month().rows);
  assert.equal((await edit(s, { customerBenefit: "1" })).ok, false);
  assert.equal((await deleteSale(s)).ok, false);
  assert.equal(JSON.stringify(ss.month().rows), snap);
});

test("S11) 마스킹 충돌: 같은 날 마스킹 값이 같은 두 신규 판매도 참고내용·보완 요청이 섞이거나 덮어써지지 않음", TODO, async () => {
  setup();
  await register(report(TWINS[0].name, TWINS[0].ctn, { extra: "중고폰&현물 판매 : 첫째\n" }), report(TWINS[1].name, TWINS[1].ctn, { extra: "중고폰&현물 판매 : 둘째\n" }));
  const [x, y] = await list();
  assert.equal(x.customer, y.customer);
  assert.deepEqual([x.notes?.usedPhone, y.notes?.usedPhone].sort(), ["둘째", "첫째"]);
  assert.equal((await review(x, "save", "x만 보완")).ok, true);
  const [x2, y2] = await list();
  assert.deepEqual([x2.review?.active?.content ?? null, y2.review?.active?.content ?? null], ["x만 보완", null]);
});

test("S12) 자유 입력 메모 속 전화번호도 마스킹 (고객약속사항·참고 메모·보완 요청)", TODO, async () => {
  const { ss } = setup();
  await register(report(C.name, C.ctn, { extra: `중고폰&현물 판매 : x\nㄴ어디에 : 보호자 ${D.ctn} 연락\n고객약속사항 : ${D.ctn} 로 연락\n` }));
  const c = (await list())[0];
  await review(c, "save", `보호자 번호 ${D.ctn}`);
  assert.deepEqual(findOriginals(sheetTexts(ss), [{ name: "\u0000", ctn: D.ctn }]), []);
});

test("S13) 카드실적 카톡 안내·보완 요청 전달문은 마스킹 값만", TODO, async () => {
  setup();
  await register(report(A.name, A.ctn, { extra: "제카 : 우리\n" }));
  const a = (await list())[0];
  assert.deepEqual(findOriginals([cardPendingMessage(a), reviewMessage(a, "x")], [A]), []);
  assert.equal((await cardCheck(a)).ok, true);
});

test("S14) 오류 안내 문구에도 원본 번호를 되풀이하지 않음", TODO, async () => {
  const r = await (async () => { setup(); return register(report(A.name, "010-0000-11")); })();
  assert.deepEqual(findOriginals([JSON.stringify(r)], [{ name: "\u0000", ctn: "010-0000-11" }]), []);
});

void makeGas; void target;
