/*
 * 스팟예산 기간·모델별 일괄등록 (2026-11-28) — 가짜 시트·가짜 고객만.
 * 미리보기(lib/spot-bulk.ts) → 최종 등록 API(/api/spot/bulk) → spot-bulk.gs → O열 값·메모 + 이력 시트
 * → 기존 스팟관리 집계(buildSpotReport)·예산관리 스팟예산(calculateBudget) 반영.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { setup, register, report, list, authed, byName } from "../harness/web.ts";
import { PEOPLE } from "../harness/fake-people.ts";
import { colNum as L } from "../harness/formula.ts";
import { kstDate, type FakeSheet } from "../harness/fake-spreadsheet.ts";
import { POST, GET } from "@/app/api/spot/bulk/route";
import {
  buildBulkPreview,
  defaultSelection,
  normalizeModel,
  resolveSelection,
  summarize,
  toBulkItems,
  noteAfter,
  monthsInRange,
  type BulkSale,
  type SpotCondition,
} from "@/lib/spot-bulk";
import { buildSpotReport } from "@/lib/spot";
import { calculateBudget } from "@/lib/budget";
import type { SheetSale } from "@/lib/sheet-record";

const post = (b: unknown) => POST(authed("/api/spot/bulk", { method: "POST", body: JSON.stringify(b) })).then(async (r) => ({ status: r.status, ...(await r.json()) }));
const withSheet = (sales: SheetSale[], sheet = "10월"): BulkSale[] => sales.map((s) => ({ ...s, sheet }));
const cond = (id: string, from: string, to: string, models: string[], spot: number, amount: number): SpotCondition => ({ id, from, to, models, spot, amount });
let rid = 0;
const newRid = () => `req-test-${String(++rid).padStart(6, "0")}`;

/** 가짜 판매 5건 (10월 1·2·3·5·6일) + 모델 지정 */
async function fiveSales() {
  const env = setup();
  await register(
    report(PEOPLE[0].name, PEOPLE[0].ctn, { date: "10.01" }),
    report(PEOPLE[1].name, PEOPLE[1].ctn, { date: "10.02" }),
    report(PEOPLE[2].name, PEOPLE[2].ctn, { date: "10.03" }),
    report(PEOPLE[3].name, PEOPLE[3].ctn, { date: "10.05" }),
    report(PEOPLE[4].name, PEOPLE[4].ctn, { date: "10.06" }),
  );
  const m = env.ss.month();
  const sales = await list();
  const models: Record<string, string> = { [PEOPLE[0].name]: "A17", [PEOPLE[1].name]: " a17 ", [PEOPLE[2].name]: "A175", [PEOPLE[3].name]: "S26", [PEOPLE[4].name]: "A17" };
  for (const s of sales) m.cell(s.row, L("J")).value = models[s.customer];
  return { ...env, m };
}

async function apply(conditions: SpotCondition[], pick?: (keys: string[]) => Set<string>, sheets = ["10월"]) {
  const sales: BulkSale[] = [];
  for (const sh of sheets) sales.push(...withSheet(await list(sh), sh));
  const preview = buildBulkPreview(sales, conditions);
  const sel = pick ? pick(preview.rows.map((r) => r.key)) : defaultSelection(preview);
  const res = resolveSelection(preview, sel);
  const requestId = newRid();
  const r = await post({ op: "apply", requestId, conditions, items: toBulkItems(res.choices) });
  return { preview, res, r, requestId, summary: summarize(preview, res) };
}

