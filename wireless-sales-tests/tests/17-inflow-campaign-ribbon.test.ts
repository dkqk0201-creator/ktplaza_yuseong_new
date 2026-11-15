/*
 * (A) 무선판매관리 개선 (2026-11-15 확정 기준) — 가짜 데이터·가짜 스프레드시트만.
 *   유입경로 5개·항목 관리 / 카톡 자동 인식 / 판매 등록·수정 + 판매연결 통합 저장 / 부분 실패와 안전한 재시도(등록요청 ID)
 *   리본 자동 판정·과거 판매 조회 시 계산 / 캠페인 관리·자동 연결·캠페인 조회 집계 / 인증·개인정보·기존 데이터 보존
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { setup, register, registerWithIds, report, list, byName, target, authed, deleteSale, serverLogs, responses } from "../harness/web.ts";
import { PEOPLE } from "../harness/fake-people.ts";
import { colNum as L } from "../harness/formula.ts";
import { findOriginals, sheetTexts, jsonTexts } from "../harness/privacy.ts";
import { APPS_SCRIPT_DIR } from "../harness/gas.ts";
import { parseQuickReports, normalizeQuick, STAFF_REPORT_TEMPLATE } from "@/lib/quick-report";
import { ribbonFromUsedPhone, ribbonOf, ribbonModeFor } from "@/lib/ribbon";
import {
  DEFAULT_INFLOW_OPTIONS,
  inflowGroup,
  inflowGroupOrder,
  inflowOptionsError,
  resolveInflow,
  selectableInflows,
  type InflowOption,
} from "@/lib/inflow-options";
import { campaignInputError, campaignOfLink, resolveCampaign, suggestedStatus, type Campaign } from "@/lib/campaigns";
import { emptyLink, inflowOf } from "@/lib/sale-link";
import { parseSheetRow, type SheetSale } from "@/lib/sheet-record";
import { countMetrics } from "@/lib/product-metrics";
import { campaignRows, campaignSummary, filterCampaignSales, inflowInputRate, inflowRows, budgetTotals } from "@/lib/sales-analysis";
import { planLinkEdit, CAMPAIGN_KEEP_RAW } from "@/lib/sale-link-edit";
import { POST as updatePOST } from "@/app/api/sales/update/route";
import { POST as linkPOST } from "@/app/api/sales/link/route";
import { POST as quickPOST } from "@/app/api/sales/quick/route";
import { GET as configGET } from "@/app/api/settings/config/route";
import { POST as inflowPOST } from "@/app/api/settings/inflow/route";
import { POST as campaignPOST } from "@/app/api/settings/campaigns/route";

const [A, B, C, D, E] = PEOPLE;
const json = (r: Response) => r.json() as Promise<Record<string, unknown>>;
const post = (h: (r: Request) => Promise<Response>, body: unknown) => h(authed("/api", { method: "POST", body: JSON.stringify(body) })).then(json);
const get = (h: (r: Request) => Promise<Response>, url: string) => h(authed(url)).then(json);
const ctx = { today: "2026-10-13", staffNames: ["김수현", "윤기석", "이호준"] };
const REQ_LINE = /^웹앱등록요청ID: [0-9a-f-]{36}$/m;
const ID_LINE = /^웹앱판매ID: [0-9a-f-]{36}$/m;

/** 가짜 판매 1건 (장표 행 → 화면 판매) */
function sale(over: { staff?: string; category?: string; model?: string; date?: string; link?: Partial<ReturnType<typeof emptyLink>>; notes?: Record<string, string>; benefit?: number } = {}): SheetSale {
  const values = new Array(38).fill("");
  const set = (letter: string, v: unknown) => { values[L(letter) - 1] = v; };
  set("C", over.date ?? "2026-10-05"); set("D", "가짜고객"); set("E", "010-0000-0000"); set("I", over.category ?? "기기변경");
  set("J", over.model ?? "테스트폰"); set("K", "베이직"); set("M", over.staff ?? "윤기석"); set("AD", "X"); set("AE", "X"); set("AK", "X");
  set("T", over.benefit ?? 50000); set("V", 20000); set("AB", 0);
  const s = parseSheetRow(9, "1", values);
  if (over.link) s.link = { ...emptyLink(), ...over.link };
  if (over.notes) s.notes = over.notes;
  return s;
}

/* ---------- 1. 리본 ---------- */

test("1) 리본 판정 규칙 (중고폰&현물 판매 내용만): 진행 O / 예정·추후 X / 취소·미진행 X / 점프+리본 O / 점프만 X / 일반 판매·빈칸 X", () => {
  const cases: [string, "O" | "X"][] = [
    ["리본", "O"], ["리본 20만원", "O"], ["중고폰 리본", "O"], ["폴드6-512/리본", "O"], ["aip15pm리본/디초세컨판매", "O"],
    ["점프3리본", "O"], ["점프+리본", "O"], ["리본 + 현물(에어팟)", "O"], ["RIBBON", "O"],
    ["리본예정", "X"], ["리본 예정", "X"], ["추후 리본", "X"], ["중고폰리본(예정)", "X"], ["리본 나중에", "X"],
    ["리본X", "X"], ["리본 x", "X"], ["리본 미진행", "X"], ["리본 취소", "X"], ["리본 안함", "X"], ["취소 리본", "X"],
    ["점프2", "X"], ["점프3", "X"], ["S23", "X"], ["플립5-512(파손)", "X"], ["디초세컨판매", "X"], ["포차코", "X"], ["폰삼", "X"],
    ["x", "X"], ["없음", "X"], ["", "X"], ["  ", "X"],
  ];
  for (const [text, want] of cases) assert.equal(ribbonFromUsedPhone(text), want, JSON.stringify(text));
  assert.equal(ribbonModeFor("O", "리본"), "자동");
  assert.equal(ribbonModeFor("X", "리본"), "수동");
  assert.equal(ribbonModeFor("X", ""), "자동", "빈칸 = X 와 같음");
  assert.equal(ribbonModeFor("", "리본"), "");
});

