/*
 * 판매 고유 ID(C열 셀 메모) 보존 · 판매연결이 다른 판매에 붙지 않는지 · 목표 0/미설정 · 달에 걸친 주 — 가짜 데이터만.
 *
 * 장표 직접 조작(행 이동·정렬·삽입·삭제·복사·값만 붙여넣기)은 가짜 시트의 셀(값·수식·메모)을 구글 시트처럼 옮겨 흉내 낸다:
 *   - 정렬·행 끌어 옮기기·삽입·삭제: 셀 메모가 셀과 함께 움직임 (구글 시트 동작)
 *   - 값만 붙여넣기: 메모는 그 자리에 남고 값만 옮겨짐
 * "예전 버전" = 지금 운영 Apps Script 와 같은 main 0db45c4 의 .gs (fixtures/apps-script-0db45c4).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { setup, connect, signIn, register, report, list, byName, edit, deleteSale, target, authed } from "../harness/web.ts";
import { makeGas } from "../harness/gas.ts";
import { PEOPLE } from "../harness/fake-people.ts";
import { colNum as L } from "../harness/formula.ts";
import type { FakeSpreadsheet, FakeSheet, Cell } from "../harness/fake-spreadsheet.ts";
import { POST as linkPOST } from "@/app/api/sales/link/route";
import { POST as updatePOST } from "@/app/api/sales/update/route";
import { GET as boardGET, POST as boardPOST } from "@/app/api/goals/board/route";
import { GET as goalsGET, POST as goalsPOST } from "@/app/api/goals/route";
import { inflowOf } from "@/lib/sale-link";
import { countMetrics, PRODUCT_METRIC_KEYS } from "@/lib/product-metrics";
import { aggregateStaffPerformance } from "@/lib/staff-performance";
import { inRange, weekPeriod } from "@/lib/sales-analysis";
import { salesAcrossMonths, nextMonth, sheetForMonth } from "@/lib/month-sheet";
import { parseSheetRow, type SheetSale } from "@/lib/sheet-record";
import { staffIdForName } from "@/lib/data/staff-list";

const [A, B, C, D, E] = PEOPLE;
const OLD_DIR = path.resolve(import.meta.dirname, "../fixtures/apps-script-0db45c4");
const json = (r: Response) => r.json() as Promise<Record<string, unknown>>;
const post = (h: (r: Request) => Promise<Response>, body: unknown) => h(authed("/api", { method: "POST", body: JSON.stringify(body) })).then(json);
const get = (h: (r: Request) => Promise<Response>, url: string) => h(authed(url)).then(json);
const ID_LINE = /웹앱판매ID: ([0-9a-f-]{36})/;

/** 같은 가짜 스프레드시트에서 Apps Script 버전 바꾸기 (old = 지금 운영과 같은 main 0db45c4) */
function useVersion(ss: FakeSpreadsheet, version: "old" | "new") {
  const gas = makeGas(ss, version === "old" ? { dir: OLD_DIR } : {});
  connect(gas);
  signIn(gas);
  return gas;
}

/* 구글 시트 직접 조작 흉내 */
const cloneCell = (c: Cell): Cell => ({ ...c });
function moveRow(sheet: FakeSheet, from: number, to: number) {
  sheet.cell(Math.max(from, to), 1);
  const [row] = sheet.rows.splice(from - 1, 1);
  sheet.rows.splice(to - 1, 0, row);
}
function insertRowAt(sheet: FakeSheet, r: number) {
  sheet.rows.splice(r - 1, 0, []);
}
function deleteRowAt(sheet: FakeSheet, r: number) {
  sheet.rows.splice(r - 1, 1);
}
function copyRowWithNotes(sheet: FakeSheet, from: number, to: number) {
  for (let c = 1; c <= 38; c++) Object.assign(sheet.cell(to, c), cloneCell(sheet.cell(from, c)));
}
/** 값만 붙여넣기로 from → to 옮기고 from 값은 지움 (메모는 각자 자리에 남음) */
function moveValuesOnly(sheet: FakeSheet, from: number, to: number) {
  for (let c = 1; c <= 38; c++) {
    const src = sheet.cell(from, c);
    const dst = sheet.cell(to, c);
    dst.value = src.value;
    dst.formula = src.formula;
    src.value = "";
    src.formula = "";
  }
}
const idOfRow = (sheet: FakeSheet, row: number) => ID_LINE.exec(sheet.cell(row, L("C")).note)?.[1] ?? "";
const saveLink = (s: SheetSale, patches: unknown[], extra: Record<string, unknown> = {}) =>
  post(linkPOST, { target: target(s), saleId: s.saleId ?? "", staff: s.staff, patches, ...extra });

