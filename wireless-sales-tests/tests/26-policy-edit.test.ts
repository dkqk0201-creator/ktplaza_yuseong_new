/*
 * 예산관리 > 정책 확보 관리 (2026-11-28) — 가짜 시트·가짜 고객만.
 * 조회(lib/policy-edit.ts) → 수정 저장 API(/api/budget/policy) → policy-edit.gs → R·S·T 값 + 이력 시트
 * → 같은 행 N(=SUM(O:T))·AC 수식 → 예산관리(calculateBudget)·모델정책 정산(S열) 반영.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { setup, register, report, list } from "../harness/web.ts";
import { authed } from "../harness/web.ts";
import { PEOPLE } from "../harness/fake-people.ts";
import { colNum as L } from "../harness/formula.ts";
import { kstDate } from "../harness/fake-spreadsheet.ts";
import { POST, GET } from "@/app/api/budget/policy/route";
import {
  POLICY_FIELDS,
  changeDelta,
  changesFromInput,
  groupPolicy,
  parseEditItem,
  parsePolicyAmount,
  policyValues,
  selectPolicySales,
  toEditItem,
  type PolicySale,
} from "@/lib/policy-edit";
import { QUICK_FIELDS } from "@/lib/quick-report";
import { COLUMN_LETTER } from "@/lib/sheet-columns";
import { calculateBudget } from "@/lib/budget";
import { isModelPolicySale } from "@/lib/model-policy";
import type { SheetSale } from "@/lib/sheet-record";

const post = (b: unknown) =>
  POST(authed("/api/budget/policy", { method: "POST", body: JSON.stringify(b) })).then(async (r) => ({ status: r.status, ...(await r.json()) }));
let n = 0;
const rid = () => `req-pol-${String(++n).padStart(6, "0")}`;
const withSheet = (sales: SheetSale[], sheet: string): PolicySale[] => sales.map((s) => ({ ...s, sheet }));

/** 10월 3건 + 11월 2건 (가짜). 모델·정책 금액은 장표 칸에 직접 */
async function env() {
  const e = setup({ months: ["10월", "11월"] });
  await register(
    report(PEOPLE[0].name, PEOPLE[0].ctn, { date: "10.29" }),
    report(PEOPLE[1].name, PEOPLE[1].ctn, { date: "10.30" }),
    report(PEOPLE[2].name, PEOPLE[2].ctn, { date: "10.31" }),
  );
  const oct = e.ss.month("10월");
  const octSales = await list("10월");
  const [a, b, c] = octSales;
  oct.cell(a.row, L("J")).value = "A17";
  oct.cell(b.row, L("J")).value = " a17 ";
  oct.cell(c.row, L("J")).value = "A175";
  oct.cell(a.row, L("R")).value = 0; // 실제 0원
  oct.cell(a.row, L("S")).value = 30000;
  oct.cell(a.row, L("T")).value = 100000;
  oct.cell(b.row, L("S")).value = "-"; // 빈칸(-)
  oct.cell(b.row, L("T")).value = 50000;
  oct.cell(a.row, L("K")).value = "5G 스페셜";
  oct.cell(c.row, L("K")).value = ""; // 요금제 미입력
  // 11월 판매 2건 (같은 No. 가 다른 월에 있을 수 있음)
  const nov = e.ss.month("11월");
  const put = (r: number, date: string, i: number, model: string) => {
    nov.cell(r, 2).value = String(r - 8);
    nov.cell(r, 3).value = kstDate(date);
    nov.cell(r, 4).value = PEOPLE[i].name;
    nov.cell(r, 5).value = PEOPLE[i].ctn;
    nov.cell(r, L("J")).value = model;
    nov.cell(r, L("K")).value = "베이직";
    nov.cell(r, L("M")).value = PEOPLE[i].name.slice(0, 1) + "직원";
    nov.cell(r, L("N")).formula = `=SUM(O${r}:T${r})`;
    nov.cell(r, L("T")).value = 20000;
  };
  put(9, "2026-11-02", 3, "A17");
  put(10, "2026-11-05", 4, "S26");
  return { ...e, oct, nov };
}