test("1) 특정 기간 + 특정 모델: 정규화(대소문자·공백), A17 과 A175 구분, O열 숫자 + 메모 줄 추가", async () => {
  const { m } = await fiveSales();
  const before = JSON.stringify(m.rows.map((row) => row.map((c) => c.formula)));
  const { preview, r, summary } = await apply([cond("c1", "2026-10-01", "2026-10-03", ["a17"], 1, 30000)]);
  // 10/1 A17, 10/2 " a17 " → 2건. 10/3 A175 제외, 10/6 A17 은 기간 밖
  assert.equal(preview.rows.length, 2);
  assert.equal(summary.totalAmount, 60000);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.result.applied, 2);
  const sales = await list();
  for (const name of [PEOPLE[0].name, PEOPLE[1].name]) {
    const s = byName(sales, name);
    assert.equal(s.spot, 30000);
    assert.equal(typeof m.value(s.row, L("O")), "number", "O열은 숫자로 저장");
    assert.equal(s.spotNote, "스팟1 3만");
  }
  assert.equal(byName(sales, PEOPLE[2].name).spot, null);
  // 기존 수식(N·U·AB·AC·8행 합계)은 그대로
  assert.equal(JSON.stringify(m.rows.map((row) => row.map((c) => c.formula))), before);
  // 기존 스팟관리 집계·예산관리 스팟예산 반영
  const rep = buildSpotReport(sales);
  assert.deepEqual(rep.spots.map((s) => [s.label, s.count, s.amount]), [["스팟1", 2, 60000]]);
  assert.equal(rep.problems.length, 0);
  assert.equal(calculateBudget(sales).spot, 60000);
  assert.equal(Number(m.value(8, L("O"))), 60000, "장표 8행 O열 합계");
});

test("2) 특정 기간 + 전체 모델, 여러 모델 동시 선택", async () => {
  await fiveSales();
  const a = await apply([cond("c1", "2026-10-01", "2026-10-02", [], 2, 50000)]);
  assert.equal(a.r.result.applied, 2);
  const b = await apply([cond("c2", "2026-10-03", "2026-10-06", ["A175", "S26"], 3, 20000)]);
  assert.equal(b.preview.rows.length, 2);
  assert.equal(b.r.result.applied, 2);
  const sales = await list();
  assert.equal(byName(sales, PEOPLE[2].name).spotNote, "스팟3 2만");
  assert.equal(byName(sales, PEOPLE[3].name).spotNote, "스팟3 2만");
  assert.equal(byName(sales, PEOPLE[4].name).spot, null);
});

test("3) 월을 넘어가는 기간 (9월 말~10월 초): 두 월 시트 모두 반영", async () => {
  const env = setup({ months: ["9월", "10월"] });
  await register(report(PEOPLE[0].name, PEOPLE[0].ctn, { date: "10.01" }));
  // 9월 시트에 가짜 판매 1건 직접 입력 (실제 장표처럼)
  const sep = env.ss.month("9월");
  sep.cell(9, 3).value = kstDate("2026-09-29");
  sep.cell(9, 4).value = PEOPLE[5].name;
  sep.cell(9, 5).value = PEOPLE[5].ctn;
  sep.cell(9, L("J")).value = "A17";
  sep.cell(9, L("M")).value = "직원";
  env.ss.month().cell(9, L("J")).value = "A17";
  assert.deepEqual(monthsInRange("2026-09-28", "2026-10-03"), ["2026-09", "2026-10"]);
  const { r } = await apply([cond("c1", "2026-09-28", "2026-10-03", ["A17"], 1, 10000)], undefined, ["9월", "10월"]);
  assert.equal(r.result.applied, 2, r.message);
  assert.equal(sep.value(9, L("O")), 10000);
  assert.equal(sep.peek(9, L("O"))!.note, "스팟1 1만");
  assert.equal((await list())[0].spot, 10000);
});

