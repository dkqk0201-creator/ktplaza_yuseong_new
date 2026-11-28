/*
 * AI 분석데이터 "기타예산" 탭 (analysis-apps-script/other-budget-tab.gs, 2026-11-28) — 가짜 시트만.
 * 분석 Code.gs 의 도우미(aiText_·aiAmount_·aiGroupSales_ 등)는 저장소에 없으므로 같은 규칙의 최소 흉내로 붙인다.
 * 확인: 탭 값 = 웹앱 예산관리 계산 (장표기준 → − 고불비 → 기존 → + 기타 순증감 → 최종), 원본 무변경, 메모·개인정보 없음,
 *       원본 시트 제목이 다르면 예외 없이 "확인 필요".
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { setup, register, report, list, authed } from "../harness/web.ts";
import { PEOPLE } from "../harness/fake-people.ts";
import { STAFF_NAMES } from "../harness/staff.ts";
import { WS_DIR } from "../harness/gas.ts";
import type { FakeSheet } from "../harness/fake-spreadsheet.ts";
import { POST as oPOST } from "@/app/api/budget/other/route";
import { POST as gPOST } from "@/app/api/budget/gobulbi/route";
import { calculateBudget } from "@/lib/budget";
import { applyGobulbi } from "@/lib/gobulbi";
import { applyOtherBudget } from "@/lib/other-budget";

const post = (h: (r: Request) => Promise<Response>, b: unknown) => h(authed("/api", { method: "POST", body: JSON.stringify(b) })).then((r) => r.json());

// 분석 Code.gs 도우미 최소 흉내 (같은 규칙)
const HELPERS = `
var AI = { TZ: 'Asia/Seoul' };
function aiIsDateObj_(v) { return Object.prototype.toString.call(v) === '[object Date]' && !isNaN(v.getTime()); }
function aiText_(v) { if (v === null || v === undefined) return ''; if (aiIsDateObj_(v)) return Utilities.formatDate(v, AI.TZ, 'yyyy-MM-dd'); var t = String(v).trim(); return t.charAt(0) === "'" ? t.substring(1) : t; }
function aiAmount_(v) { if (typeof v === 'number') return isFinite(v) ? v : 0; var t = aiText_(v).replace(/,/g, '').replace(/원$/, ''); return /^-?\\d+(\\.\\d+)?$/.test(t) ? Number(t) : 0; }
function aiSheetRows_(sh, ncol) { if (!sh || sh.getLastRow() < 2) return []; return sh.getRange(2, 1, sh.getLastRow() - 1, ncol).getValues(); }
function aiGroupSales_(sales) { var z = { secured: 0, used: 0, extra: 0, spot: 0, cash: 0 }; sales.forEach(function (s) { var a = s.amt;
  z.secured += a.P + a.Q + a.R + a.S + a.T; z.used += a.V + a.X + a.Y; z.extra += a.W; z.spot += a.O; z.cash += a.AB; }); return { store: z }; }
`;

test("1) 기타예산 탭 = 웹앱 예산관리 계산, 원본 무변경, 메모·개인정보 없음", async () => {
  const { ss, gas } = setup();
  await register(
    report(PEOPLE[0].name, PEOPLE[0].ctn, { use: "ㄴ추가지원금 : 5만\nㄴ고혜(요금) : 2만\n", extra: "중고폰&현물 판매 : S23\nㄴ판매금액 : 30만\nㄴ사용금액 : 10만\n" }),
    report(PEOPLE[1].name, PEOPLE[1].ctn, { date: "10.06" }),
  );
  ss.month().cell(9, 15).value = 30000;
  assert.equal((await post(gPOST, { op: "create", month: "2026-10", id: "gob-test-0001", content: "가짜", amount: 10000, seller: STAFF_NAMES[0] })).ok, true);
  await post(oPOST, { op: "create", month: "2026-10", id: "oth-test-0001", name: "별도 영업지원금 010-0000-1111", kind: "gain", amount: 300000, memo: "비밀메모" });
  await post(oPOST, { op: "create", month: "2026-10", id: "oth-test-0002", name: "운영비 차감", kind: "deduct", amount: 50000 });
  await post(oPOST, { op: "create", month: "2026-09", id: "oth-test-0003", name: "다른 달", kind: "gain", amount: 1 });
  const sales = await list();
  const applied = applyGobulbi(calculateBudget(sales), 10000);
  const final = applyOtherBudget(applied.total, 250000);

  const before = JSON.stringify([...ss.sheets.values()].map((s) => s.rows));
  vm.runInContext(HELPERS + readFileSync(path.join(WS_DIR, "analysis-apps-script", "other-budget-tab.gs"), "utf8"), gas.ctx as vm.Context);
  const extras = gas.fn("aiReadBudgetExtras_")(ss) as { problems: string[] };
  assert.deepEqual(JSON.parse(JSON.stringify(extras.problems)), []);
  // 분석 Code.gs aiReadWireless_ 가 만드는 판매 모양 (금액만)
  const W = {
    months: { "2026-10": "10월" },
    extras,
    sales: sales.map((s) => ({ ym: "2026-10", amt: { P: s.securedDicho ?? 0, Q: s.appleMania ?? 0, R: s.securedSecond ?? 0, S: s.modelPolicy ?? 0, T: s.customerBenefit ?? 0,
      O: s.spot ?? 0, V: s.usedModelPlan ?? 0, W: s.usedExtraSupport ?? 0, X: s.usedDicho ?? 0, Y: s.usedSecond ?? 0, AB: s.usedPhoneRemaining ?? 0 } })),
  };
  const rows = JSON.parse(JSON.stringify(gas.fn("aiBuildOtherBudget_")(W, { months: ["2026-08", "2026-09", "2026-10"] }))) as unknown[][];
  assert.equal(JSON.stringify([...ss.sheets.values()].map((s) => s.rows)), before, "무선장표 원본 무변경");
  assert.equal(rows.length, 1, "월 시트가 있는 달만");
  assert.deepEqual(rows[0].slice(0, 9), ["2026-10", calculateBudget(sales).total, 10000, applied.total, 300000, 50000, 250000, final.finalTotal, 2]);
  assert.equal(rows[0][10], "정상");
  const text = JSON.stringify(rows);
  for (const p of PEOPLE) assert.ok(!text.includes(p.name) && !text.includes(p.ctn) && !text.includes(p.ctn.replace(/-/g, "")), "고객 개인정보 없음");
  assert.ok(!text.includes("비밀메모"), "메모 없음");
  assert.match(text, /별도 영업지원금 \*\*\*\(\+300000\)/);

  // 원본 시트 제목이 다르면 예외 없이 확인 필요
  (ss.sheets.get("기타예산내역") as FakeSheet).cell(1, 5).value = "금액(원)";
  const bad = gas.fn("aiReadBudgetExtras_")(ss) as { problems: string[] };
  assert.deepEqual(JSON.parse(JSON.stringify(bad.problems)), ["기타예산내역 제목 다름"]);
});
