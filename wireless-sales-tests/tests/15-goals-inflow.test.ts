/*
 * 목표관리 · 고객 유입경로 · 판매 고유 ID · 상품 지표 공용 기준 (2026-11-13 확정 기준) — 가짜 데이터만.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { setup, register, report, list, byName, deleteSale, target, authed } from "../harness/web.ts";
import { PEOPLE } from "../harness/fake-people.ts";
import { colNum as L } from "../harness/formula.ts";
import { parseQuickReports, normalizeQuick, STAFF_REPORT_TEMPLATE, NOTE_FIELDS, emptyQuickFields } from "@/lib/quick-report";
import { countMetrics, saleMetrics, dongpanType, dongpanNeedsCheck, PRODUCT_METRIC_KEYS } from "@/lib/product-metrics";
import { aggregateStaffPerformance } from "@/lib/staff-performance";
import { parseSheetRow, type SheetSale } from "@/lib/sheet-record";
import { INFLOW_SOURCES, parseInflow, inflowOf, linkValueError, emptyLink } from "@/lib/sale-link";
import { achievement, parseGoalInput, parseGoalChange } from "@/lib/goals";
import { monthForSheet, sheetForMonth, previousMonth } from "@/lib/month-sheet";
import { readFileSync } from "node:fs";
import path from "node:path";
import { inflowRows, inflowInputRate, metricByInflow, weekStart, budgetTotals, campaignRows } from "@/lib/sales-analysis";
import { staffIdForName, STAFF } from "@/lib/data/staff-list";
import { POST as linkPOST } from "@/app/api/sales/link/route";
import { GET as boardGET, POST as boardPOST } from "@/app/api/goals/board/route";
import { GET as goalsGET, POST as goalsPOST } from "@/app/api/goals/route";

const [A, B, C, D] = PEOPLE;
const json = (r: Response) => r.json() as Promise<Record<string, unknown>>;
const post = (h: (r: Request) => Promise<Response>, body: unknown) => h(authed("/api", { method: "POST", body: JSON.stringify(body) })).then(json);
const get = (h: (r: Request) => Promise<Response>, url: string) => h(authed(url)).then(json);
const ID_LINE = /^웹앱판매ID: [0-9a-f-]{36}$/m;
const ctx = { today: "2026-10-13", staffNames: ["김수현", "윤기석", "이호준"] };

/** 가짜 판매 1건 (장표 행 → 화면 판매) */
function sale(over: Partial<Record<string, string>> & { notes?: Record<string, string>; goodbye?: string } = {}): SheetSale {
  const values = new Array(38).fill("");
  const set = (letter: string, v: string) => { values[L(letter) - 1] = v; };
  set("C", over.date ?? "2026-10-05"); set("D", "가짜고객"); set("E", "010-0000-0000"); set("I", over.category ?? "기기변경");
  set("K", over.plan ?? "베이직"); set("M", over.staff ?? "윤기석"); set("AD", over.second ?? "X"); set("AE", over.jeca ?? "X");
  set("AK", over.dongpan ?? "X"); set("F", over.exclude ?? "X"); set("Z", over.usedPhoneSale ?? "0"); set("AB", over.usedPhoneRemaining ?? "0");
  const s = parseSheetRow(9, "1", values);
  if (over.notes) s.notes = over.notes;
  if (over.goodbye !== undefined) s.link = { ...emptyLink(), goodbye: over.goodbye };
  return s;
}

/* ---------- 1. 상품 지표 ---------- */