test("4) 여러 조건 동시 등록 + 중복 조건 충돌: 기본 미적용, 점장이 고른 것만", async () => {
  await fiveSales();
  const conditions = [
    cond("c1", "2026-10-01", "2026-10-03", ["A17"], 1, 30000),
    cond("c2", "2026-10-01", "2026-10-06", ["S26"], 2, 50000),
    cond("c3", "2026-10-01", "2026-10-02", [], 3, 20000), // 10/1·10/2 는 c1 과 충돌
  ];
  const sales = withSheet(await list());
  const preview = buildBulkPreview(sales, conditions);
  const s = summarize(preview, resolveSelection(preview, defaultSelection(preview)));
  assert.equal(s.conflictSales, 2);
  const conflictRows = preview.rows.filter((r) => r.flags.includes("conflict"));
  assert.equal(conflictRows.length, 4);
  assert.ok(conflictRows.every((r) => !r.defaultChecked), "충돌은 기본 체크 해제 (합산·덮어쓰기 안 함)");
  // 기본 선택: c2(S26) 1건만
  const r1 = await apply(conditions);
  assert.equal(r1.r.result.applied, 1);
  assert.equal(byName(await list(), PEOPLE[3].name).spotNote, "스팟2 5만");
  // 점장이 10/1 판매는 c1, 10/2 판매는 c1+c3 둘 다 선택 (명시 승인)
  const r2 = await apply(conditions, (keys) => {
    const one = keys.find((k) => k.endsWith(":c1") && preview.rows.find((r) => r.key === k)!.sale.customer === PEOPLE[0].name)!;
    const two = keys.filter((k) => preview.rows.find((r) => r.key === k)!.sale.customer === PEOPLE[1].name);
    return new Set([one, ...two]);
  });
  assert.equal(r2.r.result.applied, 2);
  const after = await list();
  assert.equal(byName(after, PEOPLE[0].name).spot, 30000);
  assert.equal(byName(after, PEOPLE[1].name).spot, 50000);
  assert.equal(byName(after, PEOPLE[1].name).spotNote, "스팟1 3만\n스팟3 2만");
  const rep = buildSpotReport(after);
  assert.equal(rep.problems.length, 0);
  assert.deepEqual(rep.spots.map((x) => [x.spot, x.count, x.amount]), [[1, 2, 60000], [2, 1, 50000], [3, 1, 20000]]);
});

test("5) 기존 스팟 보호: 기본 제외, 승인하면 기존 금액·메모 보존하고 추가 / 같은 번호는 적용 불가", async () => {
  const { m } = await fiveSales();
  let sales = await list();
  const p0 = byName(sales, PEOPLE[0].name);
  m.cell(p0.row, L("O")).value = 40000;
  m.cell(p0.row, L("O")).note = "스팟7 4만";
  const p1 = byName(sales, PEOPLE[1].name);
  m.cell(p1.row, L("O")).value = 30000;
  m.cell(p1.row, L("O")).note = "스팟1 3만";
  const c = [cond("c1", "2026-10-01", "2026-10-02", [], 1, 10000)];
  const pv = buildBulkPreview(withSheet(await list()), c);
  const r0 = pv.rows.find((r) => r.sale.customer === PEOPLE[0].name)!;
  const r1 = pv.rows.find((r) => r.sale.customer === PEOPLE[1].name)!;
  assert.deepEqual(r0.flags, ["existing"]);
  assert.equal(r0.defaultChecked, false);
  assert.ok(r1.flags.includes("already"));
  assert.equal(r1.selectable, false);
  const d = await apply(c);
  assert.equal(d.preview.rows.filter((r) => d.res.choices.some((x) => x.saleKey === r.saleKey)).length, 0, "기본 선택 없음");
  assert.equal(d.r.status, 400, "적용 대상 0건이면 저장 요청 거부");
  // 명시 승인
  const ok = await apply(c, (keys) => new Set(keys));
  assert.equal(ok.r.result.applied, 1);
  sales = await list();
  assert.equal(byName(sales, PEOPLE[0].name).spot, 50000);
  assert.equal(byName(sales, PEOPLE[0].name).spotNote, "스팟7 4만\n스팟1 1만");
  assert.equal(byName(sales, PEOPLE[1].name).spot, 30000, "같은 번호가 있는 판매는 그대로");
});

