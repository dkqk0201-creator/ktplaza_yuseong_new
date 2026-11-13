/*
 * 테스트 전용 진입 파일 apps-script-test/test-entry.gs 검증 (인증 테스트용 — auth-login 브랜치) (가짜 시트만, 실제 시트·Apps Script 접근 없음).
 *   - 인증 → 테스트 시트 연결 확인이 시트 칸 접근보다 먼저
 *   - 운영 시트 ID·ID 불일치·시트에 붙은 프로젝트·기존 Code.gs 섞임·파일 누락이면 읽기·쓰기 모두 거부
 *   - 기존 핸들러를 운영 흉내와 같은 순서로 빠짐없이, 한 번씩
 *   - doGet·편집기 실행 함수가 보호 장치를 우회하지 않음
 * 전체 기능 회귀는 GAS_ENTRY=test-entry ./run.sh 로 같은 테스트 묶음을 이 진입 파일로 다시 돌린다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import vm from "node:vm";
import { setup, register, report, list } from "../harness/web.ts";
import { makeGas, SECRET, TEST_ENTRY_PATH, TEST_PROJECT_FILES, APPS_SCRIPT_DIR } from "../harness/gas.ts";
import { FakeSpreadsheet, TEST_SHEET_ID } from "../harness/fake-spreadsheet.ts";
import { PEOPLE } from "../harness/fake-people.ts";
import { findOriginals } from "../harness/privacy.ts";

const [A] = PEOPLE;
const ENTRY = { entry: "test-entry" as const };
// 운영 시트 ID 는 코드에 두지 않는다. 테스트에서는 test-entry.gs 의 SHA-256 과 같아지는 가짜 값이 필요하므로,
// "운영 흉내" 는 해시 목록을 테스트 시트 해시로 바꿔치기한 소스로 시험한다 (아래 prodLike).
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const PROD_HASH = "1abf293ff422814926724c91f55505ff5173b28f65d856223c4a7a6bb12f98e3";
const FAKE_PROD_ID = "FAKE-PROD-SHEET-ID-0000000000000000000000";
const prodLike = (src: string) => src.replace(PROD_HASH, sha(FAKE_PROD_ID));

/** 같은 요청 묶음: 읽기·쓰기·확인 각각 */
const REQUESTS: Record<string, Record<string, unknown>> = {
  list: { action: "list", sheet: "10월" },
  save: { action: "save", rows: [Array(38).fill(null).map((_, i) => (i === 2 ? "2026-10-05" : i === 3 ? A.name : i === 4 ? A.ctn : i === 8 ? "기기변경" : i === 12 ? "김수현" : null))] },
  update: { action: "sale-update", target: { sheet: "10월", row: 9, no: "1", activatedAt: "2026-10-05", customer: "x", ctn: "x" }, changes: [{ col: 19, before: "", value: 1 }] },
  delete: { action: "delete", target: { sheet: "10월", row: 9, no: "1", activatedAt: "2026-10-05", customer: "x", ctn: "x" } },
  review: { action: "inspection-review", op: "save", target: { sheet: "10월", row: 9 }, before: "", content: "x" },
  gobulbi: { action: "gobulbi", op: "list", month: "2026-10" },
  goal: { action: "goal-set", month: "2026-10", goal: 5 },
  authCheck: { action: "auth-check", session: "a".repeat(64) },
  authLogin: { action: "auth-login", result: "ok", session: "b".repeat(64), exp: Math.floor(Date.now() / 1000) + 3600, step: 1 },
};

function expectBlocked(name: string, opts: Parameters<typeof makeGas>[1], why: RegExp) {
  for (const [kind, body] of Object.entries(REQUESTS)) {
    const ss = new FakeSpreadsheet(["10월"]);
    const gas = makeGas(ss, { ...ENTRY, ...opts });
    const before = JSON.stringify(ss.getSheets().map((s) => s.rows));
    ss.sheetAccess = 0;
    const r = gas.doPost(body);
    assert.equal(r.ok, false, `${name} / ${kind}`);
    assert.equal(r.handler, "ws-test-guard", `${name} / ${kind}: ${r.message}`);
    assert.match(r.message, why, `${name} / ${kind}`);
    assert.equal(ss.sheetAccess, 0, `${name} / ${kind}: 시트(탭)에 접근하지 않아야 함`);
    assert.equal(JSON.stringify(ss.getSheets().map((s) => s.rows)), before);
    assert.equal(gas.props.get("WIRELESS_GOAL_2026-10"), undefined, `${name}: 목표(스크립트 속성)도 쓰지 않음`);
    assert.equal(gas.props.get("WS_AUTH_STATE"), undefined, `${name}: 로그인 상태(스크립트 속성)도 쓰지 않음`);
    assert.deepEqual(findOriginals([JSON.stringify(r)], [A]), []);
  }
}

