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
import { checkAddon, addonMessage } from "@/lib/spot-addon";

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

const sale = { activatedAt: "2026-11-03", customer: "가짜고객", no: "12", staff: "가짜직원" };

test("2) 카톡 문구: 미입력/확인 필요 문구, 입력됨은 없음, 직원·No. 없으면 지어내지 않음", () => {
  assert.equal(
    addonMessage(sale, "missing"),
    "개통일: 2026.11.03\n고객명: 가짜고객\n판매 No.: 12\n담당 직원: 가짜직원\n\n이 고객은 충청예산(스팟)이 걸려 있으니까 부가서비스 넣어야 한다. 다 넣고 알려줘",
  );
  assert.equal(
    addonMessage(sale, "unclear"),
    "개통일: 2026.11.03\n고객명: 가짜고객\n판매 No.: 12\n담당 직원: 가짜직원\n\n이 고객은 충청예산(스팟)이 적용되어 있어요. 부가서비스 등록 여부를 확인하고 알려줘.",
  );
  assert.equal(addonMessage(sale, "entered"), null);
  const blank = addonMessage({ ...sale, staff: " ", no: "" }, "missing")!;
  assert.match(blank, /담당 직원: 장표 미기재/);
  assert.match(blank, /판매 No\.: 장표 미기재/);
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
    const msg = addonMessage({ activatedAt: c.activatedAt, customer: c.customer, no: c.no ?? "", staff: c.staff ?? "" }, st);
    if (st === "entered") { assert.equal(msg, null); continue; }
    assert.ok(msg!.includes(`고객명: ${c.customer}`));
    assert.ok(msg!.includes(`판매 No.: ${real.no}`));
    const digits = c.ctn.replace(/\D/g, "");
    assert.ok(!msg!.replace(/\D/g, "").includes(digits), "CTN 전체 번호 없음");
    assert.ok(!msg!.includes(digits.slice(-4)) || !msg!.includes(digits.slice(3, 7)), "CTN 조각도 연속으로 없음");
    for (const other of PEOPLE.slice(0, 4).filter((p) => p.name !== c.customer)) assert.ok(!msg!.includes(other.name), "다른 고객 이름 없음");
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