test("1) 매핑: 카톡 정책 고객혜택=T, 그외(스팟제외)=S, 2ND연계정책=R (간편등록 저장 칸과 같음)", () => {
  const col = (id: string) => QUICK_FIELDS.find((f) => f.id === id)!.column;
  assert.equal(col("policyBenefit"), "customerBenefit");
  assert.equal(col("policyOther"), "modelPolicy");
  assert.equal(col("policySecond"), "securedSecond");
  for (const f of POLICY_FIELDS) assert.equal(COLUMN_LETTER[f.saleKey], f.letter);
  assert.deepEqual(POLICY_FIELDS.map((f) => f.letter), ["T", "S", "R"]);
});

test("2) 조회: 월을 넘는 기간·여러 모델(A17≠A175)·전체 모델, 빈칸과 0 구별, 요금제 그대로", async () => {
  await env();
  const sales = [...withSheet(await list("10월"), "10월"), ...withSheet(await list("11월"), "11월")];
  const q1 = selectPolicySales(sales, { from: "2026-10-30", to: "2026-11-04", models: ["a17"] });
  assert.deepEqual(q1.rows.map((s) => [s.sheet, s.activatedAt, s.model.trim().toUpperCase()]), [["10월", "2026-10-30", "A17"], ["11월", "2026-11-02", "A17"]]);
  const q2 = selectPolicySales(sales, { from: "2026-10-29", to: "2026-10-31", models: ["A17", "A175"] });
  assert.equal(q2.rows.length, 3);
  const q3 = selectPolicySales(sales, { from: "2026-10-01", to: "2026-11-30", models: [] });
  assert.equal(q3.rows.length, 5, "기간 내 전체 판매");
  const first = q2.rows[0];
  assert.deepEqual(policyValues(first), { benefit: 100000, other: 30000, second: 0 }, "R=0 은 0, 숫자 그대로");
  assert.equal(first.plan, "5G 스페셜");
  assert.equal(q2.rows[2].plan, "", "요금제 미입력 → 화면 '미입력'");
  assert.equal(policyValues(q2.rows[1]).other, null, "'-' 는 빈칸(null) — 0 과 다름");
  const g = groupPolicy(q2.rows, "model");
  assert.deepEqual(g.map((x) => [x.name, x.count, x.total]), [["A17", 2, 180000], ["A175", 1, 50000]]);
});

test("3) 입력: 빈칸 = 그대로, 지금 값과 같으면 변경 아님, 빈칸→0 은 변경, 잘못된 값 거부", () => {
  assert.equal(parsePolicyAmount(""), undefined);
  assert.equal(parsePolicyAmount("3만5천"), 35000);
  assert.equal(parsePolicyAmount("30,000원"), 30000);
  assert.ok(Number.isNaN(parsePolicyAmount("abc")!));
  const before = { benefit: 100000, other: null, second: 0 };
  assert.deepEqual(changesFromInput(before, { benefit: "100000", other: "", second: "0" }).change, {});
  assert.deepEqual(changesFromInput(before, { other: "0" }).change, { other: 0 });
  assert.deepEqual(changesFromInput(before, { benefit: "12만", second: "1만" }).change, { benefit: 120000, second: 10000 });
  assert.match(changesFromInput(before, { benefit: "-5000" }).error ?? "", /숫자|0원 이상/);
  assert.deepEqual(changeDelta(before, { benefit: 120000, other: 5000 }), { benefit: 20000, other: 5000, second: 0, total: 25000 });
  // 서버 확인: 음수·모르는 항목·바뀐 항목 없음은 거부
  const ok = { sheet: "10월", row: 9, no: "1", activatedAt: "2026-10-29", customer: "x", ctn: "", model: "A17", saleId: "", before: { benefit: "1", other: "", second: "0" }, after: { benefit: 2 } };
  assert.ok(parseEditItem(ok));
  assert.equal(parseEditItem({ ...ok, after: { benefit: -1 } }), null);
  assert.equal(parseEditItem({ ...ok, after: { spot: 1 } }), null);
  assert.equal(parseEditItem({ ...ok, after: {} }), null);
  assert.equal(parseEditItem({ ...ok, sheet: "운영" }), null);
});