test("1) 지표 기준: 초스·스초 모두 1건(중복 없음) / 동판은 순동·신동·약동으로 시작 / 오타는 확인 필요만 / 디초는 보고 O 만 / 굿바이는 O 만 (중고폰 금액 무관) / F열 O 포함", () => {
  assert.equal(saleMetrics(sale({ plan: "110유튜브 초스" })).scho, true);
  assert.equal(saleMetrics(sale({ plan: "유튜브 스초" })).scho, true);
  assert.equal(countMetrics([sale({ plan: "스초 초스 더블" })]).scho, 1, "두 표현이 함께 있어도 1건");
  assert.equal(saleMetrics(sale({ plan: "베이직" })).scho, false);

  assert.equal(dongpanType("약동-18만원"), "약동");
  assert.equal(dongpanType("순동-58만원(코스제외)"), "순동");
  assert.equal(dongpanType("신동"), "신동");
  assert.equal(dongpanType("약돈-네이버페이23"), null);
  assert.equal(dongpanNeedsCheck("약돈-네이버페이23"), true);
  for (const v of ["X", "미사용", "당월 재방문(인)", "인터넷 미사용", "biz tv 사용고객", "sk만기확인중", ""]) {
    assert.equal(dongpanType(v), null, v);
    assert.equal(dongpanNeedsCheck(v), false, v);
  }
  const c = countMetrics([sale({ dongpan: "약동-18만원" }), sale({ dongpan: "순동" }), sale({ dongpan: "신동(메모)" }), sale({ dongpan: "약돈" })]);
  assert.equal(c.dongpan, 3);
  assert.deepEqual(c.dongpanByType, { 순동: 1, 신동: 1, 약동: 1 });
  assert.equal(c.dongpanCheck, 1);

  assert.equal(saleMetrics(sale({ notes: { dicho: "O" } })).dicho, true);
  assert.equal(saleMetrics(sale({ notes: { dicho: "o " } })).dicho, true);
  for (const v of ["5만", "X", "디초", ""]) assert.equal(saleMetrics(sale({ notes: { dicho: v } })).dicho, false, v);
  assert.equal(saleMetrics(sale()).dicho, false, "P·X열 금액이 있어도 보고 O 가 없으면 아님");

  assert.equal(saleMetrics(sale({ goodbye: "O" })).goodbye, true);
  assert.equal(saleMetrics(sale({ goodbye: "X" })).goodbye, false);
  assert.equal(saleMetrics(sale({ usedPhoneSale: "300000", usedPhoneRemaining: "100000" })).goodbye, false, "중고폰 금액으로는 인정 안 함");

  assert.equal(countMetrics([sale({ exclude: "O" })]).postpaid, 1, "실력지표제외 O 도 포함");
  const mix = countMetrics([sale({ category: "번호이동", plan: "스초", second: "O", jeca: "O" }), sale({ category: "UMNP" })]);
  assert.deepEqual([mix.sales, mix.postpaid, mix.portIn, mix.umnp, mix.scho, mix.second, mix.card], [2, 1, 1, 1, 1, 1, 1]);
  assert.ok(mix.postpaid + mix.portIn + mix.scho + mix.second + mix.card > mix.sales, "지표끼리 더하면 개통보다 커짐 → 개통은 판매 행 수로만");
});

test("2) 직원 실적관리도 같은 기준: 기준 변경 전후 차이 (가짜 판매 — 실제 11월 장표 표기와 같은 모양)", () => {
  const sales = [
    sale({ staff: "이호준", plan: "110유튜브 초스" }), // 예전 기준: 스초 아님 → 새 기준: 스초
    sale({ staff: "이호준", plan: "유튜브 스초" }),
    sale({ staff: "윤기석", dongpan: "약동-18만원" }), // 예전: 동판 아님 → 새: 동판
    sale({ staff: "윤기석", dongpan: "순동-58만원(코스제외)" }), // 예전: 아님 → 새: 동판
    sale({ staff: "윤기석", dongpan: "약동" }),
    sale({ staff: "윤기석", dongpan: "약돈-네이버페이23" }), // 둘 다 아님, 새 기준: 동판확인 1
  ];
  const { rows } = aggregateStaffPerformance(sales, ["윤기석", "이호준"]);
  const yun = rows.find((r) => r.staff === "윤기석")!;
  const lee = rows.find((r) => r.staff === "이호준")!;
  assert.equal(lee.scho, 2);
  assert.equal(yun.dongpan, 3);
  assert.equal(yun.dongpanCheck, 1);
  const metric = countMetrics(sales);
  assert.equal(metric.scho, lee.scho + yun.scho, "목표관리·분석과 같은 숫자");
  assert.equal(metric.dongpan, lee.dongpan + yun.dongpan);
});