/** 판매(고객명) → 유입경로 표 */
async function inflowMap(): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const s of await list()) if (s.customer) out[s.customer] = s.saleIdState === "ok" ? inflowOf(s) : `(${s.saleIdState ?? "상태없음"})`;
  return out;
}

test("1) 새 판매 저장 → 앱 정렬 → 웹앱 판매 수정(고객명·CTN·다른 칸) 후에도 ID·유입경로 그대로", async () => {
  const { ss } = setup({ slots: 20 });
  await register(report(A.name, A.ctn, { date: "10.08", extra: "유입경로 : 네이버 블로그" }), report(B.name, B.ctn, { date: "10.09", extra: "유입경로 : TM" }));
  const idA = byName(await list(), A.name).saleId!;
  await register(report(C.name, C.ctn, { date: "10.02", extra: "유입경로 : 지인 소개" })); // 앱 정렬로 A·B 가 아래로
  assert.deepEqual(await inflowMap(), { [A.name]: "네이버 블로그", [B.name]: "TM", [C.name]: "지인 소개" });
  const a = byName(await list(), A.name);
  assert.equal(a.saleId, idA);
  // 웹앱 수정: 고객명·CTN·모델명 (C열 개통일은 웹앱 수정 금지)
  const r = await edit(a, { customer: "가짜바뀐이름", ctn: "010-0000-7777", model: "가짜모델" });
  assert.equal(r.ok, true, JSON.stringify(r));
  const a2 = byName(await list(), "가짜바뀐이름");
  assert.equal(a2.saleId, idA);
  assert.equal(a2.saleIdState, "ok", "CTN 을 웹앱으로 고치면 확인값도 함께 바뀜");
  assert.equal(inflowOf(a2), "네이버 블로그");
  assert.match(ss.month().cell(a2.row, L("C")).note, ID_LINE);
  // 개통일(C열)은 웹앱 수정 대상이 아님 → 거부
  const dateEdit = await post(updatePOST, { target: target(a2), changes: [{ col: 2, before: a2.activatedAt, value: "2026-10-20" }] });
  assert.equal(dateEdit.ok, false);
});

test("2) 장표에서 직접 행 이동·정렬(메모가 함께 움직임)·행 삽입·행 삭제 → 판매를 따라감", async () => {
  const { ss } = setup({ slots: 20 });
  await register(
    report(A.name, A.ctn, { date: "10.03", extra: "유입경로 : 네이버 플레이스" }),
    report(B.name, B.ctn, { date: "10.04", extra: "유입경로 : 인스타그램" }),
    report(C.name, C.ctn, { date: "10.05", extra: "유입경로 : 매장 문자" }),
  );
  const sheet = ss.month();
  const want = { [A.name]: "네이버 플레이스", [B.name]: "인스타그램", [C.name]: "매장 문자" };
  const rows = Object.fromEntries((await list()).map((s) => [s.customer, s.row]));
  moveRow(sheet, rows[C.name], rows[A.name]); // C 를 맨 위로 끌어 옮김
  assert.deepEqual(await inflowMap(), want);
  moveRow(sheet, rows[A.name], rows[C.name]); // 반대로 (정렬과 같은 효과)
  assert.deepEqual(await inflowMap(), want);
  insertRowAt(sheet, rows[A.name]); // 판매들 위에 빈 행 삽입 → 모두 한 칸 아래로
  assert.deepEqual(await inflowMap(), want);
  const now = Object.fromEntries((await list()).map((s) => [s.customer, s.row]));
  deleteRowAt(sheet, now[A.name] - 1); // 삽입했던 빈 행 삭제
  assert.deepEqual(await inflowMap(), want);
  // 판매 하나의 행을 통째로 삭제 → 그 판매만 사라지고 나머지는 그대로
  const after = Object.fromEntries((await list()).map((s) => [s.customer, s.row]));
  deleteRowAt(sheet, after[B.name]);
  assert.deepEqual(await inflowMap(), { [A.name]: "네이버 플레이스", [C.name]: "매장 문자" });
  // 이동 후에도 웹앱 저장·수정 정상
  const c = byName(await list(), C.name);
  assert.equal((await saveLink(c, [{ field: "campaign", before: "", value: "주말특가" }])).ok, true);
  assert.equal(byName(await list(), C.name).link?.campaign, "주말특가");
});