test("4) 여러 판매를 각각 수정 → 한 번에 저장: 바뀐 칸만, N·AC·매장 총예산 재계산, 다른 예산 불변, 중복 저장 방지, 이력에 개인정보 없음", async () => {
  const { ss, oct } = await env();
  const before = await list("10월");
  const [a, b, c] = before;
  const snap = (r: number) => Array.from({ length: 38 }, (_, i) => [oct.peek(r, i + 1)?.value ?? "", oct.peek(r, i + 1)?.formula ?? ""]);
  const snaps = [a, b, c].map((s) => snap(s.row));
  const budget0 = calculateBudget(before);
  const sa = { ...a, sheet: "10월" };
  const sb = { ...b, sheet: "10월" };
  const items = [toEditItem(sa, { benefit: 120000 }), toEditItem(sb, { other: 0, second: 15000 })];
  const id = rid();
  const r = await post({ op: "apply", requestId: id, items });
  assert.equal(r.status, 200, JSON.stringify(r));
  assert.equal(r.result.applied, 2);
  assert.equal(r.result.delta, 20000 + 0 + 15000);
  // 바뀐 칸만
  assert.equal(oct.value(a.row, L("T")), 120000);
  assert.equal(oct.value(a.row, L("S")), 30000);
  assert.equal(oct.value(a.row, L("R")), 0);
  assert.equal(oct.value(b.row, L("S")), 0, "빈칸(-) → 0");
  assert.equal(oct.value(b.row, L("R")), 15000);
  assert.equal(oct.value(b.row, L("T")), 50000);
  for (const [i, s] of [a, b, c].entries()) {
    const now = snap(s.row);
    snaps[i].forEach((cell, col) => {
      const letter = ["R", "S", "T"][[17, 18, 19].indexOf(col)];
      if (letter) return;
      assert.deepEqual(now[col], cell, `${s.row}행 ${col + 1}열은 그대로 (수식 포함)`);
    });
  }
  // 수식으로 판매 총 확보금액(N)·최종 남은 예산(AC) 재계산
  const after = await list("10월");
  const A2 = after.find((x) => x.row === a.row)!;
  const B2 = after.find((x) => x.row === b.row)!;
  assert.equal(A2.securedTotal, (a.securedTotal ?? 0) + 20000);
  assert.equal(A2.finalTotal, (a.finalTotal ?? 0) + 20000);
  assert.equal(B2.securedTotal, (b.securedTotal ?? 0) + 15000);
  // 매장 예산: 고객혜택 확보·총예산만 같은 금액만큼, 나머지는 그대로
  const budget1 = calculateBudget(after);
  assert.equal(budget1.benefitSecured - budget0.benefitSecured, 35000);
  assert.equal(budget1.total - budget0.total, 35000);
  for (const k of ["spot", "cash", "customerBenefitUsed", "extraSupportUsed", "benefitUsed"] as const) assert.equal(budget1[k], budget0[k], k);
  // 모델정책 정산(S열)에 반영
  assert.equal(B2.modelPolicy, 0);
  assert.equal(isModelPolicySale(B2), false);
  assert.equal(isModelPolicySale(A2), true);
  // 같은 요청을 다시 보내도 두 번 쓰지 않음
  const again = await post({ op: "apply", requestId: id, items });
  assert.equal(again.result.repeated, true);
  assert.equal(oct.value(a.row, L("T")), 120000);
  // 이력: 판매당 한 줄, 고객 이름·전화번호 없음
  const hist = ss.sheets.get("정책확보수정이력")!;
  const text = hist.allText().join("\n");
  assert.equal(text.includes(PEOPLE[0].name), false);
  assert.equal(text.includes(PEOPLE[0].ctn.replace(/\D/g, "").slice(-4)), false);
  assert.match(text, /120000/);
  const h = await GET(authed("/api/budget/policy")).then((x) => x.json());
  assert.equal(h.history[0].sales, 2);
  assert.equal(h.history[0].delta, 35000);
  assert.equal(h.history[0].benefit, 20000);
  assert.equal(h.history[0].second, 15000);
});

