/*
 * 판매 ID·마스킹 충돌 집중 테스트 (가짜 데이터만).
 *   정렬·삭제·재등록·중복·분실, 오래된 화면(행이 밀린 뒤)의 요청, 기존 판매의 고객명 수정 시 ID 부여·키 이동,
 *   마스킹 값이 같은 두 판매에서 다른 판매를 고치거나 지우거나 참고내용을 덮어쓰지 않는지,
 *   Apps Script 일부 파일만 새 버전일 때 신규 등록 차단.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { setup, register, report, list, byName, edit, deleteSale, markDone, review, cardCheck, responses, target } from "../harness/web.ts";
import { PEOPLE, TWINS, tMaskName as MN, tMaskPhone as MP } from "../harness/fake-people.ts";
import { findOriginals, sheetTexts, jsonTexts } from "../harness/privacy.ts";
import { DEFAULT_FILES } from "../harness/gas.ts";
import { colNum as L } from "../harness/formula.ts";
import { POST as updatePOST } from "@/app/api/sales/update/route";
import type { SheetSale } from "@/lib/sheet-record";

const [A, B, C, D, E] = PEOPLE;
const rawUpdate = (body: unknown) =>
  updatePOST(new Request("http://t", { method: "POST", body: JSON.stringify(body) })).then(async (r) => ({ status: r.status, ...(await r.json()) }));
const ids = (sales: SheetSale[]) => Object.fromEntries(sales.map((s) => [s.customer, s.saleId]));

function legacyRow(ss: ReturnType<typeof setup>["ss"], row: number, p: { name: string; ctn: string }, date = "2026-10-02") {
  const m = ss.month();
  const set = (c: string, v: unknown) => { m.cell(row, L(c)).value = v; };
  set("C", date); set("D", p.name); set("E", p.ctn); set("I", "기기변경"); set("M", "김수현"); set("T", 50000); set("G", "X"); set("H", "X");
  m.cell(row, L("N")).formula = `=SUM(O${row}:T${row})`; m.cell(row, L("U")).formula = `=SUM(V${row}:Y${row})`;
}

test("1) 정렬: 여러 번 나눠 등록해 행이 계속 밀려도 판매마다 ID 가 그대로 따라가고, ID 로 고치면 그 판매만 바뀜", async () => {
  const { ss } = setup();
  await register(report(A.name, A.ctn, { date: "10.09" }));
  const first = ids(await list());
  await register(report(B.name, B.ctn, { date: "10.02" }), report(C.name, C.ctn, { date: "10.08" }));
  const second = ids(await list());
  await register(report(D.name, D.ctn, { date: "10.01" }));
  const sales = await list();
  assert.deepEqual(sales.map((s) => s.customer), [MN(D.name), MN(B.name), MN(C.name), MN(A.name)]);
  assert.equal(ids(sales)[MN(A.name)], first[MN(A.name)]);
  assert.equal(ids(sales)[MN(B.name)], second[MN(B.name)]);
  assert.equal(new Set(sales.map((s) => s.saleId)).size, 4);
  // 각 행의 B열 메모 = 그 판매의 ID
  for (const s of sales) assert.match(ss.month().cell(s.row, 2).note, new RegExp(String(s.saleId)));
  const before = JSON.stringify(sales.filter((s) => s.customer !== MN(C.name)).map((s) => ss.month().rows[s.row - 1]));
  assert.equal((await edit(byName(sales, C.name), { customerBenefit: "77000" })).ok, true);
  const after = await list();
  assert.equal(byName(after, C.name).customerBenefit, 77000);
  assert.equal(JSON.stringify(after.filter((s) => s.customer !== MN(C.name)).map((s) => ss.month().rows[s.row - 1])), before);
});

test("2) 오래된 화면: 정렬로 행이 밀린 뒤 예전 행 번호로 보낸 수정·삭제·완료·보완 요청은 그 자리의 다른 판매를 건드리지 않음", async () => {
  const { ss } = setup();
  await register(report(A.name, A.ctn, { date: "10.07", extra: "중고폰&현물 판매 : A메모\n" }));
  const stale = (await list())[0]; // A 가 9행에 있을 때 연 화면
  await register(report(B.name, B.ctn, { date: "10.03", extra: "중고폰&현물 판매 : B메모\n" })); // B 가 9행, A 는 10행으로
  const snap = JSON.stringify(ss.month().rows);
  for (const r of [await edit(stale, { customerBenefit: "1" }), await deleteSale(stale), await markDone(stale, "inspected"), await review(stale, "save", "x"), await edit(stale, {}, { usedPhone: "덮어쓰기" } as Record<string, string>)]) {
    assert.equal(r.ok, false, r.message);
  }
  assert.equal(JSON.stringify(ss.month().rows), snap);
  const sales = await list();
  assert.deepEqual(sales.map((s) => [s.customer, s.notes?.usedPhone, s.review ?? null]), [[MN(B.name), "B메모", null], [MN(A.name), "A메모", null]]);
});

test("3) 삭제 후 같은 고객·같은 날로 다시 등록: 새 ID, 예전 참고내용·보완 기록이 붙지 않음", async () => {
  const { ss } = setup();
  await register(report(A.name, A.ctn, { extra: "중고폰&현물 판매 : 예전메모\n" }));
  let a = (await list())[0];
  await review(a, "save", "예전 보완");
  a = (await list())[0];
  assert.equal((await deleteSale(a)).ok, true);
  assert.equal(ss.month().cell(a.row, 2).note, "");
  await register(report(A.name, A.ctn));
  const again = (await list())[0];
  assert.equal(again.row, a.row);
  assert.notEqual(again.saleId, a.saleId);
  assert.equal(again.notes, undefined);
  assert.equal(again.review, undefined);
});

test("4) 판매 ID 중복(B열 메모까지 복사): 조회에 중복 표시, 수정·삭제·검수/수납/카드 완료·보완 요청·참고내용 모두 거부", async () => {
  const { ss } = setup();
  await register(report(A.name, A.ctn, { extra: "중고폰&현물 판매 : 메모\n제카 : 우리\n" }));
  const a = (await list())[0];
  const m = ss.month();
  for (let c = 1; c <= 38; c++) { const s = m.cell(a.row, c); const d = m.cell(a.row + 1, c); d.value = c === 2 ? 2 : s.value; d.formula = s.formula.replace(new RegExp(String(a.row), "g"), String(a.row + 1)); d.note = s.note; }
  const sales = await list();
  assert.deepEqual(sales.map((s) => s.saleIdProblem), ["duplicate", "duplicate"]);
  assert.ok(sales.every((s) => !s.notes?.usedPhone));
  const snap = JSON.stringify(m.rows);
  for (const s of sales) {
    for (const r of [await edit(s, { customerBenefit: "1" }), await deleteSale(s), await markDone(s, "inspected"), await markDone(s, "paid"), await cardCheck(s), await review(s, "save", "x"), await edit(s, {}, { usedPhone: "y" } as Record<string, string>)]) {
      assert.equal(r.ok, false, r.message);
    }
  }
  assert.equal(JSON.stringify(m.rows), snap);
  assert.equal(ss.getSheetByName("검수보완"), null);
});

test("5) 판매 ID 분실: 마스킹된 판매인데 B열 메모가 없으면 조회에 분실 표시, 모든 변경 거부 (같은 날 다른 판매에 붙지 않음)", async () => {
  const { ss } = setup();
  await register(report(A.name, A.ctn, { extra: "중고폰&현물 판매 : A메모\n" }), report(B.name, B.ctn, { extra: "중고폰&현물 판매 : B메모\n" }));
  const a = byName(await list(), A.name);
  ss.month().cell(a.row, 2).note = "누가 메모를 지우고 다른 글을 씀";
  const sales = await list();
  const lost = byName(sales, A.name);
  assert.equal(lost.saleIdProblem, "missing");
  assert.equal(lost.saleId, undefined);
  assert.equal(lost.notes, undefined);
  const snap = JSON.stringify(ss.month().rows);
  for (const r of [await edit(lost, { customerBenefit: "1" }), await deleteSale(lost), await markDone(lost, "inspected"), await review(lost, "save", "x")]) {
    assert.equal(r.ok, false, r.message);
  }
  // 잃어버린 판매의 ID 를 아는 사람이 보내도 거부
  assert.equal((await edit({ ...lost, saleId: a.saleId }, { customerBenefit: "1" })).ok, false);
  assert.equal(JSON.stringify(ss.month().rows), snap);
  assert.equal(byName(await list(), B.name).notes?.usedPhone, "B메모");
});

test("6) 마스킹 충돌(신규 판매 둘, 같은 날·같은 마스킹 값): 한쪽 수정·삭제가 다른 쪽 칸·참고내용·보완 요청을 건드리지 않음", async () => {
  const { ss } = setup();
  const [X, Y] = TWINS;
  await register(report(X.name, X.ctn, { extra: "중고폰&현물 판매 : X메모\n" }), report(Y.name, Y.ctn, { extra: "중고폰&현물 판매 : Y메모\n" }));
  let [x, y] = await list();
  assert.equal(x.customer, y.customer);
  assert.equal(x.ctn, y.ctn);
  await review(y, "save", "Y 보완");
  [x, y] = await list();
  const yRow = JSON.stringify(ss.month().rows[y.row - 1]);
  // x 를 고치려는데 화면이 헷갈려 y 의 ID 를 붙여 보낸 경우 → 거부
  assert.equal((await edit({ ...x, saleId: y.saleId }, { customerBenefit: "1" })).ok, false);
  assert.equal((await edit(x, { customerBenefit: "1" }, { usedPhone: "X새메모" } as Record<string, string>)).ok, true);
  assert.equal(JSON.stringify(ss.month().rows[y.row - 1]), yRow);
  [x, y] = await list();
  assert.deepEqual([x.notes?.usedPhone, y.notes?.usedPhone], ["X새메모", "Y메모"]);
  assert.equal((await deleteSale(x)).ok, true);
  const [left] = await list();
  assert.equal(left.saleId, y.saleId);
  assert.equal(left.notes?.usedPhone, "Y메모");
  assert.equal(left.review?.active?.content, "Y 보완");
});

test("7) 기존 판매 고객명 수정: 마스킹 값으로 바뀌면서 판매 ID 가 생기고, 참고내용·보완 기록이 ID 키로 옮겨지며 그 원본은 보조 시트에서도 사라짐", async () => {
  const { ss, gas } = setup();
  legacyRow(ss, 9, A);
  legacyRow(ss, 10, E, "2026-10-03");
  // 수정 전 코드로 저장돼 있던 참고내용 (원본 키·원본 이름) 흉내
  const tz = "Asia/Seoul";
  const values = ss.month().rowValues(9);
  const legacyKey = gas.fn("wsNoteKey_")("10월", values, tz) as string;
  assert.ok(legacyKey.includes(A.name), "기존 키는 원본 이름 포함");
  gas.fn("wsWriteNote_")(ss, legacyKey, { sheet: "10월", date: "2026-10-02", customer: A.name, ctn: A.ctn }, { usedPhone: `예전메모 ${A.ctn}` });
  let a = byName(await list(), A.name);
  assert.equal(a.saleId, undefined);
  assert.equal(a.notes?.usedPhone, `예전메모 ${MP(A.ctn)}`, "기존 참고내용도 응답에는 마스킹");
  assert.equal((await review(a, "save", "기존 판매 보완")).ok, true);
  a = byName(await list(), A.name);
  const r = await edit(a, { customer: C.name });
  assert.equal(r.ok, true, r.message);
  assert.match(String(r.saleId), /^S-/);
  const after = byName(await list(), C.name);
  assert.equal(after.saleId, r.saleId);
  assert.equal(after.notes?.usedPhone, `예전메모 ${MP(A.ctn)}`);
  assert.equal(after.review?.active?.content, "기존 판매 보완");
  assert.deepEqual([ss.month().value(9, L("D")), ss.month().value(9, L("E"))], [MN(C.name), MP(A.ctn)]);
  assert.deepEqual(findOriginals(sheetTexts(ss, { only: ["웹앱참고", "검수보완", "10월"] }), [A]), []);
  // 다른 기존 판매(E)는 원본 그대로 (기존 장표는 고치지 않음)
  assert.deepEqual([ss.month().value(10, L("D")), ss.month().value(10, L("E"))], [E.name, E.ctn]);
});

test("8) 기존 판매: 화면에서 받은 마스킹 값이 다르면 거부 / 원본 이름·번호를 그대로 보내도 같은 판매로 확인됨", async () => {
  const { ss } = setup();
  legacyRow(ss, 9, A);
  const a = (await list())[0];
  const change = [{ key: "customerBenefit", before: "50000", after: "1" }];
  const snap = JSON.stringify(ss.month().rows);
  for (const bad of [{ customer: MN(B.name) }, { ctn: MP(B.ctn) }, { no: "3" }, { activatedAt: "2026-10-03" }, { saleId: "S-AAAAAAAAAAAAAAAAAAAA" }]) {
    const r = await rawUpdate({ target: { ...target(a), ...bad }, changes: change });
    assert.equal(r.ok, false, JSON.stringify(bad));
  }
  assert.equal(JSON.stringify(ss.month().rows), snap);
  const ok = await rawUpdate({ target: { ...target(a), customer: A.name, ctn: A.ctn }, changes: change });
  assert.equal(ok.ok, true, ok.message);
});

test("9) Apps Script 일부 파일만 새 버전이면(표시 없는 파일) 마스킹 확인 실패 → 신규 등록을 막고 아무것도 쓰지 않음", async () => {
  for (const missing of ["save-handler", "list-handler", "notes", "gobulbi", "inspection-review", "delete-handler"]) {
    const env = setup({ files: DEFAULT_FILES.filter((f) => f !== missing) });
    const before = JSON.stringify(env.ss.getSheets().map((s) => [s.name, s.rows]));
    const r = await register(report(A.name, A.ctn));
    assert.equal(r.results?.[0]?.ok, false, missing);
    assert.match(r.results[0].message, /마스킹/);
    assert.equal(JSON.stringify(env.ss.getSheets().map((s) => [s.name, s.rows])), before, missing);
    assert.deepEqual(env.gas.calls.map((c) => c.body.action), ["privacy-status"], missing);
  }
});

test("10) Apps Script 에 원본을 직접 보내도: 고객명·CTN·글 칸·참고내용 속 원본 이름과 번호가 모두 마스킹돼 저장", async () => {
  const { ss, gas } = setup();
  const row = Array(38).fill(null);
  row[0] = `${A.name} 고객 ${D.ctn} 로 연락`; row[2] = "2026-10-05"; row[3] = A.name; row[4] = A.ctn; row[8] = "기기변경"; row[12] = "김수현";
  const r = gas.doPost({ action: "save", rows: [row], notes: [{ usedPhone: `${A.name} 보호자 ${D.ctn.replace(/-/g, "")}` }] });
  assert.equal(r.ok, true, r.message);
  assert.equal(r.privacy, 1);
  assert.deepEqual(findOriginals(sheetTexts(ss), [A, { name: "\u0000", ctn: D.ctn }]), []);
  assert.equal(ss.month().value(9, 1), `${MN(A.name)} 고객 ${MP(D.ctn)} 로 연락`);
  const [s] = await list();
  assert.equal(s.notes?.usedPhone, `${MN(A.name)} 보호자 ${MP(D.ctn)}`);
});

test("11) 간편등록: 메모 속 원본 이름·번호 마스킹, 응답(저장 결과·조회)에 원본 없음", async () => {
  const { ss } = setup();
  responses.length = 0;
  const r = await register(report(A.name, A.ctn, { extra: `중고폰&현물 판매 : x\nㄴ어디에 : ${A.name}님 딸 ${D.ctn}\n고객약속사항 : ${A.name} 고객 ${D.ctn.replace(/-/g, " ")} 연락\n` }));
  assert.equal(r.results[0].ok, true, JSON.stringify(r.results[0]));
  const [s] = await list();
  assert.equal(s.notes?.usedPhoneWhere, `${MN(A.name)}님 딸 ${MP(D.ctn)}`);
  assert.equal(s.customerPromise, `${MN(A.name)} 고객 ${MP(D.ctn)} 연락`);
  assert.deepEqual(findOriginals([...sheetTexts(ss), ...jsonTexts(responses)], [A, { name: "\u0000", ctn: D.ctn }]), []);
});

/* ── 이중 방어: 웹앱 서버·Apps Script 가 각각 따로 마스킹하는지 (한쪽이 빠져도 다른 쪽이 지키지만, 각각 확인) ── */