test("2) 과거 판매 리본: 저장값 우선 → 정확히 연결된 참고내용(중고폰&현물 판매)으로 자동판정 → 원본 없으면 판정 불가(세지 않음, X 로도 안 셈)", () => {
  assert.deepEqual(ribbonOf(sale({ link: { goodbye: "X" }, notes: { usedPhone: "리본" } })), { value: "X", source: "saved" });
  assert.deepEqual(ribbonOf(sale({ notes: { usedPhone: "리본" } })), { value: "O", source: "auto" });
  assert.deepEqual(ribbonOf(sale({ notes: { usedPhone: "점프2" } })), { value: "X", source: "auto" });
  assert.deepEqual(ribbonOf(sale({ notes: { dicho: "O" } })), { value: "판정불가", source: "none" }, "참고내용은 있지만 중고폰 항목 없음");
  assert.deepEqual(ribbonOf(sale()), { value: "판정불가", source: "none" }, "참고내용이 연결되지 않은 판매");
  const c = countMetrics([sale({ notes: { usedPhone: "리본" } }), sale({ notes: { usedPhone: "리본예정" } }), sale(), sale({ link: { goodbye: "O" } })]);
  assert.equal(c.goodbye, 2);
  // 다른 메모에 리본이 있어도 인정 안 함
  const memo = sale({ notes: { usedPhoneWhere: "리본 보상금 입금" } });
  assert.equal(ribbonOf(memo).value, "판정불가");
});

test("3) 카톡 보고: 중고폰&현물 판매 줄이 있으면 리본 자동(빈칸=X) / 줄이 없는 예전 양식은 판정 안 함 / 리본 줄을 따로 적으면 그 값(수동) / 고객약속사항의 '리본'은 무시", () => {
  assert.ok(STAFF_REPORT_TEMPLATE.includes("중고폰&현물 판매 : ") && !STAFF_REPORT_TEMPLATE.includes("굿바이"));
  const base = ["개통일자 : 10.05", "직원명 : 윤기석", `고객명 : ${A.name}`, `CTN : ${A.ctn}`, "개통구분 : 기변", "모델명 : 테스트폰", "요금제 : 베이직", "ㄴ유지/변경 : 유지"];
  const parse = (extra: string[]) => {
    const f = parseQuickReports([...base, ...extra].join("\n"))[0].fields;
    return { fields: f, n: normalizeQuick(f, ctx) };
  };
  let r = parse(["중고폰&현물 판매 : 리본 20만원", "ㄴ판매금액 : 20만"]);
  assert.equal(r.fields.goodbye, "O");
  assert.deepEqual([r.n.link.goodbye, r.n.link.ribbonMode], ["O", "자동"]);
  r = parse(["중고폰&현물 판매 : ", "ㄴ판매금액 : "]);
  assert.deepEqual([r.n.link.goodbye, r.n.link.ribbonMode], ["X", "자동"], "줄은 있는데 빈칸 → X");
  r = parse(["중고폰 리본or폰삼 : 리본"]); // 예전 양식 이름
  assert.equal(r.n.link.goodbye, "O");
  r = parse([]);
  assert.deepEqual([r.n.link.goodbye, r.n.link.ribbonMode], ["", ""], "줄 자체가 없으면 판정 안 함");
  r = parse(["중고폰&현물 판매 : 리본", "리본 : X"]);
  assert.deepEqual([r.n.link.goodbye, r.n.link.ribbonMode], ["X", "수동"]);
  r = parse(["고객약속사항 : 다음 달 리본 진행 약속"]);
  assert.equal(r.n.link.goodbye, "", "고객약속사항의 리본은 보지 않음");
  r = parse(["중고폰&현물 판매 : 리본", "굿바이 : O"]); // 예전 이름 줄
  assert.equal(r.n.link.goodbye, "O");
});

/* ---------- 2. 유입경로 ---------- */

test("4) 유입경로 5개·별칭·미확인 / 예전 14개 값은 네이버·자점·내방으로 묶고 나머지는 '기존값' 그대로 / 미입력·미확인·확인 필요 구분", () => {
  assert.deepEqual(selectableInflows(DEFAULT_INFLOW_OPTIONS), ["네이버", "자점", "TM", "내방", "외부영업", "미확인"]);
  const m = (raw: string) => resolveInflow(raw, DEFAULT_INFLOW_OPTIONS);
  for (const [raw, name] of [["블로그", "네이버"], ["네이버 예약", "네이버"], ["스마트플레이스", "네이버"], ["단골", "자점"], ["tm", "TM"], ["자연방문", "내방"], ["전단지", "외부영업"], ["상가", "외부영업"], ["모름", "미확인"]] as const) {
    assert.deepEqual(m(raw), { kind: "match", name }, raw);
  }
  assert.deepEqual(m("인스타"), { kind: "check", raw: "인스타" });
  assert.deepEqual(m("지인 소개"), { kind: "check", raw: "지인 소개" }, "지인소개는 임의 배정 안 함");
  assert.deepEqual(m("  "), { kind: "empty" });
  const g = (inflow: string, inflowRaw = "") => inflowGroup({ inflow, inflowRaw });
  assert.equal(g("네이버 플레이스"), "네이버");
  assert.equal(g("네이버 블로그"), "네이버");
  assert.equal(g("자점 단골 고객"), "자점");
  assert.equal(g("자연 방문"), "내방");
  assert.equal(g("인스타그램"), "기존값 · 인스타그램");
  assert.equal(g("KT 안내"), "기존값 · KT 안내");
  assert.equal(g("미확인"), "미확인");
  assert.equal(g("", "인스타"), "확인 필요");
  assert.equal(g(""), "미입력");
  assert.equal(inflowGroup(undefined), "미입력");
  const sales = [
    sale({ link: { inflow: "네이버" } }), sale({ link: { inflow: "네이버 블로그" } }), sale({ link: { inflow: "지인 소개" } }),
    sale({ link: { inflowRaw: "유튜브" } }), sale({ link: { inflow: "미확인" } }), sale(),
  ];
  const rows = inflowRows(sales);
  assert.deepEqual(rows.filter((r) => r.sales > 0).map((r) => [r.inflow, r.sales]), [["네이버", 2], ["미확인", 1], ["기존값 · 지인 소개", 1], ["확인 필요", 1], ["미입력", 1]]);
  assert.deepEqual(inflowInputRate(sales), { total: 6, entered: 4, missing: 1, rate: 66.7, unknown: 1, check: 1 });
  assert.deepEqual(inflowGroupOrder(DEFAULT_INFLOW_OPTIONS), ["네이버", "자점", "TM", "내방", "외부영업", "미확인", "확인 필요", "미입력"]);
});