test("1) 정상 연결: ws-env-check 는 시트 칸에 접근하지 않고 이름·ID 끝자리·핸들러 목록만", () => {
  const ss = new FakeSpreadsheet();
  const gas = makeGas(ss, ENTRY);
  ss.sheetAccess = 0;
  const r = gas.doPost({ action: "ws-env-check" });
  assert.equal(r.ok, true, r.message);
  assert.deepEqual([r.entry, r.name, r.idTail], ["test-entry", "무선장표 테스트전용", TEST_SHEET_ID.slice(-6)]);
  assert.deepEqual(r.handlers, ["wsHandleSaleUpdate_", "handleGoalRequest_", "handleSaveRequest_", "handleDeleteRequest_", "handleListRequest_"]);
  assert.equal(ss.sheetAccess, 0);
  assert.deepEqual(gas.opened, [TEST_SHEET_ID]);
});

test("2) 인증 실패(비밀값 틀림·없음·스크립트 속성 비어 있음)는 시트를 열기 전에 거부", () => {
  for (const [label, contents, props] of [
    ["틀린 secret", JSON.stringify({ secret: "wrong", action: "list" }), {}],
    ["secret 없음", JSON.stringify({ action: "list" }), {}],
    ["JSON 아님", "not json", {}],
    ["API_SECRET 미설정", JSON.stringify({ secret: SECRET, action: "list" }), { API_SECRET: null }],
    ["빈 secret 끼리", JSON.stringify({ secret: "", action: "list" }), { API_SECRET: "" }],
  ] as const) {
    const ss = new FakeSpreadsheet();
    const gas = makeGas(ss, { ...ENTRY, props: props as Record<string, string | null> });
    const r = gas.rawPost(contents);
    assert.equal(r.ok, false, label);
    assert.match(r.message, /인증/, label);
    assert.deepEqual(gas.opened, [], `${label}: 시트를 열지 않음`);
    assert.equal(ss.sheetAccess, 0, label);
  }
});

test("3) 스크립트 속성 SPREADSHEET_ID 가 운영 시트 → 읽기·쓰기 모두 거부 (시트를 열지도 않음)", () => {
  expectBlocked("속성=운영", { entrySource: prodLike, props: { SPREADSHEET_ID: FAKE_PROD_ID } }, /운영 시트/);
  const gas = makeGas(new FakeSpreadsheet(), { ...ENTRY, entrySource: prodLike, props: { SPREADSHEET_ID: FAKE_PROD_ID } });
  gas.doPost(REQUESTS.list);
  assert.deepEqual(gas.opened, []);
});

test("4) 코드의 WS_TEST_CONFIG.SPREADSHEET_ID 를 운영 ID 로 바꿔도 거부", () => {
  const src = (s: string) => prodLike(s).replace(`SPREADSHEET_ID: "${TEST_SHEET_ID}"`, `SPREADSHEET_ID: "${FAKE_PROD_ID}"`);
  expectBlocked("CONFIG=운영", { entrySource: src, props: { SPREADSHEET_ID: FAKE_PROD_ID } }, /운영 시트/);
});

test("5) 시트 ID 불일치 (속성 ≠ 코드, 속성 없음) → 거부", () => {
  expectBlocked("속성≠코드", { props: { SPREADSHEET_ID: "OTHER-TEST-SHEET-ID-111111111111111111111" } }, /다름/);
  expectBlocked("속성 없음", { props: { SPREADSHEET_ID: null } }, /SPREADSHEET_ID 없음/);
});

