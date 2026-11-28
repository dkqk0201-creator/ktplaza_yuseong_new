/*
 * AI 분석데이터 "기타예산" 탭 (analysis-apps-script/other-budget-tab.gs, 2026-11-28) — 가짜 시트만.
 * 탭 값이 웹앱 예산관리와 같은지 (장표기준 = 직원별예산 매장 행 계산, 기존 = − 고불비, 최종 = + 기타 순증감),
 * 원본(무선장표)에는 아무것도 쓰지 않는지, 고객 개인정보·메모가 들어가지 않는지.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { setup, register, report, list, authed } from "../harness/web.ts";
import { PEOPLE } from "../harness/fake-people.ts";
import { STAFF_NAMES } from "../harness/staff.ts";
import { WS_DIR } from "../harness/gas.ts";
import { FakeSpreadsheet } from "../harness/fake-spreadsheet.ts";
import { POST as oPOST } from "@/app/api/budget/other/route";
import { POST as gPOST } from "@/app/api/budget/gobulbi/route";
import { calculateBudget } from "@/lib/budget";
import { applyGobulbi } from "@/lib/gobulbi";
import { applyOtherBudget } from "@/lib/other-budget";
import vm from "node:vm";

const post = (h: (r: Request) => Promise<Response>, b: unknown) => h(authed("/api", { method: "POST", body: JSON.stringify(b) })).then((r) => r.json());

test("1) 기타예산 탭 = 웹앱 예산관리 계산, 원본 무변경, 개인정보·메모 없음", async () => {
  const { ss, gas } = setup({ months: ["9월", "10월"] });
  await register(
    report(PEOPLE[0].name, PEOPLE[0].ctn, { use: "ㄴ추가지원금 : 5만\nㄴ고혜(요금) : 2만\n", extra: "중고폰&현물 판매 : S23\nㄴ판매금액 : 30만\nㄴ사용금액 : 10만\n" }),
    report(PEOPLE[1].name, PEOPLE[1].ctn, { date: "10.06" }),
  );
  const m = ss.month();
  m.cell(9, 15).value = 30000;
  m.cell(9, 15).note = "스팟1 3만";
  assert.equal((await post(gPOST, { op: "create", month: "2026-10", id: "gob-test-0001", content: "가짜", amount: 10000, seller: STAFF_NAMES[0] })).ok, true);
  await post(oPOST, { op: "create", month: "2026-10", id: "oth-test-0001", name: "별도 영업지원금 010-0000-1111", kind: "gain", amount: 300000, memo: "비밀메모" });
  await post(oPOST, { op: "create", month: "2026-10", id: "oth-test-0002", name: "운영비 차감", kind: "deduct", amount: 50000 });
  const sales = await list();
  const b = calculateBudget(sales);
  const applied = applyGobulbi(b, 10000);
  const final = applyOtherBudget(applied.total, 250000);

  const before = JSON.stringify([...ss.sheets.values()].map((s) => s.rows));
  const analysis = new FakeSpreadsheet([]);
  vm.runInContext(readFileSync(path.join(WS_DIR, "analysis-apps-script", "other-budget-tab.gs"), "utf8"), gas.ctx as vm.Context);
  const r = gas.fn("wsAiWriteOtherBudgetTab_")(analysis, ss, ["2026-09", "2026-10", "2026-11"]) as { ok: boolean; rows: number };
  assert.equal(r.ok, true);
  assert.equal(JSON.stringify([...ss.sheets.values()].map((s) => s.rows)), before, "무선장표 원본 무변경");
  const tab = analysis.sheets.get("기타예산")!;
  const row = (n: number) => tab.rowValues(n).slice(0, 12);
  const oct = row(3);
  assert.deepEqual(oct.slice(0, 9), ["2026-10", b.total, 10000, applied.total, 300000, 50000, 250000, final.finalTotal, 2]);
  assert.equal(oct[10], "정상");
  assert.deepEqual(row(2).slice(0, 8), ["2026-09", 0, 0, 0, 0, 0, 0, 0]);
  assert.equal(row(4)[10], "월 시트 없음");
  const text = tab.allText().join("\n");
  for (const p of PEOPLE) {
    assert.ok(!text.includes(p.name) && !text.includes(p.ctn), "고객 개인정보 없음");
  }
  assert.ok(!text.includes("비밀메모"), "메모 없음");
  assert.match(text, /별도 영업지원금 \*\*\*\(\+300000\)/);
});