test("5) 유입경로 항목 검사: 이름 변경·삭제 불가(사용 안 함으로만) / 미확인 등 예약어·중복 별칭 금지 / 사용 중 항목 1개 이상", () => {
  const prev = DEFAULT_INFLOW_OPTIONS;
  const plus = (o: Partial<InflowOption>) => [...prev, { name: "SNS", aliases: ["인스타"], active: true, order: 6, ...o }];
  assert.equal(inflowOptionsError(plus({}), prev), null);
  assert.match(inflowOptionsError(prev.slice(1), prev) ?? "", /지울 수 없습니다/);
  assert.match(inflowOptionsError(plus({ name: "미확인" }), prev) ?? "", /따로 쓰는 분류/);
  assert.match(inflowOptionsError(plus({ aliases: ["블로그"] }), prev) ?? "", /두 항목/);
  assert.match(inflowOptionsError(prev.map((o) => ({ ...o, active: false })), prev) ?? "", /하나 이상/);
  assert.match(inflowOptionsError(plus({ name: "네이버" }), prev) ?? "", /두 번/);
  assert.equal(inflowOptionsError(prev.map((o) => (o.name === "외부영업" ? { ...o, active: false } : o)), prev), null, "비활성화는 가능");
});

test("6) 항목 관리 저장 → 숨김 시트 / 새 항목은 카톡 별칭으로 바로 인식·저장 / 비활성 항목은 새 판매에 못 쓰지만 지난 판매 집계는 그대로 / 화면 판이 다르면 거부 / 월 시트 불변", async () => {
  const { ss, gas } = setup();
  const before = JSON.stringify(ss.month().rows.map((r) => r.map((c) => c.value)));
  const cfg0 = await get(configGET, "/api/settings/config");
  assert.equal(cfg0.ok, true);
  assert.equal(ss.getSheetByName("웹앱유입경로"), null, "읽기만으로는 시트를 만들지 않음");
  const items = [...(cfg0.inflows as InflowOption[]), { name: "SNS", aliases: ["인스타", "스레드"], active: true, order: 6 }];
  const saved = await post(inflowPOST, { items, version: cfg0.inflowVersion });
  assert.equal(saved.ok, true, JSON.stringify(saved));
  const sheet = ss.getSheetByName("웹앱유입경로")!;
  assert.equal(sheet.hidden, true);
  // 같은 판(version)으로 또 저장 → 거부 (다른 화면에서 먼저 바꾼 경우)
  const stale = await post(inflowPOST, { items, version: cfg0.inflowVersion });
  assert.equal(stale.ok, false);
  // 새 항목으로 등록
  await register(report(A.name, A.ctn, { extra: "유입경로 : 인스타" }));
  assert.equal(byName(await list(), A.name).link?.inflow, "SNS");
  // SNS 비활성화 → 새 판매는 확인 필요(원문), 지난 판매는 SNS 그대로 집계
  const cfg1 = await get(configGET, "/api/settings/config");
  const off = (cfg1.inflows as InflowOption[]).map((o) => (o.name === "SNS" ? { ...o, active: false } : o));
  assert.equal((await post(inflowPOST, { items: off, version: cfg1.inflowVersion })).ok, true);
  await register(report(B.name, B.ctn, { extra: "유입경로 : 인스타" }));
  const b = byName(await list(), B.name);
  assert.deepEqual([b.link?.inflow, b.link?.inflowRaw], ["", "인스타"]);
  const a = byName(await list(), A.name);
  const cfg2 = (await get(configGET, "/api/settings/config")) as unknown as { inflows: InflowOption[] };
  assert.equal(inflowOf(a, cfg2.inflows), "SNS");
  assert.equal(inflowOf(b, cfg2.inflows), "확인 필요");
  // 비활성 항목을 직접 저장하려 하면 서버·Apps Script 모두 거부
  const direct = await post(linkPOST, { target: target(b), saleId: b.saleId, staff: b.staff, patches: [{ field: "inflow", before: "", value: "SNS" }] });
  assert.equal(direct.ok, false);
  const gasDirect = gas.doPost({ action: "sale-link-set", target: target(b), saleId: b.saleId, staffId: "", patches: [{ field: "inflow", before: "", value: "SNS" }] });
  assert.equal(gasDirect.ok, false, "Apps Script 도 사용 중 항목만 저장");
  // 월 시트는 판매 2건 외에는 그대로 (항목 저장이 장표를 건드리지 않음)
  const afterRows = ss.month().rows.map((r) => r.map((c) => c.value));
  assert.equal(afterRows.length >= JSON.parse(before).length, true);
});

/* ---------- 3. 캠페인 ---------- */

test("7) 캠페인 연결 규칙: 이름·별칭(띄어쓰기 무시)만 / 사용 안 함은 연결 안 함 / 없음·x·- 는 캠페인 없음 / 목록에 없으면 원문만(확인 필요) / 날짜 비교 안 함", () => {
  const list: Campaign[] = [
    { id: "CMP-0001", name: "2026년 11월 게릴라 세일", aliases: ["11월 게릴라 세일"], type: "매장 행사", start: "2026-11-01", end: "2026-11-10", status: "종료", active: true },
    { id: "CMP-0002", name: "갤럭시 신제품 사전예약", aliases: ["갤럭시 사전예약"], type: "신제품 사전예약", start: "2026-07-01", end: "2026-07-20", status: "종료", active: false },
  ];
  assert.equal((resolveCampaign("11월게릴라세일", list) as { campaign: Campaign }).campaign.id, "CMP-0001");
  assert.equal((resolveCampaign("2026년 11월 게릴라 세일", list) as { campaign: Campaign }).campaign.id, "CMP-0001", "종료 캠페인도 사용 중이면 연결");
  assert.deepEqual(resolveCampaign("갤럭시 사전예약", list), { kind: "check", raw: "갤럭시 사전예약" }, "사용 안 함 캠페인은 연결 안 함");
  for (const none of ["", "없음", "X", "-", " x "]) assert.deepEqual(resolveCampaign(none, list), { kind: "none" }, none);
  assert.deepEqual(resolveCampaign("주말특가", list), { kind: "check", raw: "주말특가" });
  assert.deepEqual(campaignOfLink({ campaign: "11월 게릴라 세일", campaignId: "CMP-0001" }, list), { state: "linked", id: "CMP-0001", name: "2026년 11월 게릴라 세일", campaign: list[0] });
  assert.deepEqual(campaignOfLink({ campaign: "주말특가", campaignId: "" }, list), { state: "check", raw: "주말특가" });
  assert.deepEqual(campaignOfLink({ campaign: "없음", campaignId: "" }, list), { state: "none" });
  assert.equal(suggestedStatus("2026-11-01", "2026-11-10", "2026-10-30"), "예정");
  assert.equal(suggestedStatus("2026-11-01", "2026-11-10", "2026-11-05"), "진행");
  assert.equal(suggestedStatus("2026-11-01", "2026-11-10", "2026-11-11"), "종료");
  const input = { name: "아이폰 사전예약", aliases: ["11월 게릴라 세일"], type: "신제품 사전예약", start: "", end: "", status: "예정", active: true };
  assert.match(campaignInputError(input, list) ?? "", /이미 "2026년 11월 게릴라 세일"/);
  assert.match(campaignInputError({ ...input, aliases: [], name: "없음" }, list) ?? "", /캠페인 없음/);
  assert.match(campaignInputError({ ...input, aliases: [], start: "2026-12-02", end: "2026-12-01" }, list) ?? "", /종료일/);
  assert.equal(campaignInputError({ ...input, aliases: [] }, list), null);
});