test("12) [웹앱 서버 단독] 간편등록이 Apps Script 로 보내는 저장 요청에 원본 이름·번호가 없음", async () => {
  const { gas } = setup();
  await register(report(A.name, A.ctn, { extra: `중고폰&현물 판매 : x\nㄴ어디에 : ${A.name} ${D.ctn}\n` }));
  const sent = gas.calls.filter((c) => c.body.action === "save").map((c) => c.body);
  assert.equal(sent.length, 1);
  assert.deepEqual(findOriginals(jsonTexts(sent), [A, { name: "\u0000", ctn: D.ctn }]), []);
});

test("13) [Apps Script 단독] 판매 수정에 원본 고객명·CTN·글 속 번호를 직접 보내도 마스킹해서 씀", async () => {
  const { ss, gas } = setup();
  await register(report(A.name, A.ctn));
  const a = (await list())[0];
  const r = gas.doPost({ action: "sale-update", target: target(a), changes: [
    { col: 3, before: a.customer, value: C.name },
    { col: 4, before: a.ctn, value: C.ctn },
    { col: 0, before: "", value: `보호자 ${D.ctn}` },
  ] });
  assert.equal(r.ok, true, r.message);
  assert.deepEqual([ss.month().value(a.row, 4), ss.month().value(a.row, 5), ss.month().value(a.row, 1)], [MN(C.name), MP(C.ctn), `보호자 ${MP(D.ctn)}`]);
  assert.deepEqual(findOriginals([JSON.stringify(r)], [C, { name: "\u0000", ctn: D.ctn }]), []);
});