/* ---------- 2. 간편등록 유입경로·캠페인·굿바이 ---------- */

test("3) 카톡 보고: '유입경로 : 블로그' → 네이버 블로그 / 모르는 표현은 추정하지 않고 확인 필요 / 줄이 없어도 등록 가능 / 웹앱참고(참고내용)에는 넣지 않음", () => {
  assert.ok(STAFF_REPORT_TEMPLATE.includes("유입경로 : ") && STAFF_REPORT_TEMPLATE.includes("캠페인 : ") && STAFF_REPORT_TEMPLATE.includes("굿바이 : "));
  assert.ok(NOTE_FIELDS.every((f) => !["inflow", "campaign", "goodbye"].includes(f.id)));
  const base = ["개통일자 : 10.05", "직원명 : 윤기석", `고객명 : ${A.name}`, `CTN : ${A.ctn}`, "개통구분 : 기변", "모델명 : 테스트폰", "요금제 : 베이직", "ㄴ유지/변경 : 유지"];
  const n = (extra: string[]) => normalizeQuick(parseQuickReports([...base, ...extra].join("\n"))[0].fields, ctx);
  const ok = n(["유입경로 : 블로그", "캠페인 : 주말특가", "굿바이 : o"]);
  assert.deepEqual(ok.issues, []);
  assert.deepEqual(ok.link, { inflow: "네이버 블로그", campaign: "주말특가", goodbye: "O" });
  assert.ok(!("inflow" in ok.notes) && !("campaign" in ok.notes) && !("goodbye" in ok.notes));
  const none = n([]);
  assert.deepEqual(none.issues, []);
  assert.deepEqual(none.link, { inflow: "", campaign: "", goodbye: "" });
  const bad = n(["유입경로 : 전단지 보고", "굿바이 : 보상", `캠페인 : ${"가".repeat(41)}`]);
  assert.deepEqual(bad.issues.map((i) => i.field).sort(), ["campaign", "goodbye", "inflow"]);
  assert.equal(bad.link.inflow, "");
  for (const s of INFLOW_SOURCES) assert.equal(parseInflow(s), s, s);
  assert.equal(parseInflow("인스타"), "인스타그램");
  assert.equal(parseInflow("쓰레드"), "스레드");
  assert.equal(parseInflow("모름"), "미확인");
  assert.equal(parseInflow("유튜브"), null);
  assert.equal(emptyQuickFields().inflow, "");
});

/* ---------- 3. 판매 고유 ID · 판매연결 저장 ---------- */

test("4) 새 판매: C열 메모에 판매 ID, 판매연결은 ID 로 저장 / 보조 시트 숨김·고객 이름·번호 없음 / 다른 판매 메모 보존", async () => {
  const { ss } = setup();
  ss.month().cell(12, L("C")).note = "점장 메모: 확인할 것"; // 빈 자리에 있던 사람 메모
  const r = await register(report(A.name, A.ctn, { extra: "유입경로 : 네이버 플레이스\n캠페인 : 아이폰 사전예약\n굿바이 : O" }), report(B.name, B.ctn));
  const results = r.results as { ok: boolean; saleId?: string }[];
  assert.ok(results.every((x) => x.ok && /^[0-9a-f-]{36}$/.test(x.saleId ?? "")));
  assert.notEqual(results[0].saleId, results[1].saleId);
  const a = byName(await list(), A.name);
  const b = byName(await list(), B.name);
  assert.equal(a.saleId, results[0].saleId);
  assert.equal(a.saleIdState, "ok");
  assert.deepEqual({ ...a.link }, { inflow: "네이버 플레이스", campaign: "아이폰 사전예약", goodbye: "O", prospectId: "", tmStaffId: "", staffId: staffIdForName(a.staff) });
  // 아무것도 적지 않은 새 판매: 판매 직원 ID 만 기록 (향후 연동용), 유입경로는 미입력
  assert.deepEqual({ ...b.link }, { ...emptyLink(), staffId: staffIdForName(b.staff) });
  assert.equal(inflowOf(b), "미입력");
  assert.match(ss.month().cell(a.row, L("C")).note, ID_LINE);
  const linkSheet = ss.getSheetByName("웹앱판매연결")!;
  assert.equal(linkSheet.hidden, true);
  const text = JSON.stringify(linkSheet.rows.map((row) => row.map((c) => c.value)));
  assert.ok(!text.includes(A.name) && !text.includes(A.ctn.replace(/\D/g, "").slice(-4)), "고객 이름·번호 없음");
  assert.ok(!JSON.stringify(ss.getSheetByName("웹앱참고")?.rows.map((row) => row.map((c) => c.value)) ?? []).includes("네이버 플레이스"), "웹앱참고에는 저장 안 함");
});