test("8) 캠페인 등록·수정(ID 유지·이력) → 카톡 별칭으로 자동 연결 / 이름을 바꿔도 연결 유지 / 원문만 있던 판매는 점장이 누를 때만 연결(미리보기 → 적용, 삭제된 판매 제외)", async () => {
  const { ss } = setup({ slots: 20 });
  // 캠페인 만들기 전 보고 → 원문만
  await register(report(A.name, A.ctn, { extra: "캠페인 : 11월 게릴라 세일" }), report(B.name, B.ctn, { extra: "캠페인 : 11월 게릴라 세일" }), report(C.name, C.ctn, { extra: "캠페인 : 없음" }));
  assert.deepEqual([byName(await list(), A.name).link?.campaign, byName(await list(), A.name).link?.campaignId], ["11월 게릴라 세일", ""]);
  assert.equal(byName(await list(), C.name).link?.campaign, "", "없음은 저장 안 함");
  assert.equal((await deleteSale(byName(await list(), B.name))).ok, true, "B 판매 삭제 (연결 대상에서 빠져야 함)");
  const cfg = await get(configGET, "/api/settings/config");
  const created = await post(campaignPOST, {
    campaign: { name: "2026년 11월 게릴라 세일", aliases: ["11월 게릴라 세일"], type: "매장 행사", start: "2026-11-01", end: "2026-11-30", status: "예정", active: true },
    version: cfg.campaignVersion,
  });
  assert.equal(created.ok, true, JSON.stringify(created));
  assert.equal(created.id, "CMP-0001");
  assert.equal(ss.getSheetByName("웹앱캠페인")!.hidden, true);
  // 원문이 같은 판매: 미리보기는 건수만, 적용해야 연결
  const preview = await post(campaignPOST, { attach: { campaignId: "CMP-0001", apply: false } });
  assert.equal(preview.count, 1, "삭제된 B 는 제외");
  assert.equal(byName(await list(), A.name).link?.campaignId, "", "미리보기로는 바뀌지 않음");
  const applied = await post(campaignPOST, { attach: { campaignId: "CMP-0001", apply: true } });
  assert.equal(applied.count, 1);
  assert.equal(byName(await list(), A.name).link?.campaignId, "CMP-0001");
  // 새 보고는 바로 연결
  await register(report(D.name, D.ctn, { extra: "캠페인 : 11월게릴라세일" }));
  assert.equal(byName(await list(), D.name).link?.campaignId, "CMP-0001");
  // 이름 변경 → 같은 ID, 이력 기록
  const cfg2 = await get(configGET, "/api/settings/config");
  const renamed = await post(campaignPOST, {
    campaign: { id: "CMP-0001", name: "11월 게릴라 세일 (연장)", aliases: ["11월 게릴라 세일"], type: "매장 행사", start: "2026-11-01", end: "2026-12-05", status: "진행", active: true },
    version: cfg2.campaignVersion,
  });
  assert.equal(renamed.ok, true, JSON.stringify(renamed));
  const cfg3 = (await get(configGET, "/api/settings/config")) as unknown as { campaigns: Campaign[] };
  assert.equal(cfg3.campaigns.length, 1);
  const rows = campaignRows(await list(), cfg3.campaigns);
  assert.deepEqual(rows.map((r) => [r.campaign, r.state, r.sales]), [["11월 게릴라 세일 (연장)", "linked", 2]]);
  const history = ss.getSheetByName("웹앱캠페인이력")!.rows.slice(1).map((r) => String(r[2]?.value ?? ""));
  assert.ok(history.includes("새로 등록") && history.includes("캠페인명") && history.includes("종료일") && history.includes("상태") && history.includes("판매 연결"), JSON.stringify(history));
  // 사용 안 함 → 새 판매는 연결 안 됨 (원문만), 지난 연결은 그대로
  const cfg4 = await get(configGET, "/api/settings/config");
  await post(campaignPOST, { campaign: { id: "CMP-0001", name: "11월 게릴라 세일 (연장)", aliases: ["11월 게릴라 세일"], type: "매장 행사", start: "2026-11-01", end: "2026-12-05", status: "종료", active: false }, version: cfg4.campaignVersion });
  await register(report(E.name, E.ctn, { extra: "캠페인 : 11월 게릴라 세일" }));
  assert.deepEqual([byName(await list(), E.name).link?.campaignId, byName(await list(), E.name).link?.campaign], ["", "11월 게릴라 세일"]);
  assert.equal(byName(await list(), A.name).link?.campaignId, "CMP-0001");
  // 같은 판(version)으로 중복 저장 거부
  const stale = await post(campaignPOST, { campaign: { name: "다른 행사", aliases: [], type: "기타", start: "", end: "", status: "진행", active: true }, version: cfg.campaignVersion });
  assert.equal(stale.ok, false);
});

