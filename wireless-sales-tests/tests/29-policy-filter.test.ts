/*
 * 정책 확보 관리 — 정책 항목 필터 (2026-11-29) — 가짜 시트·가짜 고객만.
 * 고객혜택(T)·그외(스팟제외)(S)·2ND연계정책(R) 중 고른 항목이 0원보다 큰 판매만 (여러 개면 하나 이상, 판매 1건 = 1줄).
 * 빈칸·"-"·0원 = 제외, 금액으로 읽을 수 없는 글자·음수 = '확인 필요'로 따로 (0원으로 보지 않음). 조회는 장표를 바꾸지 않음.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { setup, register, report, list, authed } from "../harness/web.ts";
import { PEOPLE } from "../harness/fake-people.ts";
import { colNum as L } from "../harness/formula.ts";
import { POST } from "@/app/api/budget/policy/route";
import { matchPolicies, policyFilterLabel, policyPresence, selectPolicySales, toEditItem, type PolicySale, type PolicyQuery } from "@/lib/policy-edit";
import { calculateBudget } from "@/lib/budget";
import type { SheetSale } from "@/lib/sheet-record";

const withSheet = (sales: SheetSale[], sheet: string): PolicySale[] => sales.map((s) => ({ ...s, sheet }));
let n = 0;
const rid = () => `req-pf-${String(++n).padStart(6, "0")}`;
const post = (b: unknown) => POST(authed("/api/budget/policy", { method: "POST", body: JSON.stringify(b) })).then(async (r) => ({ status: r.status, ...(await r.json()) }));

/** 10월 가짜 판매 5건: [모델, T, S, R] */
const DATA: [string, unknown, unknown, unknown][] = [
  ["A17", 100000, 30000, 0], //   s1 고객혜택·그외
  ["A17", 0, "-", 15000], //       s2 2ND 만
  ["F971", 50000, "", ""], //      s3 고객혜택 만
  ["F976", "3만원요", 0, 0], //    s4 고객혜택 칸에 읽을 수 없는 글자
  ["S26", 0, 0, 0], //             s5 셋 다 0
];

async function env() {
  const e = setup();
  await register(...PEOPLE.slice(0, 5).map((p, i) => report(p.name, p.ctn, { date: `10.0${i + 1}` })));
  const sh = e.ss.month();
  const sales = await list();
  DATA.forEach(([model, t, s, r], i) => {
    const row = sales[i].row;
    for (const [col, v] of [["J", model], ["T", t], ["S", s], ["R", r]] as const) {
      sh.cell(row, L(col)).formula = "";
      sh.cell(row, L(col)).value = v as string | number;
    }
  });
  const fresh = await list();
  const names = new Map(fresh.map((s, i) => [s.row, `s${i + 1}`]));
  return { ...e, sh, names };
}
const q = (over: Partial<PolicyQuery>): PolicyQuery => ({ from: "2026-10-01", to: "2026-10-31", models: [], ...over });
const pick = async (names: Map<number, string>, over: Partial<PolicyQuery>) => {
  const r = selectPolicySales(withSheet(await list(), "10월"), q(over));
  return { rows: r.rows.map((s) => names.get(s.row)), unclear: r.policyUnclear.map((s) => names.get(s.row)) };
};

test("1) 판정: 0원 초과=확보, 빈칸·-·0=없음, 읽을 수 없는 글자=확인 필요 (금액은 null 그대로)", async () => {
  const { names } = await env();
  const sales = await list();
  const by = (k: string) => sales.find((s) => names.get(s.row) === k)!;
  assert.deepEqual(["benefit", "other", "second"].map((k) => policyPresence(by("s1"), k as never)), ["secured", "secured", "none"]);
  assert.deepEqual(["benefit", "other", "second"].map((k) => policyPresence(by("s2"), k as never)), ["none", "none", "secured"]);
  assert.deepEqual(["benefit", "other", "second"].map((k) => policyPresence(by("s3"), k as never)), ["secured", "none", "none"]);
  assert.equal(policyPresence(by("s4"), "benefit"), "unclear");
  assert.equal(by("s4").customerBenefit, null, "금액 값은 그대로 null (0으로 바꾸지 않음)");
  assert.deepEqual(by("s4").policyUnread, { customerBenefit: "3만원요" });
  assert.equal(by("s1").policyUnread, undefined, "정상 판매에는 원문 필드 없음");
  assert.equal(matchPolicies(by("s5"), ["benefit", "other", "second"]), "no");
  assert.equal(policyPresence({ ...by("s1"), customerBenefit: -5000 }, "benefit"), "unclear", "음수는 확인 필요");
});