test("5) 정렬로 판매가 다른 행으로 밀려도 ID·판매연결이 판매를 따라감 / 같은 날 같은 고객·CTN 판매 2건도 각각 구분", async () => {
  setup();
  await register(report(A.name, A.ctn, { date: "10.07", extra: "유입경로 : 인스타그램" }));
  const a1 = byName(await list(), A.name);
  await register(report(B.name, B.ctn, { date: "10.03", extra: "유입경로 : TM" })); // 더 이른 날짜 → A 가 아래로
  const a2 = byName(await list(), A.name);
  assert.notEqual(a2.row, a1.row);
  assert.equal(a2.saleId, a1.saleId);
  assert.equal(a2.link?.inflow, "인스타그램");
  assert.equal(byName(await list(), B.name).link?.inflow, "TM");

  // 같은 날·같은 고객·같은 CTN 2건 (중복 확인 통과 후 등록)
  setup();
  await register(report(C.name, C.ctn, { extra: "유입경로 : 지인 소개" }), report(C.name, C.ctn, { extra: "유입경로 : 매장 문자" }));
  const twins = (await list()).filter((s) => s.customer === C.name);
  assert.equal(twins.length, 2);
  assert.notEqual(twins[0].saleId, twins[1].saleId);
  assert.deepEqual(twins.map((s) => s.link?.inflow).sort(), ["매장 문자", "지인 소개"]);
  assert.ok(twins.every((s) => s.saleIdState === "ok"));
});

test("6) 판매 상세에서 판매연결 저장: 예전 판매(ID 없음)는 그 행에만 ID 생성 / 화면과 다른 값·다른 행·형식 오류는 거부", async () => {
  const { ss } = setup();
  await register(report(A.name, A.ctn), report(D.name, D.ctn));
  // 예전 판매 흉내: ID 줄을 지움
  const a0 = byName(await list(), A.name);
  ss.month().cell(a0.row, L("C")).note = "";
  const a = byName(await list(), A.name);
  assert.equal(a.saleIdState, "none");
  assert.equal(a.saleId, undefined);
  const save = (s: SheetSale, patches: unknown[], extra: Record<string, unknown> = {}) =>
    post(linkPOST, { target: target(s), saleId: s.saleId ?? "", staff: s.staff, patches, ...extra });
  // 형식 오류 → Apps Script 호출 없이 거부
  assert.equal((await save(a, [{ field: "inflow", before: "", value: "유튜브" }])).ok, false);
  assert.equal((await save(a, [{ field: "goodbye", before: "", value: "Y" }])).ok, false);
  assert.equal((await save(a, [{ field: "customer", before: "", value: "x" }])).ok, false);
  // 행 정보가 다르면 거부 (다른 판매에 붙지 않게)
  assert.equal((await save({ ...a, customer: D.name }, [{ field: "inflow", before: "", value: "TM" }])).ok, false);
  const ok = await save(a, [{ field: "inflow", before: "", value: "자연 방문" }, { field: "campaign", before: "", value: "상가 전단 활동" }]);
  assert.equal(ok.ok, true, JSON.stringify(ok));
  const a2 = byName(await list(), A.name);
  assert.equal(a2.saleId, ok.saleId);
  assert.equal(a2.link?.inflow, "자연 방문");
  assert.equal(a2.link?.campaign, "상가 전단 활동");
  assert.match(ss.month().cell(a2.row, L("C")).note, ID_LINE);
  // 화면에서 본 값(before)이 지금 값과 다르면 거부
  const stale = await save(a2, [{ field: "inflow", before: "", value: "TM" }]);
  assert.equal(stale.ok, false);
  // 화면이 ID 를 모른 채(예전 화면) 저장하려 하면 거부
  assert.equal((await save({ ...a2, saleId: undefined }, [{ field: "inflow", before: "자연 방문", value: "TM" }])).ok, false);
  // 올바른 수정·지우기
  assert.equal((await save(a2, [{ field: "inflow", before: "자연 방문", value: "미확인" }])).ok, true);
  assert.equal(inflowOf(byName(await list(), A.name)), "미확인");
  const d = byName(await list(), D.name);
  assert.equal(d.link?.inflow, "", "다른 판매에는 영향 없음");
  assert.equal(d.link?.campaign, "");
});