test("5) 충돌·위치 변경·수식 칸은 저장하지 않음 (다른 판매를 잘못 고치지 않음)", async () => {
  const { oct, nov } = await env();
  const sales = withSheet(await list("10월"), "10월");
  const [a, b, c] = sales;
  // 조회 후 다른 곳에서 T 가 바뀜
  oct.cell(a.row, L("T")).value = 110000;
  // b 행에 다른 판매가 들어옴 (정렬·삭제로 위치 변경)
  oct.cell(b.row, 4).value = "다른고객";
  // c 행 R 칸이 수식
  oct.cell(c.row, L("R")).formula = "=1+1";
  const nsales = withSheet(await list("11월"), "11월");
  // 11월 9행은 N열이 합계 수식이 아님
  nov.cell(9, L("N")).formula = "";
  nov.cell(9, L("N")).value = 20000;
  const items = [toEditItem(a, { benefit: 1 }), toEditItem(b, { benefit: 1 }), toEditItem(c, { second: 1 }), toEditItem(nsales[0], { benefit: 1 }), toEditItem(nsales[1], { benefit: 25000 })];
  const r = await post({ op: "apply", requestId: rid(), items });
  const msgs = r.result.results.map((x: { message: string }) => x.message);
  assert.match(msgs[0], /다른 곳에서 금액이 바뀌어/);
  assert.match(msgs[1], /화면과 달라.*고객/);
  assert.match(msgs[2], /수식/);
  assert.match(msgs[3], /N열/);
  assert.equal(msgs[4], "수정");
  assert.equal(r.result.applied, 1);
  assert.equal(oct.value(a.row, L("T")), 110000);
  assert.equal(oct.value(b.row, L("T")), 50000);
  assert.equal(nov.value(9, L("T")), 20000);
  assert.equal(nov.value(10, L("T")), 25000);
  // 판매 ID 가 다르면 거부
  const s2 = withSheet(await list("11월"), "11월")[1];
  const bad = { ...toEditItem(s2, { benefit: 30000 }), saleId: "other-id" };
  const r2 = await post({ op: "apply", requestId: rid(), items: [bad] });
  assert.match(r2.result.results[0].message, /판매 ID/);
});

test("6) 되돌리기: 변경 전 원문(숫자·'-')으로 복구, 그사이 다시 바뀐 판매는 건너뜀", async () => {
  const { oct } = await env();
  const [a, b] = withSheet(await list("10월"), "10월");
  const r = await post({ op: "apply", requestId: rid(), items: [toEditItem(a, { benefit: 1000 }), toEditItem(b, { other: 7000 })] });
  assert.equal(r.result.applied, 2);
  oct.cell(a.row, L("T")).value = 999; // a 는 수정 후 다시 바뀜
  const u = await post({ op: "undo", requestId: r.result.requestId });
  assert.equal(u.undo.restored, 1);
  assert.equal(u.undo.skipped.length, 1);
  assert.equal(oct.value(b.row, L("S")), "-", "'-' 원문 그대로 복구");
  assert.equal(oct.value(a.row, L("T")), 999);
  const h = await GET(authed("/api/budget/policy")).then((x) => x.json());
  assert.equal(h.history[0].status, "일부 되돌림");
  const u2 = await post({ op: "undo", requestId: r.result.requestId });
  assert.equal(u2.undo.restored, 0);
});

test("7) 로그인 없이는 조회·저장·되돌리기 모두 거부", async () => {
  setup();
  const plain = (method: string, body?: unknown) =>
    new Request("https://test.invalid/api/budget/policy", { method, headers: { origin: "https://test.invalid" }, body: body ? JSON.stringify(body) : undefined });
  assert.equal((await GET(plain("GET"))).status, 401);
  assert.equal((await POST(plain("POST", { op: "undo", requestId: "req-x-0000001" }))).status, 401);
  assert.equal((await POST(plain("POST", { op: "apply", requestId: "req-x-0000002", items: [] }))).status, 401);
});