test("6) 실제로 열린 시트가 다름 (ID 가 운영·다른 시트, 이름에 '테스트' 없음) → 거부", () => {
  // 실제로 열린 시트의 ID 가 운영
  const ss = new FakeSpreadsheet();
  ss.id = FAKE_PROD_ID;
  const gas = makeGas(ss, { ...ENTRY, entrySource: prodLike, props: { SPREADSHEET_ID: TEST_SHEET_ID } });
  // openById(TEST) 가 운영 흉내 시트를 돌려주는 경우 (예: ID 를 잘못 붙여 넣은 별도 경로)
  (gas.ctx.SpreadsheetApp as { openById: (id: string) => unknown }).openById = () => ss;
  ss.sheetAccess = 0;
  for (const body of Object.values(REQUESTS)) {
    const r = gas.doPost(body);
    assert.equal(r.ok, false);
    assert.match(r.message, /운영 시트|테스트 시트가 아님/);
  }
  assert.equal(ss.sheetAccess, 0);
  // 열린 시트가 운영은 아니지만 다른 시트 (이름에 '테스트' 가 있어도)
  const other = new FakeSpreadsheet();
  other.id = "OTHER-TEST-SHEET-ID-222222222222222222222";
  other.name = "다른 테스트 시트";
  const g1 = makeGas(new FakeSpreadsheet(), ENTRY);
  (g1.ctx.SpreadsheetApp as { openById: (id: string) => unknown }).openById = () => other;
  other.sheetAccess = 0;
  for (const body of Object.values(REQUESTS)) assert.match(g1.doPost(body).message, /테스트 시트가 아님/);
  assert.equal(other.sheetAccess, 0);
  // 이름에 '테스트' 없음
  const ss2 = new FakeSpreadsheet();
  ss2.name = "무선장표";
  const g2 = makeGas(ss2, ENTRY);
  ss2.sheetAccess = 0;
  for (const body of Object.values(REQUESTS)) assert.match(g2.doPost(body).message, /'테스트' 없음/);
  assert.equal(ss2.sheetAccess, 0);
});

test("7) 시트에 붙은 프로젝트(기존 프로젝트처럼)에서 실행되면 거부", () => {
  expectBlocked("붙은 프로젝트", { bound: true }, /붙은 프로젝트/);
});

test("8) 기존 Code.gs(CONFIG)가 섞여 있으면 거부 — 운영 시트를 가리키는 CONFIG 가 있어도 그 경로로 가지 않음", () => {
  const codeGs = `var CONFIG = { SPREADSHEET_ID: "${FAKE_PROD_ID}" };`;
  expectBlocked("Code.gs 섞임", { extraSource: codeGs }, /Code\.gs/);
});

test("9) 파일이 하나라도 빠지면 거부 (어느 파일이 빠졌는지 표시)", () => {
  for (const missing of TEST_PROJECT_FILES) {
    const ss = new FakeSpreadsheet();
    const gas = makeGas(ss, { ...ENTRY, files: TEST_PROJECT_FILES.filter((f) => f !== missing) });
    ss.sheetAccess = 0;
    const r = gas.doPost(REQUESTS.list);
    assert.equal(r.ok, false, missing);
    assert.match(r.message, /빠진 파일/, missing);
    assert.equal(ss.sheetAccess, 0, missing);
  }
});

test("10) 핸들러 호출 순서: 운영 흉내와 같은 순서로 한 번씩, 처음 응답한 곳에서 멈춤 (요청 종류별)", () => {
  // test-entry.gs 의 순서와 운영 Code.gs doPost 순서(2026-11-09 확인)는 다르지만, 핸들러마다 받는 action 이 겹치지 않아 결과는 같다
  const chains = {
    "test-entry": ["wsHandleSaleUpdate_", "handleGoalRequest_", "handleSaveRequest_", "handleDeleteRequest_", "handleListRequest_"],
    emulated: ["wsHandleSaleUpdate_", "handleListRequest_", "handleDeleteRequest_", "handleSaveRequest_", "handleGoalRequest_"],
  } as const;
  const expectStop: Record<string, string | null> = {
    list: "handleListRequest_", save: "handleSaveRequest_", update: "wsHandleSaleUpdate_", delete: "handleDeleteRequest_",
    review: "wsHandleSaleUpdate_", gobulbi: "wsHandleSaleUpdate_", goal: "handleGoalRequest_", authCheck: "wsHandleSaleUpdate_", authLogin: "wsHandleSaleUpdate_",
  };
  for (const [kind, body] of [...Object.entries(REQUESTS), ["unknown", { action: "nothing" }] as const]) {
    for (const entry of ["test-entry", "emulated"] as const) {
      const chain = chains[entry];
      const gas = makeGas(new FakeSpreadsheet(), { entry });
      const seen: string[] = [];
      for (const name of chain) {
        const orig = gas.ctx[name] as (e: unknown) => unknown;
        gas.ctx[name] = (e: unknown) => { seen.push(name); return orig(e); };
      }
      gas.doPost(body as Record<string, unknown>);
      const stop = kind === "unknown" ? null : expectStop[kind];
      const want = stop ? chain.slice(0, chain.indexOf(stop) + 1) : chain;
      assert.deepEqual(seen, want, `${entry} / ${kind}`);
    }
  }
});

