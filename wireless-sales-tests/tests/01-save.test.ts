/* 저장 (간편등록 → 웹앱 서버 → Apps Script save-handler → 월 시트) — 현재 동작 회귀 테스트 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { setup, register, report, list, byName } from "../harness/web.ts";
import { PEOPLE } from "../harness/fake-people.ts";
import { colNum as L } from "../harness/formula.ts";
import { normalizeQuick, parseQuickReports } from "@/lib/quick-report";
import { STAFF_NAMES } from "../harness/staff.ts";

const [A, B, C, D] = PEOPLE;

test("1) 등록: 고객·CTN·직원·개통구분이 제 열에, N·U·AB·AC 행 수식, 8행 합계", async () => {
  const { ss } = setup();
  const r = await register(report(A.name, A.ctn, { date: "10.05" }));
  assert.equal(r.results[0].ok, true, JSON.stringify(r.results[0]));
  const row = r.results[0].row;
  const m = ss.month();
  assert.equal(m.value(row, L("D")), A.name);
  assert.equal(m.value(row, L("E")), A.ctn);
  assert.equal(m.value(row, L("M")), STAFF_NAMES[0]);
  assert.equal(m.value(row, L("I")), "기기변경");
  assert.equal(m.value(row, L("T")), 50000);
  assert.equal(m.peek(row, L("N"))!.formula, `=SUM(O${row}:T${row})`);
  assert.equal(m.peek(row, L("U"))!.formula, `=SUM(V${row}:Y${row})`);
  assert.equal(m.peek(row, L("AB"))!.formula, `=N(Z${row})-N(AA${row})`);
  assert.equal(m.peek(row, L("AC"))!.formula, `=N(N${row})-N(U${row})+N(AB${row})`);
  assert.equal(m.value(8, L("N")), 50000);
  const [s] = await list();
  assert.deepEqual([s.activatedAt, s.customer, s.ctn, s.no], ["2026-10-05", A.name, A.ctn, "1"]);
});

test("2) 여러 건: 개통일 순으로 정렬해 저장, No. 1부터 다시 매김", async () => {
  const { ss } = setup();
  await register(report(A.name, A.ctn, { date: "10.07" }));
  await register(report(B.name, B.ctn, { date: "10.03" }), report(C.name, C.ctn, { date: "10.05" }));
  const sales = await list();
  assert.deepEqual(sales.map((s) => [s.row, s.activatedAt, s.customer, s.no]), [
    [9, "2026-10-03", B.name, "1"],
    [10, "2026-10-05", C.name, "2"],
    [11, "2026-10-07", A.name, "3"],
  ]);
  // 행 수식은 옮겨진 행 번호 기준
  assert.equal(ss.month().peek(11, L("N"))!.formula, "=SUM(O11:T11)");
});

test("3) UMNP 는 No. 빈칸, 다음 일반 판매는 이어서 번호", async () => {
  setup();
  await register(report(A.name, A.ctn, { date: "10.03" }), report(B.name, B.ctn, { date: "10.04", category: "UMNP" }), report(C.name, C.ctn, { date: "10.05" }));
  const sales = await list();
  assert.deepEqual(sales.map((s) => [s.customer, s.no]), [[A.name, "1"], [B.name, ""], [C.name, "2"]]);
});

test("4) 입력 오류(직원명·CTN 형식·다른 달 개통일)는 장표에 쓰지 않음, 같이 보낸 정상 건만 저장", async () => {
  const { ss } = setup();
  const before = JSON.stringify(ss.month().rows);
  const r = await register(
    report(A.name, A.ctn, { staff: "없는직원" }),
    report(B.name, "010-12", {}),
    report(C.name, C.ctn, { date: "09.30" }),
  );
  assert.deepEqual(r.results.map((x: { ok: boolean }) => x.ok), [false, false, false]);
  assert.equal(JSON.stringify(ss.month().rows), before);
  const r2 = await register(report(A.name, A.ctn, { staff: "없는직원" }), report(D.name, D.ctn));
  assert.deepEqual(r2.results.map((x: { ok: boolean }) => x.ok), [false, true]);
  assert.deepEqual((await list()).map((s) => s.customer), [D.name]);
});

test("5) 중복 검사 키 = 개통일|CTN 숫자 (화면이 이번 달 장표와 비교)", () => {
  const n = normalizeQuick(parseQuickReports(report(A.name, A.ctn, { date: "10.05" }))[0].fields, { today: "2026-10-13", staffNames: STAFF_NAMES });
  assert.equal(n.duplicateKey, `2026-10-05|${A.ctn.replace(/\D/g, "")}`);
});

test("6) 참고내용(장표에 없는 항목)은 웹앱참고 시트에 판매 키(월|개통일|CTN 숫자|고객명)로 저장", async () => {
  const { ss } = setup();
  await register(report(A.name, A.ctn, { date: "10.05", extra: "중고폰&현물 판매 : x\n" }));
  const notesSheet = ss.getSheetByName("웹앱참고")!;
  assert.ok(notesSheet, "웹앱참고 시트 자동 생성");
  assert.equal(notesSheet.hidden, true);
  const key = notesSheet.value(2, 1);
  assert.equal(key, `10월|2026-10-05|${A.ctn.replace(/\D/g, "")}|${A.name}`);
  const s = byName(await list(), A.name);
  assert.equal(s.notes?.usedPhone, "x");
});