test("6) 판매 No. 가 없는 행(UMNP): 누락하지 않고 표시, 체크하면 적용", async () => {
  const { m } = await fiveSales();
  const s = byName(await list(), PEOPLE[2].name);
  m.cell(s.row, 2).value = ""; // No. 빈칸 (UMNP 처럼)
  const c = [cond("c1", "2026-10-03", "2026-10-03", [], 4, 15000)];
  const pv = buildBulkPreview(withSheet(await list()), c);
  assert.equal(pv.rows.length, 1);
  assert.deepEqual(pv.rows[0].flags, ["noNo"]);
  assert.equal(summarize(pv, resolveSelection(pv, defaultSelection(pv))).noNoSales, 1);
  const r = await apply(c, (k) => new Set(k));
  assert.equal(r.r.result.applied, 1);
  assert.equal(byName(await list(), PEOPLE[2].name).spotNote, "스팟4 15,000원");
});

test("7) 같은 요청 두 번(재전송): 두 번째는 다시 쓰지 않음 / 새 요청 ID 로 다시 보내도 기존 값 확인에서 거부", async () => {
  const { m } = await fiveSales();
  const conditions = [cond("c1", "2026-10-05", "2026-10-05", [], 1, 30000)];
  const pv = buildBulkPreview(withSheet(await list()), conditions);
  const items = toBulkItems(resolveSelection(pv, defaultSelection(pv)).choices);
  const requestId = newRid();
  const a = await post({ op: "apply", requestId, conditions, items });
  const b = await post({ op: "apply", requestId, conditions, items });
  assert.equal(a.result.applied, 1);
  assert.equal(b.ok, true);
  assert.equal(b.result.repeated, true);
  const c = await post({ op: "apply", requestId: newRid(), conditions, items });
  assert.equal(c.result.applied, 0);
  assert.match(c.result.results[0].message, /O열 금액이 화면과 달라/);
  const s = byName(await list(), PEOPLE[3].name);
  assert.equal(s.spot, 30000);
  assert.equal(s.spotNote, "스팟1 3만");
  assert.equal(m.writes.filter((w) => w.startsWith("setValue ")).length >= 1, true);
});

test("8) 저장 직전 재검증: 행이 바뀌었거나 모델·개통일이 다르거나 O열 수식·삭제된 행이면 그 판매만 실패, 나머지 성공", async () => {
  const { m } = await fiveSales();
  const conditions = [cond("c1", "2026-10-01", "2026-10-06", [], 9, 1000)];
  const pv = buildBulkPreview(withSheet(await list()), conditions);
  const items = toBulkItems(resolveSelection(pv, defaultSelection(pv)).choices);
  assert.equal(items.length, 5);
  const sales = await list();
  m.cell(byName(sales, PEOPLE[0].name).row, L("J")).value = "다른모델";
  m.cell(byName(sales, PEOPLE[1].name).row, L("O")).formula = "=1+1";
  m.cell(byName(sales, PEOPLE[2].name).row, L("O")).note = "직접 고친 메모";
  const del = byName(sales, PEOPLE[3].name).row;
  for (const c of [1, 3, 4, 5]) m.cell(del, c).value = "";
  const r = await post({ op: "apply", requestId: newRid(), conditions, items });
  assert.equal(r.result.applied, 1);
  assert.equal(r.result.failed, 4);
  const msgs = r.result.results.map((x: { message: string }) => x.message).join(" / ");
  assert.match(msgs, /모델/);
  assert.match(msgs, /수식/);
  assert.match(msgs, /메모가 화면과 달라/);
  assert.match(msgs, /삭제된 판매/);
  assert.equal(byName(await list(), PEOPLE[4].name).spot, 1000);
  // 서버도 조건 밖 판매는 거부 (화면 조작)
  const bad = items.map((i) => ({ ...i, activatedAt: "2026-10-20" }));
  assert.equal((await post({ op: "apply", requestId: newRid(), conditions, items: bad })).status, 400);
});

