/*
 * '스팟' → '충청' 명칭 (2026-11-28 점장 결정) — 가짜 시트만.
 *   2026년 10월까지 "스팟", 11월부터 "충청". 같은 예산 항목: 메모의 스팟1·충청1 은 같은 1번 (중복 집계 안 함).
 *   기존 메모·금액·수식은 그대로, 새 일괄등록 메모만 개통일 시기 명칭으로 저장.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { setup, register, report, list, authed } from "../harness/web.ts";
import { PEOPLE } from "../harness/fake-people.ts";
import { colNum as L } from "../harness/formula.ts";
import { kstDate } from "../harness/fake-spreadsheet.ts";
import { POST } from "@/app/api/spot/bulk/route";
import { spotTerm, spotTermForRange, CURRENT_SPOT_TERM } from "@/lib/spot-term";
import { buildSpotReport, noteForDisplay, parseSpotNote } from "@/lib/spot";
import { buildBulkPreview, defaultSelection, resolveSelection, toBulkItems, conditionText, noteAfter, type SpotCondition } from "@/lib/spot-bulk";
import { calculateBudget } from "@/lib/budget";

const post = (b: unknown) => POST(authed("/api/spot/bulk", { method: "POST", body: JSON.stringify(b) })).then((r) => r.json());
let n = 0;
const rid = () => `req-term-${String(++n).padStart(6, "0")}`;

test("1) 기준: 2026-10 까지 스팟, 2026-11 부터 충청", () => {
  assert.equal(spotTerm("2026-10"), "스팟");
  assert.equal(spotTerm("2026-10-31"), "스팟");
  assert.equal(spotTerm("2026-11"), "충청");
  assert.equal(spotTerm("2026-11-01"), "충청");
  assert.equal(spotTerm("2027-01-05"), "충청");
  assert.equal(CURRENT_SPOT_TERM, "충청");
  assert.equal(spotTermForRange("2026-10-28", "2026-11-03"), "충청(스팟)");
  assert.equal(conditionText({ id: "c", from: "2026-11-01", to: "2026-11-30", models: [], spot: 1, amount: 30000 }), "2026-11-01~2026-11-30 / 전체 모델 / 충청1 / 30000원");
  assert.equal(noteAfter("스팟2 2만", [{ spot: 1, amount: 30000 }], "충청"), "스팟2 2만\n충청1 3만");
});

test("2) 메모의 스팟1·충청1 은 같은 1번 — 한 번만 집계, 보는 월 명칭으로 표시", () => {
  const p = parseSpotNote("스팟1 3만\n충청2 5만\n충청 3 1만");
  assert.deepEqual(p.entries.map((e) => [e.spot, e.amount]), [[1, 30000], [2, 50000], [3, 10000]]);
  const sale = (row: number, note: string, o: number) => ({ row, activatedAt: "2026-11-05", customer: "x", ctn: "", spot: o, spotNote: note }) as never;
  const rep = buildSpotReport([sale(9, "스팟1 3만", 30000), sale(10, "충청1 3만", 30000)], "충청");
  assert.deepEqual(rep.spots.map((s) => [s.label, s.count, s.amount]), [["충청1", 2, 60000]], "스팟1 과 충청1 이 별도 항목으로 나뉘지 않음");
  assert.equal(rep.noteTotal, 60000);
  assert.deepEqual(buildSpotReport([sale(9, "스팟1 3만", 30000)]).spots.map((s) => s.label), ["스팟1"], "10월 이전 화면은 스팟");
  assert.equal(noteForDisplay("스팟1 3만\n스팟 11\n메모", "충청"), "충청1 3만\n충청 11\n메모");
  assert.equal(noteForDisplay("스팟1 3만", "스팟"), "스팟1 3만");
});

test("3) 일괄등록: 10월 개통 → '스팟N', 11월 개통 → '충청N' 메모 / 기존 '스팟2' 가 있는 11월 판매에 충청2 는 같은 번호로 막힘 / 금액 계산 동일", async () => {
  const { ss } = setup({ months: ["10월", "11월"] });
  await register(report(PEOPLE[0].name, PEOPLE[0].ctn, { date: "10.30" }));
  const nov = ss.month("11월");
  const put = (r: number, date: string, i: number, note = "", o: number | string = "") => {
    nov.cell(r, 3).value = kstDate(date);
    nov.cell(r, 4).value = PEOPLE[i].name;
    nov.cell(r, 5).value = PEOPLE[i].ctn;
    nov.cell(r, L("J")).value = "A17";
    if (o !== "") nov.cell(r, L("O")).value = o;
    if (note) nov.cell(r, L("O")).note = note;
  };
  put(9, "2026-11-02", 1);
  put(10, "2026-11-03", 2, "스팟2 2만", 20000); // 11월에 예전 이름으로 적힌 메모
  const before10 = { v: nov.value(10, L("O")), note: nov.peek(10, L("O"))!.note };
  const sales = [...(await list("10월")).map((s) => ({ ...s, sheet: "10월" })), ...(await list("11월")).map((s) => ({ ...s, sheet: "11월" }))];
  const conditions: SpotCondition[] = [
    { id: "c1", from: "2026-10-28", to: "2026-11-05", models: [], spot: 1, amount: 30000 },
    { id: "c2", from: "2026-11-01", to: "2026-11-05", models: [], spot: 2, amount: 50000 },
  ];
  const pv = buildBulkPreview(sales, conditions);
  const c2On10 = pv.rows.find((r) => r.saleKey === "11월:10" && r.condition.id === "c2")!;
  assert.ok(c2On10.flags.includes("already"), "메모 '스팟2' 와 새 '충청2' 는 같은 번호");
  const sel = new Set(pv.rows.filter((r) => r.selectable && r.condition.id === "c1").map((r) => r.key));
  const res = resolveSelection(pv, sel);
  const r = await post({ op: "apply", requestId: rid(), conditions, items: toBulkItems(res.choices) });
  assert.equal(r.result.applied, 3, JSON.stringify(r));
  const oct = ss.month("10월");
  const octRow = (await list("10월"))[0].row;
  assert.equal(oct.peek(octRow, L("O"))!.note, "스팟1 3만", "10월 개통은 스팟");
  assert.equal(nov.peek(9, L("O"))!.note, "충청1 3만", "11월 개통은 충청");
  assert.equal(nov.peek(10, L("O"))!.note, "스팟2 2만\n충청1 3만", "기존 메모 줄은 그대로");
  assert.equal(nov.value(10, L("O")), 50000, "기존 금액 + 새 금액 (숫자)");
  assert.notEqual(before10.note, nov.peek(10, L("O"))!.note);
  // 11월 화면: 충청 이름으로 1·2번 각각 한 번씩, O열 합계와 같음 (중복 없음)
  const novSales = await list("11월");
  const rep = buildSpotReport(novSales, "충청");
  assert.deepEqual(rep.spots.map((s) => [s.label, s.count, s.amount]), [["충청1", 2, 60000], ["충청2", 1, 20000]]);
  assert.equal(rep.noteTotal, calculateBudget(novSales).spot, "번호별 합계 = 예산관리 충청예산(O열 합계)");
  assert.equal(rep.problems.length, 0);
  // 이력에도 시기 명칭
  const hist = ss.sheets.get("스팟일괄등록이력")!.allText().join("\n");
  assert.match(hist, /충청\(스팟\)1/);
});