test("3) 행 복사(메모 포함) → 두 행 모두 'ID 중복', 연결 정보·저장 모두 막힘", async () => {
  const { ss } = setup({ slots: 20 });
  await register(report(A.name, A.ctn, { extra: "유입경로 : TM" }));
  const a = byName(await list(), A.name);
  copyRowWithNotes(ss.month(), a.row, a.row + 3);
  const twins = (await list()).filter((s) => s.customer === A.name);
  assert.equal(twins.length, 2);
  for (const t of twins) {
    assert.equal(t.saleIdState, "duplicate");
    assert.equal(t.link, undefined);
    const r = await saveLink(t, [{ field: "inflow", before: "", value: "기타" }]);
    assert.equal(r.ok, false);
  }
});

test("4) 값만 붙여넣기로 판매 내용과 메모(ID)가 엇갈리면 → 확인 필요(mismatch), 다른 판매의 유입경로를 붙이지 않음 / 다시 연결은 새 ID", async () => {
  const { ss } = setup({ slots: 20 });
  await register(report(A.name, A.ctn, { date: "10.03", extra: "유입경로 : 네이버 블로그" }), report(B.name, B.ctn, { date: "10.04", extra: "유입경로 : 외부영업" }));
  const sheet = ss.month();
  const a = byName(await list(), A.name);
  const b = byName(await list(), B.name);
  const idA = a.saleId!;
  // A 칸에 B 의 값만 붙여넣고(메모는 A 의 ID 그대로), B 자리는 비움
  moveValuesOnly(sheet, b.row, a.row);
  const sales = await list();
  const moved = byName(sales, B.name);
  assert.equal(moved.row, a.row);
  assert.equal(moved.saleId, idA);
  assert.equal(moved.saleIdState, "mismatch", "A 의 ID 가 B 판매 행에 남음 → 확인 필요");
  assert.equal(moved.link, undefined, "A 의 유입경로(네이버 블로그)가 B 에 붙지 않음");
  // 저장은 거부, relink 로만 새 ID (예전 기록은 옮기지 않음)
  const refused = await saveLink(moved, [{ field: "inflow", before: "", value: "TM" }]);
  assert.equal(refused.ok, false);
  assert.equal(refused.code, "mismatch");
  const re = await saveLink(moved, [{ field: "inflow", before: "", value: "외부영업" }], { relink: true });
  assert.equal(re.ok, true, JSON.stringify(re));
  assert.notEqual(re.saleId, idA);
  const fixed = byName(await list(), B.name);
  assert.equal(fixed.saleIdState, "ok");
  assert.equal(inflowOf(fixed), "외부영업");
  assert.notEqual(idOfRow(sheet, fixed.row), idA);
  // 확인 필요가 아닌 판매에 relink 를 보내면 거부
  assert.equal((await saveLink(fixed, [{ field: "campaign", before: "", value: "x" }], { relink: true })).ok, false);
});

