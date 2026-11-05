/*
 * 단일 관리자 로그인 (비밀번호 + OTP) — 가짜 비밀값·가짜 Apps Script 만 사용.
 *   - 모든 업무 API: 로그인하지 않은 요청은 거부되고 업무 요청이 Apps Script 로 가지 않음
 *   - OTP: RFC 6238 값, 시계 오차 ±30초, 같은 코드 재사용 거부
 *   - 시도 제한: Apps Script 한 곳에 기록 (서버 인스턴스가 여러 개여도 공통), 잠기면 맞는 값도 거부
 *   - 로그아웃: 서버 측 무효화 (쿠키를 복사해 둔 경우에도 즉시 거부), 모든 기기 로그아웃
 *   - 설정값 도구(tools/auth-setup.html)가 만든 값이 서버와 맞음
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { createHmac, webcrypto } from "node:crypto";
import path from "node:path";
import vm from "node:vm";
import { setup, connect, register, report, list, authed, serverLogs, responses, TEST_PASSWORD, TEST_TOTP_KEY, ORIGIN } from "../harness/web.ts";
import { makeGas } from "../harness/gas.ts";
import { FakeSpreadsheet } from "../harness/fake-spreadsheet.ts";
import { PEOPLE } from "../harness/fake-people.ts";
import { totpCode, verifyTotp, verifyPassword, parsePasswordHash, base32Decode, signSession, sessionIdHash } from "@/lib/server/auth";
import { POST as loginPOST } from "@/app/api/auth/login/route";
import { POST as logoutPOST } from "@/app/api/auth/logout/route";
import { GET as listGET } from "@/app/api/sales/list/route";
import { POST as quickPOST } from "@/app/api/sales/quick/route";
import { POST as updatePOST } from "@/app/api/sales/update/route";
import { POST as deletePOST } from "@/app/api/sales/delete/route";
import { POST as markDonePOST } from "@/app/api/sales/mark-done/route";
import { POST as cardPOST } from "@/app/api/sales/card-check/route";
import { POST as reviewPOST } from "@/app/api/sales/review/route";
import { GET as goalsGET, POST as goalsPOST } from "@/app/api/goals/route";
import { GET as gobulbiGET, POST as gobulbiPOST } from "@/app/api/budget/gobulbi/route";

const WS = path.resolve(import.meta.dirname, "../../wireless-sales");
const [A] = PEOPLE;
const step = (ms = Date.now()) => Math.floor(ms / 30000);
const code = (ms = Date.now()) => totpCode(TEST_TOTP_KEY, step(ms));
const sessionKey = () => Buffer.from(process.env.AUTH_SESSION_SECRET!, "utf8");

type Handler = (r: Request) => Promise<Response>;
/** 업무 API 전부 (경로, 메서드, 함수, 정상 형식의 요청 본문) */
const ROUTES: [string, "GET" | "POST", Handler, unknown][] = [
  ["/api/sales/list?sheet=10월", "GET", listGET, undefined],
  ["/api/sales/quick", "POST", quickPOST, { items: [] }],
  ["/api/sales/update", "POST", updatePOST, { target: {}, changes: [] }],
  ["/api/sales/delete", "POST", deletePOST, {}],
  ["/api/sales/mark-done", "POST", markDonePOST, {}],
  ["/api/sales/card-check", "POST", cardPOST, {}],
  ["/api/sales/review", "POST", reviewPOST, {}],
  ["/api/goals?month=2026-10", "GET", goalsGET, undefined],
  ["/api/goals", "POST", goalsPOST, { month: "2026-10", goal: 5 }],
  ["/api/budget/gobulbi?month=2026-10", "GET", gobulbiGET, undefined],
  ["/api/budget/gobulbi", "POST", gobulbiPOST, { op: "create", month: "2026-10", id: "test-0000-0001", content: "x", amount: 1, seller: "x" }],
];