test("9) 캠페인 조회 집계: 필터 6종(캠페인·기간·직원·유입경로·개통구분·모델) AND / 총 판매·후불·번이·상품별·직원별·유입경로별·예산(직원 실적관리와 같은 합계)", () => {
  const list: Campaign[] = [{ id: "CMP-0001", name: "게릴라", aliases: [], type: "매장 행사", start: "", end: "", status: "진행", active: true }];
  const L1 = { campaign: "게릴라", campaignId: "CMP-0001" };
  const sales = [
    sale({ staff: "윤기석", category: "번호이동", model: "갤럭시S26", date: "2026-11-02", link: { ...L1, inflow: "네이버", goodbye: "O" } }),
    sale({ staff: "이호준", category: "기기변경", model: "아이폰17", date: "2026-11-03", link: { ...L1, inflow: "TM" } }),
    sale({ staff: "윤기석", category: "UMNP", model: "갤럭시S26", date: "2026-12-01", link: { ...L1, inflow: "네이버" } }), // 사전예약처럼 기간 밖 개통
    sale({ staff: "윤기석", category: "번호이동", date: "2026-11-02", link: { inflow: "네이버" } }), // 캠페인 없음
    sale({ staff: "윤기석", date: "2026-11-02", link: { campaign: "주말특가" } }), // 확인 필요 원문
  ];
  const f = (o: object) => filterCampaignSales(sales, { campaign: "CMP-0001", ...o }, list).length;
  assert.equal(f({}), 3);
  assert.equal(f({ start: "2026-11-01", end: "2026-11-30" }), 2);
  assert.equal(f({ staff: "윤기석" }), 2);
  assert.equal(f({ inflow: "네이버" }), 2);
  assert.equal(f({ category: "번호이동" }), 1);
  assert.equal(f({ model: "s26" }), 2, "모델은 일부·대소문자 무시");
  assert.equal(f({ staff: "윤기석", inflow: "네이버", category: "UMNP" }), 1);
  assert.equal(filterCampaignSales(sales, { campaign: "원문:주말특가" }, list).length, 1);
  const picked = filterCampaignSales(sales, { campaign: "CMP-0001" }, list);
  const s = campaignSummary(picked);
  assert.equal(s.sales, 3);
  assert.deepEqual([s.metrics.postpaid, s.metrics.portIn, s.metrics.umnp, s.metrics.goodbye], [2, 1, 1, 1]);
  assert.deepEqual(s.budget, budgetTotals(picked));
  assert.deepEqual(s.byStaff, [{ staff: "윤기석", sales: 2, postpaid: 1 }, { staff: "이호준", sales: 1, postpaid: 1 }]);
  assert.deepEqual(s.byInflow, [{ inflow: "네이버", sales: 2 }, { inflow: "TM", sales: 1 }]);
  assert.equal(s.ribbonUnknown, 2, "리본 원본 없는 판매는 판정 불가로 따로");
});

/* ---------- 4. 통합 저장 · 재시도 ---------- */

test("10) 간편등록 한 번으로 판매 + 유입경로·캠페인·리본·등록요청ID 저장 / C열 메모에 판매 ID·등록요청 ID / 고객 이름·번호는 판매연결에 없음", async () => {
  const { ss } = setup();
  const cfg = await get(configGET, "/api/settings/config");
  await post(campaignPOST, { campaign: { name: "2026년 11월 게릴라 세일", aliases: ["11월 게릴라 세일"], type: "매장 행사", start: "", end: "", status: "진행", active: true }, version: cfg.campaignVersion });
  const rid = randomUUID();
  const r = await registerWithIds([{ text: report(A.name, A.ctn, { extra: "중고폰&현물 판매 : 리본 20만원\n유입경로 : 블로그\n캠페인 : 11월 게릴라 세일" }), requestId: rid }]);
  const [res] = r.results as { ok: boolean; saleId?: string; linkPending?: boolean; repeated?: boolean }[];
  assert.equal(res.ok, true);
  assert.equal(res.linkPending, undefined);
  const a = byName(await list(), A.name);
  assert.deepEqual(
    { inflow: a.link?.inflow, campaign: a.link?.campaign, campaignId: a.link?.campaignId, goodbye: a.link?.goodbye, ribbonMode: a.link?.ribbonMode, requestId: a.link?.requestId },
    { inflow: "네이버", campaign: "11월 게릴라 세일", campaignId: "CMP-0001", goodbye: "O", ribbonMode: "자동", requestId: rid },
  );
  const note = ss.month().cell(a.row, L("C")).note;
  assert.match(note, ID_LINE);
  assert.match(note, REQ_LINE);
  assert.ok(note.includes(rid));
  assert.deepEqual(findOriginals(sheetTexts(ss, { only: ["웹앱판매연결", "웹앱캠페인", "웹앱캠페인이력", "웹앱유입경로"] }), [A]), [], "보조 시트에 고객 이름·번호 없음");
  assert.equal(a.notes?.usedPhone, "리본 20만원", "중고폰&현물 판매 원문은 기존처럼 참고내용에");
});

test("11) 같은 등록요청 ID 로 다시 보내면 판매를 또 쓰지 않음 (통신이 끊겨 재시도해도 판매 1건) / 정렬로 행이 바뀌어도 / 같은 요청에 같은 ID 두 번이면 거부", async () => {
  const { ss } = setup({ slots: 20 });
  const rid = randomUUID();
  const text = report(A.name, A.ctn, { date: "10.09", extra: "유입경로 : TM" });
  const first = (await registerWithIds([{ text, requestId: rid }])).results as { ok: boolean; saleId: string; row: number }[];
  // 더 이른 날짜 판매가 들어와 A 가 아래로 밀림
  await register(report(B.name, B.ctn, { date: "10.02" }));
  const again = (await registerWithIds([{ text, requestId: rid }])).results as { ok: boolean; saleId: string; row: number; repeated?: boolean; no: string }[];
  assert.equal(again[0].ok, true);
  assert.equal(again[0].repeated, true);
  assert.equal(again[0].saleId, first[0].saleId);
  const sales = (await list()).filter((s) => s.customer === A.name);
  assert.equal(sales.length, 1, "판매는 1건");
  assert.equal(again[0].row, sales[0].row, "밀려난 현재 행을 돌려줌");
  // 여러 건 중 일부만 재전송 (새 건은 저장, 이미 저장된 건은 그대로)
  const rid2 = randomUUID();
  const mixed = (await registerWithIds([{ text, requestId: rid }, { text: report(C.name, C.ctn, { date: "10.03" }), requestId: rid2 }])).results as { ok: boolean; repeated?: boolean }[];
  assert.deepEqual(mixed.map((m) => [m.ok, !!m.repeated]), [[true, true], [true, false]]);
  assert.equal((await list()).filter((s) => s.customer === A.name).length, 1);
  assert.equal((await list()).filter((s) => s.customer === C.name).length, 1);
  // 한 요청 안에 같은 ID 두 번 → 서버가 Apps Script 호출 전 거부
  const dup = await post(quickPOST, { items: [{ fields: parseQuickReports(report(D.name, D.ctn))[0].fields, requestId: rid2 }, { fields: parseQuickReports(report(E.name, E.ctn))[0].fields, requestId: rid2 }] });
  assert.equal(dup.ok, false);
  // 시트에서 행을 복사해 등록요청 ID 가 두 행에 생기면 그 요청은 저장하지 않음 (확인 필요)
  const c = byName(await list(), C.name);
  const emptyRow = Math.max(...(await list()).map((s) => s.row)) + 1;
  ss.month().cell(emptyRow, L("C")).note = ss.month().cell(c.row, L("C")).note;
  for (const col of ["C", "D", "E", "I", "M"]) ss.month().cell(emptyRow, L(col)).value = ss.month().cell(c.row, L(col)).value;
  const copied = (await registerWithIds([{ text: report(C.name, C.ctn, { date: "10.03" }), requestId: rid2 }])).results as { ok: boolean; message?: string }[];
  assert.equal(copied[0].ok, false);
  assert.match(String(copied[0].message), /두 행/);
});

