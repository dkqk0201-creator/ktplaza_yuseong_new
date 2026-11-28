/*
 * 충청관리 고객 목록 부가서비스 검수 + 카톡용 복사 문구 (2026-11-29) — 가짜 시트만, 읽기 전용 기능.
 * 부가 = AI열(필L/필S). 입력됨/미입력/확인 필요 판정, 문구에 CTN 없음, 다른 고객 정보가 섞이지 않음,
 * 충청 집계 금액·장표는 그대로.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { setup, register, report, list, byName } from "../harness/web.ts";
import { PEOPLE } from "../harness/fake-people.ts";
import { colNum as L } from "../harness/formula.ts";
import { buildSpotReport } from "@/lib/spot";
import { checkAddon, addonMessage, buildAddonOverview } from "@/lib/spot-addon";
import { calculateBudget } from "@/lib/budget";

test("1) 판정: 필L·필S=입력됨(명칭), 빈칸·X·-=미입력, 그 외·읽지 못함=확인 필요", () => {
  const e = (v: unknown) => { const c = checkAddon(v); return [c.state, c.names.join(",")]; };
  assert.deepEqual(e("필L"), ["entered", "필L"]);
  assert.deepEqual(e("필S"), ["entered", "필S"]);
  assert.deepEqual(e(" 필l "), ["entered", "필L"]);
  assert.deepEqual(e("필L/필S"), ["entered", "필L,필S"]);
  assert.deepEqual(e("필S, 필S"), ["entered", "필S"]);
  assert.deepEqual(e(""), ["missing", ""]);
  assert.deepEqual(e("X"), ["missing", ""]);
  assert.deepEqual(e("x"), ["missing", ""]);
  assert.deepEqual(e("-"), ["missing", ""]);
  assert.deepEqual(e(" "), ["missing", ""]);
  assert.deepEqual(e("필L 예정"), ["unclear", ""]);
  assert.deepEqual(e("O"), ["unclear", ""]);
  assert.deepEqual(e("없음"), ["unclear", ""], "모르는 표현은 미입력으로 단정하지 않음");
  assert.deepEqual(e(undefined), ["unclear", ""]);
  assert.deepEqual(e(null), ["unclear", ""]);
  assert.deepEqual(e(3), ["unclear", ""]);
  assert.equal(checkAddon("메모 있음").raw, "메모 있음");
});

const sale = { activatedAt: "2026-11-03", customer: "가짜고객", ctn: "01000001234", staff: "가짜직원" };

test("2) 카톡 문구: 판매 No. 없이 CTN, '넣어야 해', 확인 요청 문구, 없는 값은 지어내지 않음", () => {
  assert.equal(
    addonMessage(sale, "missing"),
    "개통일: 2026.11.03\n고객명: 가짜고객\nCTN: 010-0000-1234\n담당 직원: 가짜직원\n\n이 고객은 충청예산(스팟)이 걸려 있으니까 부가서비스 넣어야 해. 다 넣고 알려줘.",
  );
  assert.equal(
    addonMessage(sale, "unclear"),
    "개통일: 2026.11.03\n고객명: 가짜고객\nCTN: 010-0000-1234\n담당 직원: 가짜직원\n\n이 고객은 충청예산(스팟)이 적용되어 있어요. 부가서비스 등록 여부를 확인하고 알려줘.",
  );
  assert.equal(addonMessage(sale, "entered"), null);
  assert.ok(!/판매 No/.test(addonMessage(sale, "missing")!));
  const blank = addonMessage({ ...sale, staff: " ", ctn: "" }, "missing")!;
  assert.match(blank, /담당 직원: 장표 미기재/);
  assert.match(blank, /CTN: 장표 미기재/);
});

test("3) 실제 흐름(가짜 장표): 충청 고객 목록에 No.·직원·부가가 그 판매 것으로 붙고, CTN 은 문구에 없음, 집계 금액 불변", async () => {
  const { ss } = setup();
  const [A, B, C, D] = PEOPLE;
  await register(report(A.name, A.ctn, { date: "10.03" }), report(B.name, B.ctn, { date: "10.04" }), report(C.name, C.ctn, { date: "10.05" }), report(D.name, D.ctn, { date: "10.06" }));
  let sales = await list();
  const notes: [string, string, string][] = [[A.name, "스팟1 3만", "필L"], [B.name, "스팟1 2만", "X"], [C.name, "스팟1 1만", ""], [D.name, "스팟2 5만", "필 메모"]];
  for (const [name, note, addon] of notes) {
    const s = byName(sales, name);
    ss.month().cell(s.row, L("O")).note = note;
    ss.month().cell(s.row, L("AI")).formula = "";
    ss.month().cell(s.row, L("AI")).value = addon;
  }
  const sheetBefore = JSON.stringify(ss.month().rows);
  sales = await list();
  const rep = buildSpotReport(sales, "스팟");
  const s1 = rep.spots.find((s) => s.spot === 1)!;
  assert.deepEqual([s1.count, s1.amount], [3, 60000]);
  assert.deepEqual([rep.spots.find((s) => s.spot === 2)!.amount], [50000]);
  const states = s1.customers.map((c) => [c.customer, checkAddon(c.addon).state]);
  assert.deepEqual(states, [[A.name, "entered"], [B.name, "missing"], [C.name, "missing"]]);
  assert.equal(checkAddon(rep.spots.find((s) => s.spot === 2)!.customers[0].addon).state, "unclear");
  for (const c of [...s1.customers, ...rep.spots.find((s) => s.spot === 2)!.customers]) {
    const real = byName(sales, c.customer);
    assert.equal(c.no, real.no, "No. 는 그 판매의 B열");
    assert.equal(c.staff, real.staff, "직원은 그 판매의 M열");
    assert.equal(c.row, real.row);
    const st = checkAddon(c.addon).state;
    const msg = addonMessage({ activatedAt: c.activatedAt, customer: c.customer, ctn: c.ctn, staff: c.staff ?? "" }, st);
    if (st === "entered") { assert.equal(msg, null); continue; }
    assert.ok(msg!.includes(`고객명: ${c.customer}`));
    assert.ok(!msg!.includes("판매 No"), "판매 No. 없음");
    assert.equal(msg!.match(/CTN: (.+)/)![1].replace(/\D/g, ""), real.ctn.replace(/\D/g, ""), "그 판매의 CTN");
    assert.equal(c.plan, real.plan);
    assert.equal(c.model, real.model);
    for (const other of PEOPLE.slice(0, 4).filter((p) => p.name !== c.customer)) {
      assert.ok(!msg!.includes(other.name), "다른 고객 이름 없음");
      assert.ok(!msg!.replace(/\D/g, "").includes(other.ctn.replace(/\D/g, "")), "다른 고객 CTN 없음");
    }
  }
  // 판정·문구 생성은 장표를 바꾸지 않음
  buildSpotReport(await list(), "스팟");
  assert.equal(JSON.stringify(ss.month().rows), sheetBefore);
});

test("4) 11월(충청) 장표도 같은 방식, 10월 스팟 구분 유지", async () => {
  const { ss } = setup({ months: ["10월", "11월"] });
  const [A] = PEOPLE;
  await register(report(A.name, A.ctn, { date: "10.03" }));
  const s = byName(await list(), A.name);
  ss.month().cell(s.row, L("O")).note = "충청6 2만";
  ss.month().cell(s.row, L("AI")).value = "필S";
  const rep = buildSpotReport(await list(), "스팟");
  assert.equal(rep.spots[0].label, "스팟6");
  const rep2 = buildSpotReport(await list(), "충청");
  assert.equal(rep2.spots[0].label, "충청6");
  assert.deepEqual(checkAddon(rep2.spots[0].customers[0].addon).names, ["필S"]);
});

test("5) 부가 미입력 통합 조회: 번호별 목록과 일치, 같은 판매 1번(번호 모두), 충청 없는 판매 제외, 금액=O열, 확인 필요 따로, 예산 불변", async () => {
  const { ss } = setup();
  const [A, B, C, D, E] = PEOPLE;
  await register(
    report(A.name, A.ctn, { date: "10.03" }), report(B.name, B.ctn, { date: "10.04" }), report(C.name, C.ctn, { date: "10.05" }),
    report(D.name, D.ctn, { date: "10.06" }), report(E.name, E.ctn, { date: "10.07" }),
  );
  let sales = await list();
  // A: 두 번호(1·2), 미입력 / B: 번호 1, 입력됨 / C: 번호 2, 미입력 / D: 메모 없음(일반 판매), 미입력 / E: 번호 3, 확인 필요
  const set: [string, string, string, number | null][] = [
    [A.name, "스팟1 3만\n스팟2 2만", "X", 50000], [B.name, "스팟1 1만", "필L", 10000], [C.name, "스팟2 4만", "", 40000],
    [D.name, "", "X", null], [E.name, "스팟3 2만", "필 예정", 20000],
  ];
  for (const [name, note, addon, o] of set) {
    const s = byName(sales, name);
    if (note) ss.month().cell(s.row, L("O")).note = note;
    ss.month().cell(s.row, L("AI")).formula = "";
    ss.month().cell(s.row, L("AI")).value = addon;
    if (o !== null) { ss.month().cell(s.row, L("O")).formula = ""; ss.month().cell(s.row, L("O")).value = o; }
  }
  sales = await list();
  const budgetBefore = JSON.stringify(calculateBudget(sales));
  const sheetBefore = JSON.stringify(ss.month().rows);
  const rep = buildSpotReport(sales, "스팟");
  const ov = buildAddonOverview(rep.spots, new Map(rep.checks.map((c) => [c.sale.row, c.oAmount])));
  // 번호별로 하나씩 본 미입력 판매(행) 합집합과 같음
  const perNumber = new Set(rep.spots.flatMap((s) => s.customers.filter((c) => checkAddon(c.addon).state === "missing").map((c) => c.row)));
  assert.deepEqual(ov.missing.map((i) => i.row).sort(), [...perNumber].sort());
  assert.deepEqual(ov.missing.map((i) => i.customer), [A.name, C.name], "D(충청 메모 없음) 제외, A 는 한 번만");
  const a = ov.missing.find((i) => i.customer === A.name)!;
  assert.deepEqual(a.spots.map((x) => [x.label, x.amount]), [["스팟1", 30000], ["스팟2", 20000]]);
  assert.equal(a.oAmount, 50000);
  assert.equal(ov.missingAmount, 90000, "미입력 판매 O열 합계 (A 5만 + C 4만, 중복 없이)");
  assert.deepEqual(ov.unclear.map((i) => i.customer), [E.name]);
  assert.equal(ov.unclearAmount, 20000);
  assert.equal(ov.enteredCount, 1);
  for (const i of [...ov.missing, ...ov.unclear]) {
    const real = byName(sales, i.customer);
    assert.deepEqual([i.row, i.ctn, i.plan, i.model, i.staff], [real.row, real.ctn, real.plan, real.model, real.staff], "같은 판매의 값");
  }
  // 조회만: 장표·예산 계산값 그대로
  assert.equal(JSON.stringify(ss.month().rows), sheetBefore);
  assert.equal(JSON.stringify(calculateBudget(await list())), budgetBefore);
  // 0건
  const none = buildAddonOverview([], new Map());
  assert.deepEqual([none.missing.length, none.unclear.length, none.missingAmount], [0, 0, 0]);
});

test("6) 요금제·모델명이 비면 빈 값 그대로 (화면은 '미입력' 표시, 추정 없음)", async () => {
  const { ss } = setup();
  const [A] = PEOPLE;
  await register(report(A.name, A.ctn));
  const s = byName(await list(), A.name);
  ss.month().cell(s.row, L("O")).note = "스팟5 1만";
  for (const col of ["J", "K"]) { ss.month().cell(s.row, L(col)).formula = ""; ss.month().cell(s.row, L(col)).value = ""; }
  const c = buildSpotReport(await list(), "스팟").spots[0].customers[0];
  assert.deepEqual([c.plan, c.model], ["", ""]);
});
