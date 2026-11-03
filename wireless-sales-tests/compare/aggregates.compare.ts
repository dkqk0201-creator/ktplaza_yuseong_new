/*
 * 수정 전·후 집계 비교 (가짜 데이터만). 같은 시나리오를 WS_ROOT 가 가리키는 코드로 돌려
 * 예산관리·직원 실적·검수 건수·동판·고객 지표·스팟·카드실적 대상 집계를 JSON 으로 남긴다.
 *   WS_ROOT=/수정전/wireless-sales COMPARE_OUT=before.json ./run.sh compare/aggregates.compare.ts
 *   COMPARE_OUT=after.json ./run.sh compare/aggregates.compare.ts
 * 두 파일이 같아야 한다 (고객명·CTN 은 집계에 넣지 않음 — 마스킹으로 값이 달라지는 것이 정상).
 */
import { test } from "node:test";
import { writeFileSync } from "node:fs";
import { setup, register, report, list, byName, edit, markDone, deleteSale, cardCheck } from "../harness/web.ts";
import { PEOPLE } from "../harness/fake-people.ts";
import { colNum as L } from "../harness/formula.ts";
import { STAFF_NAMES } from "../harness/staff.ts";
import { calculateBudget, budgetUsageRows } from "@/lib/budget";
import { aggregateStaffPerformance, staffOrderOf } from "@/lib/staff-performance";
import { inspectionStatus, matchFilter } from "@/lib/inspection-status";
import { customerBase, summarizeCustomers } from "@/lib/customer-filter";
import { buildSpotReport } from "@/lib/spot";
import { isCardTarget } from "@/lib/card-message";
import type { SheetSale } from "@/lib/sheet-record";

const [A, B, C, D, E, F, G, H] = PEOPLE;
const S = STAFF_NAMES;

test("집계 비교 시나리오", async () => {
  const { ss } = setup({ slots: 25 });
  const m = ss.month();
  // 기존 판매 (장표에 원본, 수정 전 코드로 들어간 것처럼)
  const legacy = (row: number, p: { name: string; ctn: string }, date: string, o: Record<string, unknown>) => {
    const set = (c: string, v: unknown) => { m.cell(row, L(c)).value = v; };
    set("C", date); set("D", p.name); set("E", p.ctn); set("I", "기기변경"); set("J", "SM-S928N"); set("M", o.staff ?? S[0]);
    for (const [k, v] of Object.entries(o)) if (k.length <= 2) set(k, v);
    m.cell(row, L("N")).formula = `=SUM(O${row}:T${row})`; m.cell(row, L("U")).formula = `=SUM(V${row}:Y${row})`;
    m.cell(row, L("AB")).formula = `=N(Z${row})-N(AA${row})`; m.cell(row, L("AC")).formula = `=N(N${row})-N(U${row})+N(AB${row})`;
  };
  legacy(9, E, "2026-10-01", { staff: S[1], O: 30000, T: 50000, V: 20000, G: "O", H: "O", AK: "순동", AI: "필L", AE: "O", AF: "우리" });
  legacy(10, F, "2026-10-01", { staff: S[0], P: 10000, S: 70000, W: 40000, Z: 300000, AA: 100000, G: "O", H: "X", AK: "신동", AJ: "O" });
  legacy(11, G, "2026-10-02", { staff: S[2], T: 20000, X: 10000, G: "X", H: "O", AK: "x 인단독" });
  m.cell(9, L("O")).note = "스팟3 3만";
  // 신규 판매 (간편등록)
  await register(
    report(A.name, A.ctn, { date: "10.03", staff: S[0], use: "ㄴ추가지원금 : 5만\nㄴ고혜(요금) : 2만\n", extra: "중고폰&현물 판매 : S23\nㄴ판매금액 : 30만\nㄴ사용금액 : 10만\n동판 : 약동\n제카 : 우리\n" }),
    report(B.name, B.ctn, { date: "10.04", staff: S[1], use: "ㄴ고혜(기존할부금) : 3만\n", benefit: "8만" }),
    report(C.name, C.ctn, { date: "10.05", staff: S[2], category: "UMNP", benefit: "3만" }),
    report(D.name, D.ctn, { date: "10.06", staff: S[0], benefit: "10만", extra: "제카 : 국민\n" }),
    report(H.name, H.ctn, { date: "10.06", staff: S[1] }),
  );
  // 수정·완료·삭제 (신규·기존 섞어서)
  let sales = await list();
  await edit(byName(sales, B.name), { customerBenefit: "90000", usedExtraSupport: "15000" });
  await markDone(byName(await list(), A.name), "inspected");
  await markDone(byName(await list(), A.name), "paid");
  await markDone(byName(await list(), G.name), "inspected");
  await edit(byName(await list(), F.name), { usedExtraSupport: "45000" });
  await cardCheck(byName(await list(), D.name));
  await deleteSale(byName(await list(), H.name));
  sales = await list();

  const strip = (s: SheetSale) => ({ row: s.row, no: s.no, activatedAt: s.activatedAt, staff: s.staff, category: s.category });
  const filters = ["pending", "all", "inspect", "paid", "both", "done"] as const;
  const spot = buildSpotReport(sales);
  const out = {
    count: sales.length,
    rows: sales.map(strip),
    budget: calculateBudget(sales),
    usage: Object.fromEntries((["customerBenefit", "extraSupport", "secured", "cash"] as const).map((k) => {
      const rows = budgetUsageRows(sales, k);
      return [k, { n: rows.length, total: rows.reduce((t, r) => t + r.amount, 0), rows: rows.map((r) => [r.sale.row, r.amount]) }];
    })),
    staff: aggregateStaffPerformance(sales, staffOrderOf(sales)),
    inspection: Object.fromEntries(filters.map((f) => [f, sales.filter((s) => matchFilter(inspectionStatus(s), f)).map((s) => s.row)])),
    dongpan: sales.map((s) => [s.row, s.dongpan]),
    customers: summarizeCustomers(customerBase(sales)),
    spot: { noteTotal: spot.noteTotal, oTotal: spot.oTotal, spots: spot.spots.map((x) => [x.spot, x.count, x.amount]), problems: spot.problems.length },
    card: sales.filter(isCardTarget).map((s) => [s.row, s.cardType, s.cardChecked]),
    row8: ["N", "O", "P", "Q", "R", "S", "T", "U", "V", "W", "X", "Y", "Z", "AA", "AB", "AC", "AH"].map((c) => [c, m.value(8, L(c))]),
  };
  writeFileSync(process.env.COMPARE_OUT ?? "compare-out.json", JSON.stringify(out, null, 1));
});