test("11) 같은 요청은 test-entry 와 운영 흉내 진입이 같은 결과·같은 시트 변경", async () => {
  for (const entry of ["test-entry", "emulated"] as const) {
    const { ss, gas } = setup({ entry });
    const r = await register(report(A.name, A.ctn));
    assert.equal(r.results[0].ok, true, `${entry}: ${JSON.stringify(r.results[0])}`);
    const sales = await list();
    assert.equal(sales.length, 1);
    assert.equal(gas.entry, entry);
    if (entry === "test-entry") assert.match(String(gas.ctx.doPost), /wsTestCheck_/, "doPost = test-entry.gs 의 것");
    assert.equal(ss.month().rows.length > 0, true);
  }
});

test("12) doGet 은 시트에 접근하지 않음 / 공개 함수는 doPost·doGet·wsTestSelfCheck 뿐 (편집기 실행 함수 total-row 는 프로젝트에서 제외)", () => {
  const ss = new FakeSpreadsheet();
  const gas = makeGas(ss, ENTRY);
  ss.sheetAccess = 0;
  const out = JSON.parse((gas.ctx.doGet as () => { text: string })().text);
  assert.equal(out.ok, false);
  assert.equal(ss.sheetAccess, 0);
  assert.deepEqual(gas.opened, []);
  // 테스트 프로젝트 파일 전체에서 _ 로 끝나지 않는 함수(편집기·google.script.run 으로 부를 수 있는 함수)
  const sources = [...TEST_PROJECT_FILES.map((f) => readFileSync(`${APPS_SCRIPT_DIR}/${f}.gs`, "utf8")), readFileSync(TEST_ENTRY_PATH, "utf8")];
  const publicFns = sources.flatMap((s) => [...s.matchAll(/^function\s+([A-Za-z0-9_$]+)\s*\(/gm)].map((m) => m[1])).filter((n) => !n.endsWith("_"));
  // 편집기 실행 함수: wsAuthReset(로그인 잠금 해제), 판매 ID 일괄 부여 미리보기·적용(시트 이름을 직접 적어야 동작)
  assert.deepEqual(publicFns.sort(), ["doGet", "doPost", "wsAuthReset", "wsSaleIdBackfillApply", "wsSaleIdBackfillPreview", "wsTestSelfCheck"]);
  // 트리거 이름 함수 없음
  assert.ok(sources.every((s) => !/function\s+(onOpen|onEdit|onInstall|onFormSubmit|onChange)\s*\(/.test(s)));
  // 같은 이름 함수가 두 파일에 있지 않음 (뒤 파일이 앞 파일을 덮어쓰는 일 없음)
  const all = sources.flatMap((s) => [...s.matchAll(/^function\s+([A-Za-z0-9_$]+)\s*\(/gm)].map((m) => m[1]));
  assert.deepEqual(all.filter((n, i) => all.indexOf(n) !== i), []);
  // 전역 변수 이름도 겹치지 않음
  const vars = sources.flatMap((s) => [...s.matchAll(/^var\s+([A-Za-z0-9_$]+)/gm)].map((m) => m[1]));
  assert.deepEqual(vars.filter((n, i) => vars.indexOf(n) !== i), []);
});

test("13) wsTestSelfCheck: 정상이면 true, 다른 doPost 가 이기면(기존 Code.gs 를 뒤에 둔 경우) false 로 알림", () => {
  const ok = makeGas(new FakeSpreadsheet(), ENTRY);
  assert.equal((ok.ctx.wsTestSelfCheck as () => boolean)(), true);
  assert.match(ok.logs.join("\n"), /test-entry\.gs 의 것: 예[\s\S]*연결: 정상/);
  const lost = makeGas(new FakeSpreadsheet(), { ...ENTRY, extraSource: "function doPost(e) { return null; }" });
  assert.equal((lost.ctx.wsTestSelfCheck as () => boolean)(), false);
  assert.match(lost.logs.join("\n"), /아니오 \(다른 파일에 doPost/);
});

test("14) 코드·저장소에 운영 시트 ID 와 비밀값이 없음", () => {
  const entry = readFileSync(TEST_ENTRY_PATH, "utf8");
  assert.equal(sha(TEST_SHEET_ID) !== PROD_HASH, true);
  assert.ok(entry.includes(PROD_HASH));
  assert.doesNotMatch(entry, /1lQ9/);
  assert.doesNotMatch(entry, /API_SECRET\s*[:=]\s*["'][^"']+["']/);
  void vm;
});