test("7) 같은 ID 가 두 행에 있으면(시트에서 행 복사) 둘 다 'ID 중복' — 판매연결을 붙이지도 저장하지도 않음", async () => {
  const { ss } = setup();
  await register(report(A.name, A.ctn, { extra: "유입경로 : 네이버 블로그" }), report(B.name, B.ctn));
  const a = byName(await list(), A.name);
  const b = byName(await list(), B.name);
  ss.month().cell(b.row, L("C")).note = ss.month().cell(a.row, L("C")).note; // 복사된 ID
  const sales = await list();
  for (const s of [byName(sales, A.name), byName(sales, B.name)]) {
    assert.equal(s.saleIdState, "duplicate");
    assert.equal(s.link, undefined);
  }
  const r = await post(linkPOST, { target: target(byName(sales, B.name)), saleId: a.saleId, staff: "", patches: [{ field: "inflow", before: "", value: "TM" }] });
  assert.equal(r.ok, false);
  assert.equal(r.code, "duplicate_id");
});

test("8) 판매 삭제: ID 줄 삭제·판매연결 기록은 삭제 시각만 / 그 자리의 새 판매는 새 ID, 예전 유입경로가 붙지 않음", async () => {
  const { ss } = setup();
  await register(report(A.name, A.ctn, { extra: "유입경로 : 외부영업" }));
  const a = byName(await list(), A.name);
  ss.month().cell(a.row, L("C")).note += ""; // 그대로
  assert.equal((await deleteSale(a)).ok, true);
  assert.doesNotMatch(ss.month().cell(a.row, L("C")).note, ID_LINE);
  const linkRows = ss.getSheetByName("웹앱판매연결")!.rows;
  const rec = linkRows.find((row) => String(row[0]?.value ?? "").includes(a.saleId!))!;
  assert.ok(rec && rec[10].value instanceof Date, "삭제 시각 기록");
  await register(report(B.name, B.ctn, { date: "10.05" }));
  const b = byName(await list(), B.name);
  assert.equal(b.row, a.row);
  assert.notEqual(b.saleId, a.saleId);
  assert.equal(b.link?.inflow, "", "예전 판매의 유입경로가 붙지 않음");
  assert.equal(inflowOf(b), "미입력");
});

test("9) 예전 Apps Script(sale-link.gs 없음)와도 동작: 판매 저장은 그대로, 판매연결은 저장 못 했다고 알림 / 판매연결 저장 API 는 배포 필요 안내", async () => {
  const files = ["common", "save-handler", "update-handler", "delete-handler", "list-handler", "notes", "inspection-review", "goal-handler", "gobulbi", "total-row", "auth-handler"];
  setup({ files });
  const r = await register(report(A.name, A.ctn, { extra: "유입경로 : TM" }), report(B.name, B.ctn));
  const [ra, rb] = r.results as { ok: boolean; warning?: string; saleId?: string }[];
  assert.equal(ra.ok, true);
  assert.match(ra.warning ?? "", /sale-link\.gs/);
  assert.equal(rb.ok, true);
  assert.equal(rb.warning, undefined, "판매연결을 적지 않았으면 알림 없음");
  const a = byName(await list(), A.name);
  assert.equal(a.saleIdState, undefined);
  const s = await post(linkPOST, { target: target(a), saleId: "", staff: "", patches: [{ field: "inflow", before: "", value: "TM" }] });
  assert.equal(s.ok, false);
  assert.match(String(s.message), /sale-link\.gs/);
});