test("9) 이력 시트(고객 개인정보 없음) + 이력 조회 + 되돌리기(변경 전 금액·메모 복구)", async () => {
  const { ss, m } = await fiveSales();
  const p0row = byName(await list(), PEOPLE[0].name).row;
  m.cell(p0row, L("O")).value = 40000;
  m.cell(p0row, L("O")).note = "스팟7 4만";
  const { r, requestId } = await apply([cond("c1", "2026-10-01", "2026-10-02", [], 1, 30000)], (k) => new Set(k));
  assert.equal(r.result.applied, 2);
  const hist = ss.sheets.get("스팟일괄등록이력") as FakeSheet;
  assert.ok(hist, "이력 시트 생성");
  const text = hist.allText().join("\n");
  for (const p of PEOPLE) {
    assert.ok(!text.includes(p.name), "이력에 고객명 없음");
    assert.ok(!text.includes(p.ctn.replace(/-/g, "")) && !text.includes(p.ctn), "이력에 전화번호 없음");
  }
  assert.match(text, /2026-10-01~2026-10-02 \/ 전체 모델 \/ 스팟1 \/ 30000원/);
  assert.match(text, /스팟7 4만\n스팟1 3만/);
  const h = await GET(authed("/api/spot/bulk")).then((x) => x.json());
  assert.equal(h.history[0].requestId, requestId);
  assert.equal(h.history[0].sales, 2);
  assert.equal(h.history[0].amount, 60000);
  // 한 판매는 등록 후 직접 고침 → 되돌리기에서 건너뜀
  const p1row = byName(await list(), PEOPLE[1].name).row;
  m.cell(p1row, L("O")).value = 99999;
  const u = await post({ op: "undo", requestId });
  assert.equal(u.undo.restored, 1);
  assert.equal(u.undo.skipped.length, 1);
  const after = await list();
  assert.equal(byName(after, PEOPLE[0].name).spot, 40000);
  assert.equal(byName(after, PEOPLE[0].name).spotNote, "스팟7 4만");
  assert.equal(byName(after, PEOPLE[1].name).spot, 99999);
  const h2 = await GET(authed("/api/spot/bulk")).then((x) => x.json());
  assert.equal(h2.history[0].status, "일부 되돌림");
});

test("10) 개통일 오류·취소 판매는 조용히 빼지 않고 제외 목록에 표시", async () => {
  const { m } = await fiveSales();
  const sales = await list();
  m.cell(byName(sales, PEOPLE[0].name).row, 3).value = "10월초";
  m.cell(byName(sales, PEOPLE[1].name).row, L("I")).value = "개통취소";
  const pv = buildBulkPreview(withSheet(await list()), [cond("c1", "2026-10-01", "2026-10-06", [], 1, 1000)]);
  assert.equal(pv.invalidDate.length, 1);
  assert.equal(pv.excluded.length, 1);
  assert.equal(pv.rows.length, 3);
  const s = summarize(pv, resolveSelection(pv, defaultSelection(pv)));
  assert.equal(s.matchedSales, 4);
  assert.equal(s.excludedSales, 1);
});

test("11) 로그인 없이는 거부 · 공용 규칙(메모 형식·모델 정규화)", async () => {
  setup();
  const r = await POST(new Request("https://test.invalid/api/spot/bulk", { method: "POST", headers: { origin: "https://test.invalid" }, body: "{}" }));
  assert.equal(r.status, 401);
  assert.equal(normalizeModel("  galaxy   s26 "), "GALAXY S26");
  assert.equal(noteAfter("", [{ spot: 2, amount: 35500 }]), "스팟2 35,500원");
  assert.equal(noteAfter("스팟1 3만", [{ spot: 2, amount: 50000 }]), "스팟1 3만\n스팟2 5만");
});