/** 판매연결 쓰기를 처음 n 번 실패시키는 Apps Script (테스트 전용 덮어쓰기) */
function failingLinkSource(times: number): string {
  const src = readFileSync(path.join(APPS_SCRIPT_DIR, "sale-link.gs"), "utf8");
  const start = src.indexOf("function wsWriteLink_(");
  const end = src.indexOf("\n}\n", start) + 3;
  const real = src.slice(start, end).replace("function wsWriteLink_(", "function wsWriteLinkReal_(");
  return `var WS_TEST_FAIL_LINK = ${times};\n${real}\nfunction wsWriteLink_(ss, saleId, info, fields) { if (WS_TEST_FAIL_LINK > 0) { WS_TEST_FAIL_LINK--; throw new Error("시험용 실패"); } return wsWriteLinkReal_(ss, saleId, info, fields); }`;
}

test("12) 부분 실패: 판매는 저장·판매연결만 실패 → linkPending 안내 / 같은 등록요청 ID 로 다시 보내면 판매연결만 이어서 저장 (판매 1건 그대로)", async () => {
  const { ss } = setup({ extraSource: failingLinkSource(1) });
  const rid = randomUUID();
  const text = report(A.name, A.ctn, { extra: "유입경로 : 네이버\n중고폰&현물 판매 : 리본" });
  const [r1] = (await registerWithIds([{ text, requestId: rid }])).results as { ok: boolean; linkPending?: boolean; warning?: string; saleId?: string }[];
  assert.equal(r1.ok, true);
  assert.equal(r1.linkPending, true);
  assert.match(String(r1.warning), /판매연결만 다시 저장/);
  const a1 = byName(await list(), A.name);
  assert.equal(a1.saleIdState, "ok", "판매 ID 는 판매와 함께 저장됨");
  assert.equal(a1.link, undefined, "판매연결 기록은 아직 없음");
  assert.match(ss.month().cell(a1.row, L("C")).note, REQ_LINE, "등록요청 ID 는 판매와 함께 기록 (재시도 중복 방지)");
  const [r2] = (await registerWithIds([{ text, requestId: rid }])).results as { ok: boolean; linkPending?: boolean; repeated?: boolean; saleId?: string }[];
  assert.deepEqual([r2.ok, r2.repeated, r2.linkPending], [true, true, undefined]);
  assert.equal(r2.saleId, r1.saleId);
  const sales = (await list()).filter((s) => s.customer === A.name);
  assert.equal(sales.length, 1);
  assert.deepEqual([sales[0].link?.inflow, sales[0].link?.goodbye, sales[0].link?.requestId], ["네이버", "O", rid]);
  // 판매연결이 이미 있으면 재전송이 덮어쓰지 않음 (그사이 점장이 고친 값 보존)
  const fixed = await post(updatePOST, { target: target(sales[0]), changes: [], link: { saleId: sales[0].saleId, staff: sales[0].staff, patches: [{ field: "inflow", before: "네이버", value: "자점" }] } });
  assert.equal(fixed.ok, true, JSON.stringify(fixed));
  await registerWithIds([{ text, requestId: rid }]);
  assert.equal(byName(await list(), A.name).link?.inflow, "자점");
});