/* ---------- 4. 목표관리 ---------- */

test("10) 목표: 매장 후불은 예산관리 월 목표와 같은 값 / 직원·상품 목표 / 0 과 미설정 구분 / 중복·화면과 다른 값 거부 / 변경 이력(변경 전·후·변경자)", async () => {
  const { ss, gas } = setup();
  const month = "2026-10";
  const board = async () => get(boardGET, `/api/goals/board?month=${month}`);
  assert.deepEqual((await board()).goals, []);
  const yun = staffIdForName("윤기석")!;
  const set = (items: unknown[]) => post(boardPOST, { month, items });
  const r1 = await set([
    { scope: "store", staffId: "", staffName: "", metric: "postpaid", before: null, value: 120 },
    { scope: "store", staffId: "", staffName: "", metric: "scho", before: null, value: 30 },
    { scope: "staff", staffId: yun, staffName: "윤기석", metric: "postpaid", before: null, value: 25 },
    { scope: "staff", staffId: yun, staffName: "윤기석", metric: "goodbye", before: null, value: 0 },
  ]);
  assert.equal(r1.ok, true, JSON.stringify(r1));
  // 예산관리 화면 월 목표와 같은 값
  assert.equal((await get(goalsGET, `/api/goals?month=${month}`)).goal, 120);
  assert.equal(gas.props.get(`WIRELESS_GOAL_${month}`), "120");
  const goals = (await board()).goals as { scope: string; staffId: string; metric: string; value: number }[];
  assert.equal(goals.length, 4);
  assert.equal(goals.find((g) => g.metric === "goodbye")!.value, 0, "0 은 목표 0건으로 저장");
  // 예산관리 화면에서 바꾸면 목표관리에도 같은 값 + 이력
  assert.equal((await post(goalsPOST, { month, goal: 130 })).ok, true);
  assert.equal(((await board()).goals as { metric: string; scope: string; value: number }[]).find((g) => g.scope === "store" && g.metric === "postpaid")!.value, 130);
  // 화면에서 본 값과 다르면 아무것도 바꾸지 않음 (부분 저장 없음)
  const stale = await set([
    { scope: "store", staffId: "", staffName: "", metric: "postpaid", before: 120, value: 140 },
    { scope: "staff", staffId: yun, staffName: "윤기석", metric: "postpaid", before: 25, value: 26 },
  ]);
  assert.equal(stale.ok, false);
  assert.equal(((await board()).goals as { metric: string; scope: string; value: number }[]).find((g) => g.scope === "staff" && g.metric === "postpaid")!.value, 25);
  // 같은 목표 두 번 → 거부
  const dup = await set([
    { scope: "staff", staffId: yun, staffName: "윤기석", metric: "postpaid", before: 25, value: 1 },
    { scope: "staff", staffId: yun, staffName: "윤기석", metric: "postpaid", before: 25, value: 2 },
  ]);
  assert.equal(dup.ok, false);
  // 미설정으로 지우기 + 다시 저장해도 한 줄만
  assert.equal((await set([{ scope: "staff", staffId: yun, staffName: "윤기석", metric: "postpaid", before: 25, value: null }])).ok, true);
  assert.equal((await set([{ scope: "staff", staffId: yun, staffName: "윤기석", metric: "postpaid", before: null, value: 27 }])).ok, true);
  assert.equal((await set([{ scope: "staff", staffId: yun, staffName: "윤기석", metric: "postpaid", before: 27, value: 28 }])).ok, true);
  const goalRows = ss.getSheetByName("웹앱목표")!.rows.slice(1).filter((row) => row.some((c) => c.value !== ""));
  assert.equal(goalRows.filter((row) => String(row[2].value).includes(yun) && row[4].value === "postpaid").length, 1, "중복 줄 없음");
  assert.equal(ss.getSheetByName("웹앱목표")!.hidden, true);
  // 이력
  const history = (await board()).history as { scope: string; metric: string; before: number | null; after: number | null; by: string }[];
  assert.ok(history.some((h) => h.scope === "store" && h.metric === "postpaid" && h.before === 120 && h.after === 130 && h.by === "점장(예산관리)"));
  assert.ok(history.some((h) => h.scope === "staff" && h.before === 25 && h.after === null && h.by === "점장(웹앱)"));
  assert.ok(history.some((h) => h.scope === "staff" && h.before === 27 && h.after === 28));
  // 다른 달과 섞이지 않음
  assert.deepEqual((await get(boardGET, "/api/goals/board?month=2026-09")).goals, []);
  // 입력 검사
  assert.equal((await set([{ scope: "staff", staffId: "윤기석", staffName: "윤기석", metric: "postpaid", before: null, value: 1 }])).ok, false, "직원 ID 아닌 값");
  assert.equal((await set([{ scope: "store", staffId: "", staffName: "", metric: "internet", before: null, value: 1 }])).ok, false, "확정 안 된 지표");
  assert.equal((await set([{ scope: "store", staffId: "", staffName: "", metric: "scho", before: 30, value: -1 }])).ok, false);
  assert.equal((await set([{ scope: "store", staffId: "", staffName: "", metric: "scho", before: 30, value: 1.5 }])).ok, false);
});