test("5) 장표에서 CTN·개통일을 직접 고치면 확인 필요 (웹앱 수정은 그대로 유지) / 고객명만 직접 고치면 그대로", async () => {
  const { ss } = setup({ slots: 20 });
  await register(report(A.name, A.ctn, { extra: "유입경로 : 자연 방문" }), report(B.name, B.ctn, { extra: "유입경로 : KT 안내" }), report(C.name, C.ctn, { extra: "유입경로 : 기타" }));
  const sheet = ss.month();
  const sales = await list();
  sheet.cell(byName(sales, A.name).row, L("E")).value = "010-0000-1212"; // CTN 직접 수정
  sheet.cell(byName(sales, B.name).row, L("C")).value = new Date(Date.UTC(2026, 9, 21) - 9 * 3600_000); // 개통일 직접 수정
  sheet.cell(byName(sales, C.name).row, L("D")).value = "가짜고객명수정"; // 고객명 직접 수정
  const after = await list();
  assert.equal(byName(after, A.name).saleIdState, "mismatch");
  assert.equal(byName(after, B.name).saleIdState, "mismatch");
  const c = byName(after, "가짜고객명수정");
  assert.equal(c.saleIdState, "ok");
  assert.equal(inflowOf(c), "기타");
});

test("6) 예전 버전(운영과 같은 main)으로 되돌려 등록·정렬·수정·삭제 → 다시 새 버전: ID·유입경로가 다른 판매에 붙지 않음", async () => {
  const { ss } = setup({ slots: 25 });
  // 새 버전에서 등록
  await register(
    report(A.name, A.ctn, { date: "10.06", extra: "유입경로 : 네이버 블로그" }),
    report(B.name, B.ctn, { date: "10.07", extra: "유입경로 : TM" }),
    report(C.name, C.ctn, { date: "10.08", extra: "유입경로 : 지인 소개" }),
  );
  const before = Object.fromEntries((await list()).map((s) => [s.customer, s.saleId]));
  // 예전 버전으로 되돌림
  useVersion(ss, "old");
  // 예전 버전 등록 (더 이른 날짜 → 예전 버전의 정렬이 A·B·C 를 아래로 옮김) + 같은 날 한 건 더
  const reg = await register(report(D.name, D.ctn, { date: "10.01" }), report(E.name, E.ctn, { date: "10.07" }));
  assert.ok((reg.results as { ok: boolean }[]).every((x) => x.ok));
  // 예전 버전 수정 (고객명 변경) · 삭제 (C)
  const oldList = await list();
  assert.equal(byName(oldList, A.name).saleId, undefined, "예전 버전은 판매 ID 를 모름");
  assert.equal((await edit(byName(oldList, B.name), { customer: "가짜B개명", model: "가짜모델2" })).ok, true);
  assert.equal((await deleteSale(byName(oldList, C.name))).ok, true);
  // 예전 버전 등록이 C 가 지워진 빈 자리에 들어가도록 한 건 더
  await register(report("가짜새판매", "010-0000-4545", { date: "10.08" }));
  // 다시 새 버전
  useVersion(ss, "new");
  const sales = await list();
  const a = byName(sales, A.name);
  const b = byName(sales, "가짜B개명");
  assert.equal(a.saleId, before[A.name], "예전 버전 정렬 후에도 A 의 ID 유지");
  assert.equal(inflowOf(a), "네이버 블로그");
  assert.equal(b.saleId, before[B.name], "예전 버전에서 고객명을 바꿔도 ID 유지");
  assert.equal(inflowOf(b), "TM");
  for (const name of [D.name, E.name, "가짜새판매"]) {
    const s = byName(sales, name);
    assert.ok(s.saleIdState === "none" || s.saleIdState === "mismatch", `${name}: ${s.saleIdState}`);
    assert.equal(s.link, undefined, `${name} 에 다른 판매의 유입경로가 붙지 않음`);
  }
  // C 의 ID 가 어디에도 "ok" 로 붙어 있지 않음
  assert.ok(!sales.some((s) => s.saleId === before[C.name] && s.saleIdState === "ok"));
  // 새 버전에서 예전 판매에 유입경로 저장 → 그 행에만 새 ID
  const d = byName(sales, D.name);
  const saved = await saveLink(d, [{ field: "inflow", before: "", value: "자연 방문" }], d.saleIdState === "mismatch" ? { relink: true } : {});
  assert.equal(saved.ok, true, JSON.stringify(saved));
  assert.equal(inflowOf(byName(await list(), D.name)), "자연 방문");
  assert.equal(inflowOf(byName(await list(), A.name)), "네이버 블로그");
});