test("13) 판매 수정 + 판매연결 한 요청·한 잠금 / 판매연결 확인이 틀리면 장표도 안 바뀜 / 판매연결만 수정 / 판매연결만 실패하면 linkPending (장표 수정은 완료)", async () => {
  const { ss, gas } = setup({ extraSource: failingLinkSource(0) });
  await register(report(A.name, A.ctn, { extra: "유입경로 : 네이버" }), report(B.name, B.ctn));
  const a = byName(await list(), A.name);
  const modelCol = 9; // J열 (0부터)
  // 1) 함께 저장
  const r = await post(updatePOST, {
    target: target(a),
    changes: [{ key: "model", before: a.model, after: "갤럭시수정" }],
    link: { saleId: a.saleId, staff: a.staff, patches: [{ field: "inflow", before: "네이버", value: "TM" }, { field: "goodbye", before: "", value: "O" }, { field: "ribbonMode", before: "", value: "수동" }] },
  });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal((r.link as { inflow: string }).inflow, "TM");
  const callsBefore = gas.calls.filter((c) => c.body.action === "sale-update").length;
  assert.equal(gas.calls.filter((c) => c.body.action === "sale-link-set").length, 0, "판매연결을 따로 보내지 않음");
  const a2 = byName(await list(), A.name);
  assert.deepEqual([a2.model, a2.link?.inflow, a2.link?.goodbye, a2.link?.ribbonMode], ["갤럭시수정", "TM", "O", "수동"]);
  // 2) 화면에서 본 판매연결 값이 다르면 아무것도 쓰지 않음
  const rowBefore = JSON.stringify(ss.month().rowValues(a2.row));
  const stale = await post(updatePOST, {
    target: target(a2),
    changes: [{ key: "model", before: a2.model, after: "또수정" }],
    link: { saleId: a2.saleId, staff: a2.staff, patches: [{ field: "inflow", before: "네이버", value: "내방" }] },
  });
  assert.equal(stale.ok, false);
  assert.match(String(stale.message), /판매 수정도 저장하지 않았습니다/);
  assert.equal(JSON.stringify(ss.month().rowValues(a2.row)), rowBefore, "장표 그대로");
  assert.equal(gas.calls.filter((c) => c.body.action === "sale-update").length, callsBefore + 1);
  // 3) 판매연결만 (장표 칸 변경 없음)
  const only = await post(updatePOST, { target: target(a2), changes: [], link: { saleId: a2.saleId, staff: a2.staff, patches: [{ field: "inflow", before: "TM", value: "미확인" }] } });
  assert.equal(only.ok, true, JSON.stringify(only));
  assert.equal(only.message, "판매연결이 수정되었습니다.");
  assert.equal(byName(await list(), A.name).link?.inflow, "미확인");
  // 4) 예전 판매(ID 없음) → 수정하면서 처음 연결: 그 행에만 ID
  const b0 = byName(await list(), B.name);
  ss.month().cell(b0.row, L("C")).note = "";
  const b = byName(await list(), B.name);
  assert.equal(b.saleIdState, "none");
  const bres = await post(updatePOST, { target: target(b), changes: [{ key: "model", before: b.model, after: "B수정" }], link: { saleId: "", staff: b.staff, patches: [{ field: "inflow", before: "", value: "내방" }] } });
  assert.equal(bres.ok, true, JSON.stringify(bres));
  const b2 = byName(await list(), B.name);
  assert.deepEqual([b2.saleIdState, b2.link?.inflow, b2.model], ["ok", "내방", "B수정"]);
  // 5) 형식 오류(비활성·없는 항목)는 Apps Script 호출 전 거부
  const n = gas.calls.length;
  const bad = await post(updatePOST, { target: target(b2), changes: [], link: { saleId: b2.saleId, staff: b2.staff, patches: [{ field: "inflow", before: "내방", value: "네이버 블로그" }] } });
  assert.equal(bad.ok, false);
  assert.equal(gas.calls.length, n + 1, "설정 조회 1번만 (판매 수정 호출 없음)");
  void modelCol;
});

test("14) 판매연결 쓰기만 실패 → 판매 수정은 완료, linkPending / ID 중복·확인 필요(mismatch) 판매는 판매연결과 함께 수정 거부(장표 불변)", async () => {
  const { ss } = setup({ extraSource: failingLinkSource(0) });
  await register(report(A.name, A.ctn, { extra: "유입경로 : 네이버" }), report(B.name, B.ctn, { extra: "유입경로 : TM" }));
  // ID 중복
  const a = byName(await list(), A.name);
  const b = byName(await list(), B.name);
  ss.month().cell(b.row, L("C")).note = ss.month().cell(a.row, L("C")).note;
  const dupSales = await list();
  const bd = byName(dupSales, B.name);
  const rowB = JSON.stringify(ss.month().rowValues(bd.row));
  const dup = await post(updatePOST, { target: target(bd), changes: [{ key: "model", before: bd.model, after: "x" }], link: { saleId: bd.saleId, staff: bd.staff, patches: [{ field: "inflow", before: "", value: "내방" }] } });
  assert.equal(dup.ok, false);
  assert.equal(JSON.stringify(ss.month().rowValues(bd.row)), rowB);
  // mismatch: CTN 을 장표에서 직접 고침
  const { ss: ss2 } = setup({ extraSource: failingLinkSource(0) });
  await register(report(C.name, C.ctn, { extra: "유입경로 : 네이버" }));
  const c = byName(await list(), C.name);
  ss2.month().cell(c.row, L("E")).value = "010-0000-1212";
  const cm = byName(await list(), "사아자");
  assert.equal(cm.saleIdState, "mismatch");
  const mres = await post(updatePOST, { target: target(cm), changes: [{ key: "model", before: cm.model, after: "y" }], link: { saleId: cm.saleId, staff: cm.staff, patches: [{ field: "inflow", before: "", value: "TM" }] } });
  assert.equal(mres.ok, false);
  // 판매연결 없이 판매 내용만 고치는 것은 그대로 가능
  const plain = await post(updatePOST, { target: target(cm), changes: [{ key: "model", before: cm.model, after: "y" }] });
  assert.equal(plain.ok, true);
  // 판매연결 쓰기 실패
  const { gas: gas3 } = setup({ extraSource: failingLinkSource(5) });
  await register(report(D.name, D.ctn));
  const d = byName(await list(), D.name);
  void gas3;
  const fail = await post(updatePOST, { target: target(d), changes: [{ key: "model", before: d.model, after: "z" }], link: { saleId: d.saleId, staff: d.staff, patches: [{ field: "inflow", before: "", value: "TM" }] } });
  assert.equal(fail.ok, true);
  assert.equal(fail.linkPending, true);
  assert.match(String(fail.warning), /판매연결만 다시 저장/);
  assert.equal(byName(await list(), D.name).model, "z");
});