test("11) 달성률: 미설정은 계산 안 함(0% 아님) / 목표 0 / 남은 목표 / 입력칸 해석", () => {
  assert.deepEqual(achievement(null, 5), { goal: null, actual: 5, rate: null, remaining: null });
  assert.deepEqual(achievement(0, 0), { goal: 0, actual: 0, rate: 100, remaining: 0 });
  assert.equal(achievement(0, 2).rate, null);
  assert.deepEqual(achievement(40, 30), { goal: 40, actual: 30, rate: 75, remaining: 10 });
  assert.equal(achievement(30, 45).remaining, 0);
  assert.equal(achievement(3, 1).rate, 33.3);
  assert.equal(parseGoalInput(""), null);
  assert.equal(parseGoalInput("0"), 0);
  assert.equal(parseGoalInput("1,200"), 1200);
  assert.equal(parseGoalInput("-1"), undefined);
  assert.equal(parseGoalInput("1.5"), undefined);
  assert.equal(parseGoalChange({ scope: "store", staffId: "st-001", staffName: "", metric: "postpaid", before: null, value: 1 }), null, "매장 목표에 직원 ID 금지");
});

/* ---------- 5. 분석 ---------- */

test("12) 유입경로 분석: 판매 비중(전환율 아님)·미입력과 미확인 구분·입력률 / 지표별 유입경로는 지표끼리 더하지 않음 / 예산은 직원 실적관리와 같은 합계 / 캠페인", () => {
  const withLink = (s: SheetSale, inflow: string, campaign = "") => ({ ...s, link: { ...emptyLink(), inflow, campaign } });
  const sales = [
    withLink(sale({ plan: "스초", second: "O" }), "네이버 블로그", "주말특가"),
    withLink(sale(), "네이버 블로그"),
    withLink(sale({ staff: "이호준" }), "미확인"),
    sale({ staff: "이호준" }), // 미입력
  ];
  const rows = inflowRows(sales);
  const blog = rows.find((r) => r.inflow === "네이버 블로그")!;
  assert.equal(blog.sales, 2);
  assert.equal(blog.share, 50);
  assert.equal(rows.find((r) => r.inflow === "미확인")!.sales, 1);
  assert.equal(rows.find((r) => r.inflow === "미입력")!.sales, 1);
  assert.deepEqual(inflowInputRate(sales), { total: 4, entered: 3, missing: 1, rate: 75, unknown: 1 });
  const byMetric = metricByInflow(sales);
  assert.equal(byMetric.get("scho")!.get("네이버 블로그"), 1);
  assert.equal(byMetric.get("second")!.get("네이버 블로그"), 1);
  assert.equal(byMetric.get("postpaid")!.get("미입력"), 1);
  assert.equal(PRODUCT_METRIC_KEYS.length, 8);
  const perf = aggregateStaffPerformance(sales, ["윤기석", "이호준"]).total;
  const b = budgetTotals(sales);
  assert.deepEqual([b.secured, b.used, b.cash, b.remaining], [perf.benefitSecured, perf.benefitUsed, perf.cash, perf.totalAmount]);
  assert.deepEqual(campaignRows(sales).map((c) => [c.campaign, c.sales]), [["주말특가", 1]]);
  assert.equal(weekStart("2026-11-13"), "2026-11-09", "금요일 → 그 주 월요일");
  assert.equal(weekStart("2026-11-15"), "2026-11-09", "일요일 → 그 주 월요일");
  assert.equal(weekStart("2026-11-09"), "2026-11-09");
});