test("7) 예전 버전에서 CTN 을 고치면(확인값 갱신 안 됨) → 새 버전에서 확인 필요로 막힘 (잘못 연결되지 않는 쪽)", async () => {
  const { ss } = setup({ slots: 20 });
  await register(report(A.name, A.ctn, { extra: "유입경로 : 인스타그램" }));
  useVersion(ss, "old");
  assert.equal((await edit(byName(await list(), A.name), { ctn: "010-0000-3434" })).ok, true);
  useVersion(ss, "new");
  const a = byName(await list(), A.name);
  assert.equal(a.saleIdState, "mismatch");
  assert.equal(a.link, undefined);
});

/* ---------- 목표: 0 과 미설정, 단일 매장 후불 목표, 전월 불러오기 ---------- */

test("8) 목표 0 과 미설정: 저장·조회·이력에서 구분, 0 은 삭제가 아님 / 매장 후불은 예산관리와 항상 같은 값 / 조회(전월 불러오기)는 아무것도 쓰지 않음", async () => {
  const { ss, gas } = setup();
  const month = "2026-10";
  const yun = staffIdForName("윤기석")!;
  const set = (items: unknown[]) => post(boardPOST, { month, items });
  const goals = async (m = month) => ((await get(boardGET, `/api/goals/board?month=${m}`)).goals as { scope: string; staffId: string; metric: string; value: number }[]);
  assert.equal((await set([{ scope: "staff", staffId: yun, staffName: "윤기석", metric: "card", before: null, value: 0 }])).ok, true);
  let g = (await goals()).find((x) => x.metric === "card");
  assert.equal(g?.value, 0, "0 은 목표 0건으로 남음 (미설정과 다름)");
  assert.equal((await set([{ scope: "staff", staffId: yun, staffName: "윤기석", metric: "card", before: 0, value: null }])).ok, true);
  g = (await goals()).find((x) => x.metric === "card");
  assert.equal(g, undefined, "미설정");
  const history = (await get(boardGET, `/api/goals/board?month=${month}`)).history as { metric: string; before: number | null; after: number | null }[];
  const card = history.filter((h) => h.metric === "card");
  assert.deepEqual(card.map((h) => [h.before, h.after]).sort(), [[0, null], [null, 0]].sort());
  // 매장 후불 0 도 예산관리 화면에서 0 으로 (미설정 아님)
  assert.equal((await set([{ scope: "store", staffId: "", staffName: "", metric: "postpaid", before: null, value: 0 }])).ok, true);
  assert.equal((await get(goalsGET, `/api/goals?month=${month}`)).goal, 0);
  assert.equal((await post(goalsPOST, { month, goal: 55 })).ok, true);
  assert.equal((await goals()).find((x) => x.scope === "store" && x.metric === "postpaid")?.value, 55);
  // 전월 불러오기 = 조회만: 시트·스크립트 속성이 바뀌지 않음
  const writesBefore = [...ss.sheets.values()].map((s) => s.writes.length).join(",");
  const propsBefore = JSON.stringify([...gas.props.entries()].filter(([k]) => k.startsWith("WIRELESS_GOAL")));
  await goals("2026-09");
  await goals("2026-08");
  assert.equal([...ss.sheets.values()].map((s) => s.writes.length).join(","), writesBefore);
  assert.equal(JSON.stringify([...gas.props.entries()].filter(([k]) => k.startsWith("WIRELESS_GOAL"))), propsBefore);
  // 연도가 다른 같은 달은 섞이지 않음
  assert.deepEqual(await goals("2025-10"), []);
});