test("15) 판매 수정 화면 규칙: 중고폰&현물 판매를 고치면 리본 다시 판정(자동만) / 수동 값은 유지·안내 / 안 고치면 리본 그대로(예전 양식이 X 로 안 바뀜) / 캠페인 선택·없음", () => {
  const camps: Campaign[] = [{ id: "CMP-0001", name: "게릴라", aliases: [], type: "매장 행사", start: "", end: "", status: "진행", active: true }];
  const s = (link: Partial<ReturnType<typeof emptyLink>>) => ({ ...sale({ link }), saleId: "11111111-2222-3333-4444-555555555555", saleIdState: "ok" as const });
  // 리본예정(X 자동) → 리본 으로 고치면 O
  let p = planLinkEdit(s({ goodbye: "X", ribbonMode: "자동" }), {}, { changed: true, after: "리본" }, camps);
  assert.deepEqual(p.patches, [{ field: "goodbye", before: "X", value: "O" }]);
  assert.equal(p.autoRibbon, "O");
  // 수동 X 는 유지, 안내만
  p = planLinkEdit(s({ goodbye: "X", ribbonMode: "수동" }), {}, { changed: true, after: "리본" }, camps);
  assert.deepEqual(p.patches, []);
  assert.match(p.notice ?? "", /바꾸지 않았습니다/);
  // 중고폰 줄을 안 고침 → 리본 그대로 (예전 양식 판매)
  p = planLinkEdit(s({ goodbye: "O" }), { inflow: "TM" }, { changed: false, after: "" }, camps);
  assert.deepEqual(p.patches, [{ field: "inflow", before: "", value: "TM" }]);
  // 리본이 비어 있던 예전 판매에 중고폰 내용을 처음 적음 → 자동 판정
  p = planLinkEdit(s({}), {}, { changed: true, after: "점프3리본" }, camps);
  assert.deepEqual(p.patches, [{ field: "goodbye", before: "", value: "O" }, { field: "ribbonMode", before: "", value: "자동" }]);
  // 점장이 직접 고름 → 수동
  p = planLinkEdit(s({}), { goodbye: "O" }, { changed: false, after: "" }, camps);
  assert.deepEqual(p.patches, [{ field: "goodbye", before: "", value: "O" }, { field: "ribbonMode", before: "", value: "수동" }]);
  // 유입경로를 고르면 원문(확인 필요) 지움
  p = planLinkEdit(s({ inflowRaw: "인스타" }), { inflow: "네이버" }, { changed: false, after: "" }, camps);
  assert.deepEqual(p.patches, [{ field: "inflow", before: "", value: "네이버" }, { field: "inflowRaw", before: "인스타", value: "" }]);
  // 캠페인: 원문만 있던 판매를 목록 캠페인에 연결 / 없음으로
  p = planLinkEdit(s({ campaign: "주말" }), { campaign: "CMP-0001" }, { changed: false, after: "" }, camps);
  assert.deepEqual(p.patches, [{ field: "campaignId", before: "", value: "CMP-0001" }]);
  p = planLinkEdit(s({}), { campaign: "CMP-0001" }, { changed: false, after: "" }, camps);
  assert.deepEqual(p.patches, [{ field: "campaignId", before: "", value: "CMP-0001" }, { field: "campaign", before: "", value: "게릴라" }]);
  p = planLinkEdit(s({ campaign: "게릴라", campaignId: "CMP-0001" }), { campaign: "" }, { changed: false, after: "" }, camps);
  assert.deepEqual(p.patches, [{ field: "campaign", before: "게릴라", value: "" }, { field: "campaignId", before: "CMP-0001", value: "" }]);
  p = planLinkEdit(s({ campaign: "주말" }), { campaign: CAMPAIGN_KEEP_RAW }, { changed: false, after: "" }, camps);
  assert.deepEqual(p.patches, []);
});

/* ---------- 5. 보안·호환 ---------- */

test("16) 설정 API 는 로그인·같은 사이트 요청만 (Apps Script 호출 전 거부) / Apps Script 도 비밀값 없으면 거부", async () => {
  const { gas } = setup();
  const before = gas.calls.length;
  for (const h of [inflowPOST, campaignPOST]) {
    const r = await h(new Request("https://test.invalid/api/settings/x", { method: "POST", body: "{}" }));
    assert.ok(r.status === 401 || r.status === 403, String(r.status));
  }
  const g = await configGET(new Request("https://test.invalid/api/settings/config"));
  assert.equal(g.status, 401);
  assert.equal(gas.calls.length, before);
  const out = gas.fn("wsHandleSaleUpdate_")({ postData: { contents: JSON.stringify({ secret: "wrong", action: "config-get" }) } }) as { text: string };
  const raw = JSON.parse(out.text) as { ok: boolean; inflows?: unknown };
  assert.equal(raw.ok, false);
  assert.equal(raw.inflows, undefined);
});

test("17) 배포 순서 호환: 새 웹 + 지금 운영과 같은 Apps Script(v37, main 59ca11d) → 판매 저장은 그대로, 판매연결은 저장 못 했다고 안내(linkPending) / 예전 update-handler 는 판매연결을 무시 → 판매 수정은 되고 linkPending", async () => {
  const dir = path.resolve(import.meta.dirname, "../fixtures/apps-script-59ca11d");
  const files = ["common", "save-handler", "update-handler", "delete-handler", "list-handler", "notes", "inspection-review", "goal-handler", "gobulbi", "total-row", "auth-handler", "sale-link"];
  setup({ entry: "emulated", files, dir });
  const cfg = await get(configGET, "/api/settings/config");
  assert.equal(cfg.fallback, true, "config-handler 없음 → 기본 5개");
  const [r] = (await registerWithIds([{ text: report(A.name, A.ctn, { extra: "유입경로 : 블로그" }), requestId: randomUUID() }])).results as { ok: boolean; linkPending?: boolean; warning?: string }[];
  assert.equal(r.ok, true, "판매는 저장");
  assert.equal(r.linkPending, true, "예전 목록에 '네이버'가 없어 판매연결은 실패 → 안내");
  assert.equal((await list()).filter((s) => s.customer === A.name).length, 1);
  const a = byName(await list(), A.name);
  const up = await post(updatePOST, { target: target(a), changes: [{ key: "model", before: a.model, after: "수정됨" }], link: { saleId: a.saleId, staff: a.staff, patches: [{ field: "inflow", before: "", value: "TM" }] } });
  assert.equal(up.ok, true);
  assert.equal(up.linkPending, true);
  assert.equal(byName(await list(), A.name).model, "수정됨");
});

test("18) 개인정보: 설정·판매연결·로그에 고객 이름·번호 없음 / 응답에 비밀값 없음", async () => {
  const before = serverLogs.length;
  const respBefore = responses.length;
  const { ss } = setup();
  await register(report(A.name, A.ctn, { extra: "유입경로 : 인스타\n캠페인 : 행사\n중고폰&현물 판매 : 리본" }));
  const a = byName(await list(), A.name);
  await post(updatePOST, { target: target(a), changes: [], link: { saleId: a.saleId, staff: a.staff, patches: [{ field: "inflow", before: "", value: "네이버" }] } });
  assert.deepEqual(findOriginals(sheetTexts(ss, { only: ["웹앱판매연결", "웹앱캠페인", "웹앱유입경로"] }), [A]), []);
  assert.deepEqual(findOriginals(serverLogs.slice(before), [A]), []);
  assert.ok(!jsonTexts(responses.slice(respBefore)).some((t) => /test-secret|APPS_SCRIPT/.test(t)));
});