function req(url: string, method: string, body: unknown, headers: Record<string, string>) {
  return new Request(new URL(url, ORIGIN), { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
async function login(password: string, otp: string, headers: Record<string, string> = { origin: ORIGIN }) {
  const r = await loginPOST(req("/api/auth/login", "POST", { password, otp }, headers));
  return { status: r.status, cookie: r.headers.get("set-cookie") ?? "", body: (await r.json()) as Record<string, unknown> };
}
const cookieOf = (setCookie: string) => setCookie.split(";")[0];
const dataCalls = (gas: { calls: { body: Record<string, unknown> }[] }) =>
  gas.calls.filter((c) => !String(c.body.action ?? "").startsWith("auth-"));

test("1) OTP: RFC 6238 시험값 (6자리) / 시계 오차 ±30초 허용, ±90초는 거부", () => {
  const key = Buffer.from("12345678901234567890");
  for (const [t, want] of [[59, "287082"], [1111111109, "081804"], [1234567890, "005924"], [2000000000, "279037"]] as const) {
    assert.equal(totpCode(key, Math.floor(t / 30)), want);
  }
  const now = Date.now();
  assert.equal(verifyTotp(TEST_TOTP_KEY, code(now - 30000), now), step(now) - 1);
  assert.equal(verifyTotp(TEST_TOTP_KEY, code(now + 30000), now), step(now) + 1);
  assert.equal(verifyTotp(TEST_TOTP_KEY, code(now - 90000), now), null);
  assert.equal(verifyTotp(TEST_TOTP_KEY, code(now + 90000), now), null);
  assert.equal(verifyTotp(TEST_TOTP_KEY, "12345", now), null);
  assert.equal(verifyTotp(TEST_TOTP_KEY, "abcdef", now), null);
});

test("2) 모든 업무 API 파일: 내보낸 GET·POST 의 첫 동작이 requireAuth (새 API 를 추가하고 빼먹으면 실패)", () => {
  const files: string[] = [];
  const walk = (d: string) => { for (const f of readdirSync(d)) { const p = path.join(d, f); if (statSync(p).isDirectory()) walk(p); else if (f === "route.ts") files.push(p); } };
  walk(path.join(WS, "app/api"));
  const business = files.filter((f) => !f.includes(`${path.sep}auth${path.sep}`));
  assert.equal(business.length, 9);
  let handlers = 0;
  for (const f of business) {
    const src = readFileSync(f, "utf8");
    const fns = [...src.matchAll(/export (?:async )?function (GET|POST|PUT|PATCH|DELETE)\(request: Request\) \{\s*(?:\/\/[^\n]*\n\s*)*const denied = await requireAuth\(request\);\s*if \(denied\) return denied;/g)];
    const exported = [...src.matchAll(/export (?:async )?function (GET|POST|PUT|PATCH|DELETE)\b/g)];
    assert.equal(fns.length, exported.length, `${path.relative(WS, f)}: 인증 확인이 맨 앞에 없는 함수`);
    assert.doesNotMatch(src, /export (const|let|var) (GET|POST|PUT|PATCH|DELETE)\b/, f);
    handlers += exported.length;
  }
  assert.equal(handlers, ROUTES.length);
});

test("3) 로그인하지 않은 요청: 쿠키 없음·위조·만료·형식 오류 → 401, Apps Script 호출 0건 (업무·로그인 상태 모두)", async () => {
  const { gas } = setup();
  const now = Math.floor(Date.now() / 1000);
  const sid = "A".repeat(32);
  const forged = `v1.${sid}.${now + 3600}.${"x".repeat(43)}`;
  const otherKey = signSession(Buffer.from("다른-키".repeat(8)), sid, now + 3600);
  const expired = signSession(sessionKey(), sid, now - 1);
  const tooLong = signSession(sessionKey(), sid, now + 13 * 3600 + 120);
  for (const cookie of ["", `__Host-ws_session=${forged}`, `__Host-ws_session=${otherKey}`, `__Host-ws_session=${expired}`, `__Host-ws_session=${tooLong}`, "__Host-ws_session=garbage", `ws_session=${signSession(sessionKey(), sid, now + 60)}`]) {
    for (const [url, method, fn, body] of ROUTES) {
      gas.calls.length = 0;
      const headers: Record<string, string> = { origin: ORIGIN, ...(cookie ? { cookie } : {}) };
      const r = await fn(req(url, method, body, headers));
      assert.equal(r.status, 401, `${method} ${url} / ${cookie.slice(0, 30)}`);
      assert.equal(gas.calls.length, 0, `${method} ${url}: Apps Script 호출 없음`);
    }
  }
});

test("4) 서명은 맞지만 서버에 없는 세션(로그아웃·위조 등록) → 401, 세션 확인 1건 외 업무 호출 0건", async () => {
  const { gas } = setup();
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const cookie = `__Host-ws_session=${signSession(sessionKey(), "B".repeat(32), exp)}`;
  for (const [url, method, fn, body] of ROUTES) {
    gas.calls.length = 0;
    const r = await fn(req(url, method, body, { origin: ORIGIN, cookie }));
    assert.equal(r.status, 401, `${method} ${url}`);
    assert.deepEqual(gas.calls.map((c) => c.body.action), ["auth-check"]);
  }
});

test("5) 다른 사이트에서 보낸 쓰기 요청(Origin 다름·없음) → 403, Apps Script 호출 0건 / GET 은 Origin 없이도 됨", async () => {
  const { gas } = setup();
  const good = authed("/x").headers.get("cookie")!;
  for (const [url, method, fn, body] of ROUTES.filter((r) => r[1] === "POST")) {
    for (const headers of [{ cookie: good, origin: "https://evil.example" }, { cookie: good }, { cookie: good, "sec-fetch-site": "cross-site" }]) {
      gas.calls.length = 0;
      const r = await fn(req(url, method, body, headers));
      assert.equal(r.status, 403, `${url} ${JSON.stringify(headers).slice(0, 60)}`);
      assert.equal(gas.calls.length, 0);
    }
  }
  const ok = await listGET(req("/api/sales/list?sheet=10월", "GET", undefined, { cookie: good }));
  assert.equal(ok.status, 200);
});

test("6) 인증 설정이 없거나 틀리면 모든 API·로그인 503 (열리지 않음), Apps Script 호출 0건", async () => {
  const { gas } = setup();
  const saved = { ...process.env };
  try {
    for (const [k, v] of [["AUTH_PASSWORD_HASH", undefined], ["AUTH_PASSWORD_HASH", "pbkdf2-sha256$1000$AAAAAAAAAAAAAAAAAAAAAA$" + "A".repeat(43)], ["AUTH_TOTP_SECRET", "SHORT"], ["AUTH_SESSION_SECRET", "short"]] as const) {
      Object.assign(process.env, saved);
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
      gas.calls.length = 0;
      for (const [url, method, fn, body] of ROUTES) {
        const r = await fn(authed(url, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }));
        assert.equal(r.status, 503, `${k} / ${url}`);
      }
      assert.equal((await login(TEST_PASSWORD, code())).status, 503);
      assert.equal(gas.calls.length, 0, k);
    }
  } finally {
    Object.assign(process.env, saved);
  }
});

test("7) Apps Script 로그인 처리가 없거나 응답하지 않으면 막는다 (fail closed)", async () => {
  // auth-handler.gs 가 배포되지 않은 Apps Script
  const env = { gas: makeGas(new FakeSpreadsheet(), { files: ["common", "save-handler", "update-handler", "delete-handler", "list-handler", "notes", "inspection-review", "goal-handler", "gobulbi"] }) };
  connect(env.gas);
  const r = await listGET(authed("/api/sales/list?sheet=10월"));
  assert.equal(r.status, 503);
  assert.equal(dataCalls(env.gas).length, 0);
  const l = await login(TEST_PASSWORD, code());
  assert.equal(l.status, 503);
  assert.equal(l.cookie, "");
  // 통신 실패
  globalThis.fetch = (async () => { throw new TypeError("network"); }) as typeof fetch;
  assert.equal((await listGET(authed("/api/sales/list?sheet=10월"))).status, 503);
  assert.equal((await login(TEST_PASSWORD, code())).cookie, "");
});

test("8) 로그인 성공: 쿠키 속성(HttpOnly·Secure·SameSite=Strict·Path=/·__Host-), 그 쿠키로 업무 API 사용", async () => {
  const { gas } = setup();
  const r = await login(TEST_PASSWORD, code());
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.match(r.cookie, /^__Host-ws_session=v1\.[A-Za-z0-9_-]{32}\.\d{10}\.[A-Za-z0-9_-]{43}; Path=\/; HttpOnly; Secure; SameSite=Strict; Max-Age=43200$/);
  await register(report(A.name, A.ctn));
  const res = await listGET(req("/api/sales/list?sheet=10월", "GET", undefined, { cookie: cookieOf(r.cookie) }));
  assert.equal(res.status, 200);
  assert.equal(((await res.json()) as { sales: unknown[] }).sales.length, 1);
  // Apps Script 에는 세션ID 가 아니라 SHA-256 값만 저장
  const sid = cookieOf(r.cookie).split(".")[1];
  const state = String(gas.ctx.PropertiesService && (gas.ctx.PropertiesService as { getScriptProperties: () => { getProperty: (k: string) => string } }).getScriptProperties().getProperty("WS_AUTH_STATE"));
  assert.doesNotMatch(state, new RegExp(sid));
  assert.match(state, new RegExp(sessionIdHash(sid)));
});

test("9) 비밀번호·OTP 중 하나라도 틀리면 같은 401 메시지 / 같은 OTP 다시 쓰기 거부 / 이전 칸 OTP 거부", async () => {
  setup();
  const bad = [await login("wrong-password", code()), await login(TEST_PASSWORD, "000000"), await login("", "")];
  for (const r of bad) {
    assert.equal(r.status, 401);
    assert.equal(r.body.message, bad[0].body.message);
    assert.equal(r.cookie, "");
  }
  const c = code();
  assert.equal((await login(TEST_PASSWORD, c)).status, 200);
  const replay = await login(TEST_PASSWORD, c);
  assert.equal(replay.status, 401, "같은 OTP 재사용");
  assert.equal(replay.cookie, "");
  assert.equal((await login(TEST_PASSWORD, code(Date.now() - 30000))).status, 401, "이미 쓴 칸보다 이전 칸");
});

test("10) 시도 제한: 연속 5회 실패하면 잠김 → 맞는 값도 429, 잠금은 Apps Script 한 곳(서버 인스턴스 공통)에 기록, 시간이 지나면 풀리고 다시 잠기면 2배", async () => {
  let shift = 0;
  const ss = new FakeSpreadsheet();
  const gas = makeGas(ss, { now: () => Date.now() + shift });
  globalThis.fetch = (async (_u: string, init: RequestInit) => { const { secret: _s, ...b } = JSON.parse(String(init.body)); return Response.json(gas.doPost(b)); }) as typeof fetch;
  for (let i = 0; i < 4; i++) assert.equal((await login("wrong", code())).status, 401);
  const fifth = await login("wrong", code());
  assert.equal(fifth.status, 429);
  const locked = await login(TEST_PASSWORD, code());
  assert.equal(locked.status, 429, "잠긴 동안은 맞는 비밀번호·OTP 도 거부");
  assert.equal(locked.cookie, "");
  const props = (gas.ctx.PropertiesService as { getScriptProperties: () => { getProperty: (k: string) => string } }).getScriptProperties();
  const state = JSON.parse(props.getProperty("WS_AUTH_STATE"));
  assert.ok(state.lockUntil > Date.now() + 14 * 60000 && state.lockUntil <= Date.now() + 15 * 60000 + 5000);
  // 웹 서버(다른 인스턴스)는 상태를 갖고 있지 않다: 같은 Apps Script 상태를 보는 새 가짜 Apps Script 도 잠김
  const gas2 = makeGas(ss, { now: () => Date.now() + shift });
  (gas2.ctx.PropertiesService as { getScriptProperties: () => { setProperty: (k: string, v: string) => void } }).getScriptProperties().setProperty("WS_AUTH_STATE", props.getProperty("WS_AUTH_STATE"));
  globalThis.fetch = (async (_u: string, init: RequestInit) => { const { secret: _s, ...b } = JSON.parse(String(init.body)); return Response.json(gas2.doPost(b)); }) as typeof fetch;
  assert.equal((await login(TEST_PASSWORD, code())).status, 429);
  // 16분 뒤 풀림 → 다시 5회 실패하면 30분 잠금
  shift = 16 * 60000;
  for (let i = 0; i < 5; i++) await login("wrong", code());
  const s2 = JSON.parse((gas2.ctx.PropertiesService as { getScriptProperties: () => { getProperty: (k: string) => string } }).getScriptProperties().getProperty("WS_AUTH_STATE"));
  assert.ok(s2.lockUntil - (Date.now() + shift) > 29 * 60000, "두 번째 잠금은 30분");
  shift += 31 * 60000;
  assert.equal((await login(TEST_PASSWORD, code())).status, 200, "잠금이 끝나면 로그인 가능");
});

test("11) 로그아웃 = 서버 측 무효화: 복사해 둔 쿠키도 즉시 401 / 다른 기기 세션은 유지 / 모든 기기 로그아웃", async () => {
  setup();
  const pc = cookieOf((await login(TEST_PASSWORD, code())).cookie);
  const phone = cookieOf((await login(TEST_PASSWORD, code(Date.now() + 30000))).cookie);
  const use = (cookie: string) => listGET(req("/api/sales/list?sheet=10월", "GET", undefined, { cookie })).then((r) => r.status);
  assert.deepEqual([await use(pc), await use(phone)], [200, 200]);
  const out = await logoutPOST(req("/api/auth/logout", "POST", {}, { origin: ORIGIN, cookie: pc }));
  assert.equal(out.status, 200);
  assert.match(out.headers.get("set-cookie") ?? "", /^__Host-ws_session=; .*Max-Age=0$/);
  assert.equal(await use(pc), 401, "로그아웃한 쿠키를 다시 보내도 거부 (쿠키 삭제만이 아님)");
  assert.equal(await use(phone), 200);
  await logoutPOST(req("/api/auth/logout", "POST", { all: true }, { origin: ORIGIN, cookie: phone }));
  assert.equal(await use(phone), 401);
  // 다른 사이트에서 로그아웃시키기 차단
  assert.equal((await logoutPOST(req("/api/auth/logout", "POST", { all: true }, { origin: "https://evil.example", cookie: phone }))).status, 403);
});

test("12) 기기는 최대 3개: 4번째 로그인하면 가장 오래된 세션이 끊김", async () => {
  setup();
  const cookies: string[] = [];
  const realNow = Date.now;
  try {
    for (let i = 0; i < 4; i++) {
      const t = realNow.call(Date) - (3 - i) * 30000; // 30초 간격으로 로그인한 것처럼 (OTP 칸이 바뀜)
      Date.now = () => t;
      cookies.push(cookieOf((await login(TEST_PASSWORD, code(t))).cookie));
    }
  } finally {
    Date.now = realNow;
  }
  assert.ok(cookies.every((c) => c.startsWith("__Host-ws_session=v1.")));
  const status = await Promise.all(cookies.map((cookie) => listGET(req("/api/sales/list?sheet=10월", "GET", undefined, { cookie })).then((r) => r.status)));
  assert.deepEqual(status, [401, 200, 200, 200]);
});

test("13) Apps Script 로그인 처리는 API 비밀값이 없으면 거부 (웹앱 서버를 거치지 않은 직접 호출)", () => {
  const gas = makeGas(new FakeSpreadsheet());
  for (const secret of ["wrong", "", undefined]) {
    const out = (gas.ctx.wsHandleSaleUpdate_ as (e: unknown) => { text: string })({ postData: { contents: JSON.stringify({ action: "auth-login", result: "ok", session: "a".repeat(64), exp: Math.floor(Date.now() / 1000) + 60, step: 1, ...(secret === undefined ? {} : { secret }) }) } });
    const r = JSON.parse(out.text);
    assert.equal(r.ok, false);
    assert.equal(r.code, "unauthorized");
  }
  assert.equal((gas.ctx.PropertiesService as { getScriptProperties: () => { getProperty: (k: string) => string | null } }).getScriptProperties().getProperty("WS_AUTH_STATE"), null);
});

test("14) 비밀번호·OTP·세션 값은 로그·응답에 남지 않음 / 너무 긴 요청 거부", async () => {
  setup();
  serverLogs.length = 0;
  responses.length = 0;
  const c = code();
  const ok = await login(TEST_PASSWORD, c);
  await login("wrong-" + TEST_PASSWORD, code());
  const big = await loginPOST(req("/api/auth/login", "POST", { password: "x".repeat(2000), otp: c }, { origin: ORIGIN }));
  assert.equal(big.status, 400);
  const sid = cookieOf(ok.cookie).split(".")[1];
  const text = JSON.stringify([serverLogs, responses, ok.body]);
  for (const secret of [TEST_PASSWORD, sid, process.env.AUTH_SESSION_SECRET!, process.env.AUTH_TOTP_SECRET!]) assert.ok(!text.includes(secret));
});

test("15) 설정값 도구(tools/auth-setup.html)가 만든 값을 서버가 그대로 받아들임 (인터넷 연결 없이 계산)", async () => {
  const html = readFileSync(path.join(WS, "tools/auth-setup.html"), "utf8");
  assert.match(html, /connect-src 'none'/);
  assert.doesNotMatch(html, /<script[^>]+src=|https?:\/\/(?!www\.w3)/);
  const core = html.match(/<script id="core">([\s\S]*?)<\/script>/)![1];
  const ctx: Record<string, unknown> = { crypto: webcrypto, TextEncoder, btoa, Uint8Array, String, Math };
  vm.createContext(ctx);
  vm.runInContext(core, ctx);
  const made = await (ctx.makeSettings as (p: string) => Promise<{ passwordHash: string; totpSecret: string; sessionSecret: string }>)("도구로-만든-비밀번호-1234");
  const parsed = parsePasswordHash(made.passwordHash);
  assert.ok(parsed && parsed.iterations === 600000);
  assert.equal(await verifyPassword("도구로-만든-비밀번호-1234", parsed!), true);
  assert.equal(await verifyPassword("다른 비밀번호", parsed!), false);
  const key = base32Decode(made.totpSecret)!;
  assert.equal(key.length, 20);
  const now = Date.now();
  assert.equal(await (ctx.totpCode as (s: string, n: number) => Promise<string>)(made.totpSecret, now), totpCode(key, step(now)));
  assert.ok(made.sessionSecret.length >= 32);
  // 비밀번호 최소 길이 12자 (11자는 거부, 12자는 통과, 두 칸이 다르면 거부)
  const problem = ctx.passwordProblem as (a: string, b: string) => string;
  assert.equal(ctx.MIN_PASSWORD_LENGTH, 12);
  assert.match(problem("a".repeat(11), "a".repeat(11)), /12자 이상/);
  assert.equal(problem("a".repeat(12), "a".repeat(12)), "");
  assert.match(problem("a".repeat(12), "b".repeat(12)), /다릅니다/);
  // 12자 비밀번호도 서버가 같은 방식(PBKDF2 60만 회)으로 확인
  const short = await (ctx.makeSettings as (p: string) => Promise<{ passwordHash: string }>)("abcdefgh1234");
  assert.equal(await verifyPassword("abcdefgh1234", parsePasswordHash(short.passwordHash)!), true);
  void createHmac;
});

test("16) 저장 등이 스크립트 잠금을 잡고 있어도 세션 확인(auth-check)은 기다리지 않음 — 로그아웃 즉시 무효화·OTP 재사용 방지·시도 제한은 그대로", async () => {
  const { gas } = setup();
  const props = () => (gas.ctx.PropertiesService as { getScriptProperties: () => { getProperty: (k: string) => string | null } }).getScriptProperties();
  const realLock = gas.ctx.LockService;
  let lockCalls = 0;
  const held = { getScriptLock: () => ({ tryLock: () => { lockCalls++; return false; }, waitLock: () => { lockCalls++; throw new Error("잠금 대기 시간 초과"); }, releaseLock: () => {} }) };
  const use = (cookie: string) => listGET(req("/api/sales/list?sheet=10월", "GET", undefined, { cookie })).then((r) => r.status);

  // 1) 다른 작업이 잠금을 잡고 있는 동안: 세션 확인은 잠금 없이 통과, 상태도 쓰지 않음
  const c1 = code();
  const pc = cookieOf((await login(TEST_PASSWORD, c1)).cookie);
  const before = props().getProperty("WS_AUTH_STATE");
  gas.ctx.LockService = held;
  lockCalls = 0;
  gas.calls.length = 0;
  const r = await authCheckOnly(pc);
  assert.equal(r, true, "잠금이 잡혀 있어도 살아 있는 세션은 확인됨");
  assert.equal(lockCalls, 0, "auth-check 는 잠금을 요청하지 않음");
  assert.equal(props().getProperty("WS_AUTH_STATE"), before, "auth-check 는 상태를 쓰지 않음");

  // 2) 잠금이 잡혀 있으면 로그인·로그아웃은 처리하지 않고 막는다 (기록 없이 통과시키지 않음)
  const busyLogin = await login(TEST_PASSWORD, code(Date.now() + 30000));
  assert.equal(busyLogin.status, 503);
  assert.equal(busyLogin.cookie, "");
  const busyLogout = await logoutPOST(req("/api/auth/logout", "POST", {}, { origin: ORIGIN, cookie: pc }));
  assert.equal(busyLogout.status, 503, "서버 세션을 못 지웠으면 성공이라 하지 않음");
  assert.equal(props().getProperty("WS_AUTH_STATE"), before);
  gas.ctx.LockService = realLock;

  // 3) 로그아웃 직후: 같은 쿠키로 다음 요청은 바로 401 (잠금 없는 확인도 바뀐 상태를 읽음)
  assert.equal(await use(pc), 200);
  assert.equal((await logoutPOST(req("/api/auth/logout", "POST", {}, { origin: ORIGIN, cookie: pc }))).status, 200);
  assert.equal(await use(pc), 401);
  assert.equal(await authCheckOnly(pc), false);

  // 4) OTP 재사용 방지: 이미 쓴 코드(c1)는 다시 안 됨
  assert.equal((await login(TEST_PASSWORD, c1)).status, 401);

  // 5) 시도 제한: 위 실패 1회 + 4회 더 → 잠김, 잠긴 뒤에는 맞는 값도 429. 그동안 세션 확인은 잠금 없이 계속 동작
  const phone = cookieOf((await login(TEST_PASSWORD, code(Date.now() + 30000))).cookie);
  assert.equal(await use(phone), 200);
  for (let i = 0; i < 5; i++) await login("wrong", code());
  assert.equal((await login(TEST_PASSWORD, code())).status, 429);
  assert.equal(await use(phone), 200, "잠금(로그인 시도 제한)은 이미 로그인한 기기의 세션 확인에 영향 없음");
  assert.ok(JSON.parse(props().getProperty("WS_AUTH_STATE")!).lockUntil > Date.now());

  async function authCheckOnly(cookie: string): Promise<boolean> {
    const sid = cookie.split(".")[1];
    const reply = gas.doPost({ action: "auth-check", session: sessionIdHash(sid) });
    return reply.ok === true;
  }
});

test("17) 만료된 세션은 잠금 없는 세션 확인에서도 거부 (Apps Script 시계 기준)", async () => {
  let shift = 0;
  const gas = makeGas(new FakeSpreadsheet(), { now: () => Date.now() + shift });
  connect(gas);
  const cookie = cookieOf((await login(TEST_PASSWORD, code())).cookie);
  const sid = cookie.split(".")[1];
  assert.equal(gas.doPost({ action: "auth-check", session: sessionIdHash(sid) }).ok, true);
  shift = 13 * 3600 * 1000;
  assert.equal(gas.doPost({ action: "auth-check", session: sessionIdHash(sid) }).ok, false);
});