test("13) 연월 ↔ 월 시트: 웹앱 기존 규칙(최근 12개월)과 같음 / 12개월 지난 월은 시트로 찾지 않음 / 전월", () => {
  for (let m = 1; m <= 12; m++) assert.equal(monthForSheet(`${m}월`, "2026-11-13"), m <= 11 ? `2026-${String(m).padStart(2, "0")}` : "2025-12");
  // 기존 화면 함수(sheetToYearMonth)와 같은 규칙: "이번 달보다 뒤의 월은 작년" 이 그대로 있는지
  const src = readFileSync(path.resolve(import.meta.dirname, "../../wireless-sales/components/sales-data-status.tsx"), "utf8");
  assert.match(src, /const y = month > thisMonth \? year - 1 : year;/);
  for (let m = 1; m <= 12; m++) assert.equal(monthForSheet(`${m}월`, "2026-10-13"), m <= 10 ? `2026-${String(m).padStart(2, "0")}` : `2025-${m}`);
  assert.equal(sheetForMonth("2026-11", "2026-11-13"), "11월");
  assert.equal(sheetForMonth("2025-11", "2026-11-13"), null, "작년 11월은 올해 11월 시트와 섞지 않음");
  assert.equal(sheetForMonth("2026-12", "2026-11-13"), null, "아직 안 온 달");
  assert.equal(sheetForMonth("2025-12", "2026-11-13"), "12월");
  assert.equal(sheetForMonth("2026-11", "2027-11-02"), null, "다음 해에는 2026년 11월을 11월 시트로 보지 않음");
  assert.equal(previousMonth("2027-01"), "2026-12");
  assert.equal(previousMonth("2026-11"), "2026-10");
});

test("14) 직원 ID: 이름이 정확히 같을 때만, 가망고객관리 직원 ID 는 자동 연결하지 않음(비어 있음) / 퇴사 직원 ID 유지", () => {
  const ids = STAFF.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.every((id) => /^st-\d{3}$/.test(id)));
  assert.ok(STAFF.every((s) => s.prospectStaffId === undefined), "점장 확인 전에는 비어 있음");
  assert.equal(staffIdForName("김승원"), "st-002", "퇴사 직원도 ID 유지");
  assert.equal(staffIdForName(" 윤기석 "), staffIdForName("윤기석"));
  assert.equal(staffIdForName("윤기"), null);
  assert.equal(staffIdForName(""), null);
  assert.equal(linkValueError("tmStaffId", "st-003"), null);
  assert.ok(linkValueError("tmStaffId", "윤기석"));
});

test("15) 판매연결 저장은 로그인·같은 사이트 요청만 (Apps Script 호출 전 거부)", async () => {
  const { gas } = setup();
  const before = gas.calls.length;
  const r = await linkPOST(new Request("https://test.invalid/api/sales/link", { method: "POST", body: "{}" }));
  assert.ok(r.status === 401 || r.status === 403, String(r.status));
  const noCookie = await linkPOST(new Request("https://test.invalid/api/sales/link", { method: "POST", headers: { origin: "https://test.invalid" }, body: "{}" }));
  assert.equal(noCookie.status, 401);
  assert.equal(gas.calls.length, before);
});
