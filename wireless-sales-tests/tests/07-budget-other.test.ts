/* 예산·고불비 등 판매 데이터를 읽는 기능 — 장표 8행 합계와 웹앱 계산이 같은지 (마스킹 후에도 그대로여야 함) */
import { test } from "node:test";
import assert from "node:assert/strict";
import { setup, register, report, list } from "../harness/web.ts";
import { PEOPLE } from "../harness/fake-people.ts";
import { colNum as L } from "../harness/formula.ts";
import { calculateBudget, budgetUsageRows } from "@/lib/budget";
import { POST as gPOST, GET as gGET } from "@/app/api/budget/gobulbi/route";
import { STAFF_NAMES } from "../harness/staff.ts";

test("1) 예산관리 카드 = 장표 8행 합계, 카드별 고객 목록 합계 = 카드", async () => {
  const { ss } = setup();
  await register(
    report(PEOPLE[0].name, PEOPLE[0].ctn, { use: "ㄴ추가지원금 : 5만\nㄴ고혜(요금) : 2만\n", extra: "중고폰&현물 판매 : S23\nㄴ판매금액 : 30만\nㄴ사용금액 : 10만\n" }),
    report(PEOPLE[1].name, PEOPLE[1].ctn, { date: "10.06", use: "ㄴ고혜(기존할부금) : 3만\n" }),
  );
  const sales = await list();
  const b = calculateBudget(sales);
  const m = ss.month();
  const row8 = (c: string) => Number(m.value(8, L(c)));
  assert.equal(b.benefitSecured, ["P", "Q", "R", "S", "T"].reduce((t, c) => t + row8(c), 0));
  assert.equal(b.benefitUsed, row8("U"));
  assert.equal(b.cash, row8("AB"));
  assert.equal(b.spot, row8("O"));
  for (const [kind, card] of [["customerBenefit", b.customerBenefitUsed], ["extraSupport", b.extraSupportUsed], ["secured", b.benefitSecured], ["cash", b.cash]] as const) {
    assert.equal(budgetUsageRows(sales, kind).reduce((t, r) => t + r.amount, 0), card, kind);
  }
});

test("2) 고불비사용: 등록 → 월 합계 (별도 시트, 월별 장표는 그대로)", async () => {
  const { ss } = setup();
  const before = JSON.stringify(ss.month().rows);
  const call = (b: unknown) => gPOST(new Request("http://t", { method: "POST", body: JSON.stringify(b) })).then((r) => r.json());
  const r = await call({ op: "create", month: "2026-10", id: "test-0000-0001", content: "가짜 보상", amount: 10000, seller: STAFF_NAMES[0] });
  assert.equal(r.ok, true, r.message);
  const l = await gGET(new Request("http://t/api/budget/gobulbi?month=2026-10")).then((x) => x.json());
  assert.equal(l.data.total, 10000);
  assert.equal(JSON.stringify(ss.month().rows), before);
});