test("2) 단일 정책(전체 모델): 고객혜택 → s1·s3, 확인 필요 s4 / 2ND → s2 만", async () => {
  const { names } = await env();
  assert.deepEqual(await pick(names, { policies: ["benefit"] }), { rows: ["s1", "s3"], unclear: ["s4"] });
  assert.deepEqual(await pick(names, { policies: ["second"] }), { rows: ["s2"], unclear: [] });
  assert.deepEqual(await pick(names, { policies: ["other"] }), { rows: ["s1"], unclear: [] });
});

test("3) 복수 정책: 고객혜택+그외 → 하나 이상 확보, 둘 다 있는 s1 은 한 번만 / 셋 다 → s1·s2·s3", async () => {
  const { names } = await env();
  const r = await pick(names, { policies: ["benefit", "other"] });
  assert.deepEqual(r, { rows: ["s1", "s3"], unclear: ["s4"] });
  assert.deepEqual(await pick(names, { policies: ["benefit", "other", "second"] }), { rows: ["s1", "s2", "s3"], unclear: ["s4"] });
});

test("4) 특정 모델 + 정책: F971·F976 + 고객혜택 → s3, s4 확인 필요 / A17 + 고객혜택 → s1 (s2 는 0원이라 제외)", async () => {
  const { names } = await env();
  assert.deepEqual(await pick(names, { models: ["F971", "F976"], policies: ["benefit"] }), { rows: ["s3"], unclear: ["s4"] });
  assert.deepEqual(await pick(names, { models: ["A17"], policies: ["benefit"] }), { rows: ["s1"], unclear: [] });
});

test("5) 정책 미선택 = 기존과 같음 (기간·모델에 맞는 전체, 확인 필요 목록 없음) · 조건 문구", async () => {
  const { names } = await env();
  assert.deepEqual(await pick(names, {}), { rows: ["s1", "s2", "s3", "s4", "s5"], unclear: [] });
  assert.deepEqual(await pick(names, { policies: [] }), { rows: ["s1", "s2", "s3", "s4", "s5"], unclear: [] });
  assert.equal(policyFilterLabel([]), "정책 조건 없음 (전체)");
  assert.equal(policyFilterLabel(["benefit"]), "고객혜택(T열) 확보");
  assert.equal(policyFilterLabel(["benefit", "other"]), "고객혜택(T열) + 그외(스팟제외)(S열) 중 하나 이상 확보");
});

test("6) 같은 판매가 두 번 들어와도 한 줄 (판매 = 월 시트 + 행)", async () => {
  await env();
  const sales = withSheet(await list(), "10월");
  const r = selectPolicySales([...sales, ...sales], q({ policies: ["benefit", "other"] }));
  assert.equal(r.rows.length, 2);
  assert.equal(new Set(r.rows.map((s) => s.row)).size, 2);
});

test("7) 필터 상태에서 수정 저장 → 재조회에 바로 반영, 조회 자체는 장표·예산을 바꾸지 않음", async () => {
  const { sh, names } = await env();
  const rowsBefore = JSON.stringify(sh.rows);
  const budget0 = calculateBudget(await list());
  for (const p of [["benefit"], ["benefit", "other"], ["second"]] as const) await pick(names, { policies: [...p] });
  assert.equal(JSON.stringify(sh.rows), rowsBefore, "조회만으로 장표 변화 없음");
  assert.deepEqual(calculateBudget(await list()), budget0);
  // 고객혜택 필터 상태에서 s3 고객혜택 50000 → 0 저장, s5 그외 0 → 20000 저장
  const cur = withSheet(await list(), "10월");
  const s3 = cur.find((s) => names.get(s.row) === "s3")!;
  const s5 = cur.find((s) => names.get(s.row) === "s5")!;
  const r = await post({ op: "apply", requestId: rid(), items: [toEditItem(s3, { benefit: 0 }), toEditItem(s5, { other: 20000 })] });
  assert.equal(r.status, 200, JSON.stringify(r));
  assert.equal(r.result.applied, 2);
  assert.deepEqual(await pick(names, { policies: ["benefit"] }), { rows: ["s1"], unclear: ["s4"] }, "s3 빠짐");
  assert.deepEqual(await pick(names, { policies: ["other"] }), { rows: ["s1", "s5"], unclear: [] }, "s5 들어옴");
  // 예산 변화는 저장한 금액만큼 (고객혜택 −50000, 그외 +20000) — 필터는 계산에 관여하지 않음
  const budget1 = calculateBudget(await list());
  assert.equal(budget1.benefitSecured - budget0.benefitSecured, -50000 + 20000);
});