test("9) UMNP 는 후불이 아님: 직원 실적관리 UMNP 칸 그대로, 목표 지표에 UMNP 없음", () => {
  const mk = (cat: string, staff: string) => {
    const v = new Array(38).fill("");
    v[2] = "2026-10-05"; v[8] = cat; v[12] = staff;
    return parseSheetRow(9, "1", v);
  };
  const sales = [mk("UMNP", "이호준"), mk("기기변경", "이호준"), mk("UMNP", "윤기석")];
  const c = countMetrics(sales);
  assert.deepEqual([c.sales, c.postpaid, c.umnp], [3, 1, 2]);
  assert.ok(!(PRODUCT_METRIC_KEYS as readonly string[]).includes("umnp"));
  const perf = aggregateStaffPerformance(sales, ["윤기석", "이호준"]);
  assert.deepEqual(perf.rows.map((r) => [r.staff, r.postpaid, r.umnp]), [["윤기석", 0, 1], ["이호준", 1, 1]]);
});

/* ---------- 달에 걸친 주 ---------- */

test("10) 월말·월초에 걸친 주(월~일): 두 달 장표 판매를 한 번씩 정확히 합산 / 다른 연도 시트와 섞지 않음", () => {
  const mk = (date: string, name: string) => {
    const v = new Array(38).fill("");
    v[2] = date; v[3] = name; v[8] = "기기변경"; v[12] = "윤기석";
    return parseSheetRow(9, "1", v);
  };
  const oct = [mk("2026-10-25", "가짜1"), mk("2026-10-26", "가짜2"), mk("2026-10-31", "가짜3")];
  const nov = [mk("2026-11-01", "가짜4"), mk("2026-11-02", "가짜5")];
  const week = weekPeriod("2026-10-28"); // 10-26(월) ~ 11-01(일)
  assert.deepEqual([week.start, week.end], ["2026-10-26", "2026-11-01"]);
  const both = inRange(salesAcrossMonths(oct, nov), week.start, week.end);
  assert.deepEqual(both.map((s) => s.customer), ["가짜2", "가짜3", "가짜4"]);
  assert.equal(inRange(salesAcrossMonths(oct), week.start, week.end).length, 2, "10월만 불러오면 10월분만");
  assert.equal(inRange(salesAcrossMonths(oct, null, nov), week.start, week.end).length, 3);
  // 11월(올해) 화면의 다음 달은 12월 시트 — 12월은 아직 안 온 달이라 작년 12월 시트를 섞지 않음
  assert.equal(nextMonth("2026-11"), "2026-12");
  assert.equal(sheetForMonth("2026-12", "2026-11-14"), null);
  assert.equal(sheetForMonth("2026-10", "2026-11-14"), "10월");
});

test("11) 검수관리 동판 필터: 공용 기준과 같음 (접두 포함, 오타는 확인 필요) / 검수·수납 상태 판정은 그대로", async () => {
  const { dongpanKind, dongpanCheckNeeded, DONGPAN_KINDS } = await import("@/lib/dongpan");
  const { dongpanType } = await import("@/lib/product-metrics");
  const { inspectionStatus } = await import("@/lib/inspection-status");
  const values = ["순동", "약동-18만원", "순동-58만원(코스제외)", "신동(메모)", "약돈-네이버페이23", "X", "미사용", "당월 재방문(인)", " 약동 "];
  for (const v of values) {
    assert.equal(dongpanKind({ dongpan: v }), dongpanType(v), v);
  }
  assert.deepEqual([...DONGPAN_KINDS], ["순동", "신동", "약동"]);
  assert.equal(dongpanKind({ dongpan: "약동-18만원" }), "약동");
  assert.equal(dongpanKind({ dongpan: "약돈-네이버페이23" }), null);
  assert.equal(dongpanCheckNeeded({ dongpan: "약돈-네이버페이23" }), true);
  assert.equal(dongpanCheckNeeded({ dongpan: "미사용" }), false);
  // 동판 값이 무엇이든 검수·수납 상태는 G·H열로만 정해짐
  const mk = (g: string, h: string, ak: string) => {
    const v = new Array(38).fill("");
    v[2] = "2026-10-05"; v[6] = g; v[7] = h; v[36] = ak;
    return parseSheetRow(9, "1", v);
  };
  for (const ak of ["약동-18만원", "약돈", "X"]) {
    assert.equal(inspectionStatus(mk("O", "O", ak)), inspectionStatus(mk("O", "O", "X")));
    assert.equal(inspectionStatus(mk("", "O", ak)), inspectionStatus(mk("", "O", "X")));
  }
});