test("14) [Apps Script 단독] 조회 응답: 장표에 원본이 있는 기존 판매도 Apps Script 가 마스킹해서 보냄 (O열 메모·참고내용 포함)", async () => {
  const { ss, gas } = setup();
  legacyRow(ss, 9, A);
  ss.month().cell(9, L("O")).note = `스팟1 ${A.ctn}`;
  const values = ss.month().rowValues(9);
  const key = gas.fn("wsNoteKey_")("10월", values, "Asia/Seoul") as string;
  gas.fn("wsWriteNote_")(ss, key, { sheet: "10월", date: "2026-10-02", customer: A.name, ctn: A.ctn }, { usedPhone: `연락 ${A.ctn}` });
  const r = gas.doPost({ action: "list", sheet: "10월" });
  assert.equal(r.ok, true);
  assert.equal(r.rows.length, 1);
  assert.deepEqual(findOriginals([JSON.stringify(r)], [A]), []);
  assert.equal(r.rows[0].notes.usedPhone, `연락 ${MP(A.ctn)}`, "참고내용은 원래 키로 제대로 연결된 뒤 마스킹");
});

test("15) [Apps Script 단독] 참고내용 저장: 같은 연결 키가 2행이면 저장하지 않고 건너뜀 (덮어쓰기 방지 안전장치)", async () => {
  const { ss, gas } = setup();
  await register(report(A.name, A.ctn, { extra: "중고폰&현물 판매 : 원래메모\n" }));
  const a = (await list())[0];
  const m = ss.month();
  for (let c = 1; c <= 38; c++) { const s = m.cell(a.row, c); const d = m.cell(a.row + 1, c); d.value = c === 2 ? 2 : s.value; d.formula = s.formula; d.note = s.note; }
  const results = [{ ok: true, row: a.row }];
  const saved = gas.fn("wsSaveNotesForRows_")(ss, m, "Asia/Seoul", results, [{ usedPhone: "덮어쓰기" }]);
  assert.equal(saved, false);
  assert.equal((results[0] as { notesSkipped?: boolean }).notesSkipped, true);
  const note = ss.getSheetByName("웹앱참고")!.rows.slice(1).map((r) => String(r[5]?.value ?? "")).join();
  assert.match(note, /원래메모/);
  assert.doesNotMatch(note, /덮어쓰기/);
});

test("16) 고객 검색: 마스킹된 화면에서도 전체 이름·번호 일부·전체 번호로 찾음 (원본을 화면에 보내지 않고)", async () => {
  const { matchesSaleSearch } = await import("@/lib/sale-search");
  setup();
  await register(report(A.name, A.ctn), report(B.name, B.ctn));
  const sales = await list();
  const find = (q: string) => sales.filter((s) => matchesSaleSearch(s, q)).map((s) => s.customer);
  assert.deepEqual(find(A.name), [MN(A.name)]);
  assert.deepEqual(find(A.name.slice(0, 2)), [MN(A.name)]);
  assert.deepEqual(find(A.ctn), [MN(A.name)]);
  assert.deepEqual(find(A.ctn.slice(-4)), [MN(A.name)]);
  assert.deepEqual(find("9999"), []);
});
