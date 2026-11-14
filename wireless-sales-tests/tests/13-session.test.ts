/*
 * 로그인 유지·30분 미사용 자동 로그아웃·최대 8시간 재확인·모든 기기 로그아웃 (서버 쪽) — 가짜 비밀값·가짜 Apps Script 만 사용.
 * 시계는 이 파일 안에서만 앞으로 돌린다 (Date.now 를 바꿔 웹 서버·가짜 Apps Script 가 같은 시계를 씀).
 */
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { createHmac } from "node:crypto";
import { setup, connect, register, report, ORIGIN, TEST_PASSWORD, TEST_TOTP_KEY, serverLogs, responses } from "../harness/web.ts";
import { PEOPLE } from "../harness/fake-people.ts";
import {
  totpCode, signSession, sessionIdHash, readSessionToken,
  SESSION_TTL_SEC, IDLE_TIMEOUT_SEC, ACTIVITY_MIN_INTERVAL_SEC, ACTIVITY_REPORT_MAX_SEC,
} from "@/lib/server/auth";
import * as policy from "@/lib/session-policy";
import { proxy } from "@/proxy";
import { POST as loginPOST } from "@/app/api/auth/login/route";
import { POST as logoutPOST } from "@/app/api/auth/logout/route";
import { POST as activityPOST } from "@/app/api/auth/activity/route";
import { GET as statusGET } from "@/app/api/auth/status/route";
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
const MIN = 60_000;

// ── 시계 ──
const realNow = Date.now;
let clock = realNow.call(Date);
function useClock() { clock = realNow.call(Date); Date.now = () => clock; }
const advance = (ms: number) => { clock += ms; };
afterEach(() => { Date.now = realNow; });

const otp = () => totpCode(TEST_TOTP_KEY, Math.floor(Date.now() / 30000));
const key = () => Buffer.from(process.env.AUTH_SESSION_SECRET!, "utf8");
const cookieOf = (setCookie: string | null) => (setCookie ?? "").split(";")[0];
const tokenOf = (cookie: string) => cookie.slice("__Host-ws_session=".length);
function req(url: string, method: string, cookie: string, body?: unknown, extra: Record<string, string> = {}) {
  const headers: Record<string, string> = { ...extra };
  if (cookie) headers.cookie = cookie;
  if (method !== "GET") headers.origin = ORIGIN;
  return new Request(new URL(url, ORIGIN), { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
async function login(cookie = "") {
  advance(31_000); // 같은 OTP 칸을 다시 쓰지 않도록
  const r = await loginPOST(req("/api/auth/login", "POST", cookie, { password: TEST_PASSWORD, otp: otp() }));
  assert.equal(r.status, 200, JSON.stringify(await r.clone().json()));
  return cookieOf(r.headers.get("set-cookie"));
}
const activity = (cookie: string, inactiveSec = 0) => activityPOST(req("/api/auth/activity", "POST", cookie, { inactiveSec }));
const status = (cookie: string) => statusGET(req("/api/auth/status", "GET", cookie));
const list = (cookie: string) => listGET(req("/api/sales/list?sheet=10월", "GET", cookie));
const codeOf = async (r: Response) => ((await r.clone().json()) as { code?: string }).code;
const dataCalls = (gas: { calls: { body: Record<string, unknown> }[] }) => gas.calls.filter((c) => !String(c.body.action ?? "").startsWith("auth-")).length;
const authState = (gas: { props: Map<string, string> }) => JSON.parse(gas.props.get("WS_AUTH_STATE") ?? "{}") as { sessions: { h: string }[] };

type Handler = (r: Request) => Promise<Response>;
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

/** proxy.ts 를 부르는 최소 요청 (Next.js 의 nextUrl·cookies 만 흉내) */
async function callProxy(pathname: string, cookie: string) {
  const url = new URL(pathname, ORIGIN);
  const nextUrl = Object.assign(url, { clone: () => new URL(url.href) });
  const value = cookie ? tokenOf(cookie) : undefined;
  return proxy({ nextUrl, cookies: { get: (n: string) => (n === "__Host-ws_session" && value ? { value } : undefined) } } as never);
}

test("1) 서버 30분 미사용 만료: 활동 없이 29분 → 사용 가능 / 30분 → 모든 업무 API·화면·상태 확인 거부 (업무 호출 0건), 활동 갱신으로도 되살릴 수 없음", async () => {
  useClock();
  const { gas } = setup();
  const cookie = await login();
  advance(29 * MIN);
  assert.equal((await list(cookie)).status, 200);
  assert.equal((await callProxy("/sales", cookie)).status, 200);
  advance(1 * MIN + 1000);
  const before = dataCalls(gas);
  for (const [url, method, handler, body] of ROUTES) {
    const r = await handler(req(url, method, cookie, body));
    assert.equal(r.status, 401, url);
    assert.equal(await codeOf(r), "idle_expired", url);
  }
  assert.equal(dataCalls(gas), before, "만료된 세션으로 업무 요청이 Apps Script 로 가면 안 됨");
  assert.equal(await codeOf(await status(cookie)), "idle_expired");
  const a = await activity(cookie);
  assert.equal(a.status, 401);
  assert.equal(a.headers.get("set-cookie"), null);
  // 화면 주소: 로그인 화면으로 (이유 idle), API: 401 + code
  const page = await callProxy("/sales?x=1", cookie);
  assert.equal(page.status, 307);
  assert.match(page.headers.get("location") ?? "", /\/login\?next=%2Fsales%3Fx%3D1&reason=idle$/);
  const api = await callProxy("/api/sales/list", cookie);
  assert.equal(api.status, 401);
  assert.equal(await codeOf(api), "idle_expired");
});

test("2) 실제 활동(활동 갱신 API)이 계속되면 30분을 넘어 유지 / 업무 API·자동 조회·상태 확인만으로는 늘어나지 않음", async () => {
  useClock();
  setup();
  let cookie = await login();
  // 20분마다 실제 활동 → 3시간 동안 계속 사용 가능
  for (let i = 0; i < 9; i++) {
    advance(20 * MIN);
    const a = await activity(cookie);
    assert.equal(a.status, 200);
    const next = cookieOf(a.headers.get("set-cookie"));
    assert.ok(next, "활동 갱신은 새 쿠키를 줌");
    assert.equal(next.split(".")[1], cookie.split(".")[1], "세션ID 는 그대로");
    assert.equal(next.split(".")[2], cookie.split(".")[2], "최대 만료는 바뀌지 않음");
    cookie = next;
    assert.equal((await list(cookie)).status, 200);
  }
  // 이제 활동 없이 자동 조회·상태 확인만 5분마다 → 30분이 지나면 만료
  for (let i = 0; i < 5; i++) {
    advance(5 * MIN);
    const l = await list(cookie);
    assert.equal(l.status, 200);
    assert.equal(l.headers.get("set-cookie"), null, "업무 API 는 쿠키를 늘리지 않음");
    const s = await status(cookie);
    assert.equal(s.status, 200);
    assert.equal(s.headers.get("set-cookie"), null, "상태 확인은 쿠키를 늘리지 않음");
  }
  advance(5 * MIN + 1000);
  assert.equal(await codeOf(await list(cookie)), "idle_expired");
});

test("3) 활동 갱신 제한: 인증된 세션만 / 30초 안에 다시 오면 쿠키 그대로 / 화면이 보낸 '마지막 활동 후 초'는 만료를 앞당기는 쪽으로만 (최대 120초)", async () => {
  useClock();
  const { gas } = setup();
  // 로그인하지 않은 요청·다른 사이트 요청
  assert.equal((await activity("")).status, 401);
  const cookie = await login();
  const cross = await activityPOST(new Request(new URL("/api/auth/activity", ORIGIN), { method: "POST", headers: { cookie, origin: "https://evil.invalid" }, body: "{}" }));
  assert.equal(cross.status, 403);
  // 서버에서 끊긴 세션(로그아웃 등)은 서명이 맞아도 거부
  const ghost = `__Host-ws_session=${signSession(key(), "G".repeat(32), Math.floor(Date.now() / 1000) + 3600)}`;
  assert.equal(await codeOf(await activity(ghost)), "unauthenticated");

  advance(10_000);
  const quick = await activity(cookie);
  assert.equal(quick.status, 200);
  assert.equal(quick.headers.get("set-cookie"), null, `${ACTIVITY_MIN_INTERVAL_SEC}초 안의 갱신은 쿠키를 다시 주지 않음`);
  advance(5 * MIN);
  const nowSec = () => Math.floor(Date.now() / 1000);
  const idleOf = (c: string) => readSessionToken(key(), tokenOf(c), nowSec())!.idleExp;
  const big = cookieOf((await activity(cookie, 999_999)).headers.get("set-cookie"));
  assert.equal(idleOf(big), nowSec() - ACTIVITY_REPORT_MAX_SEC + IDLE_TIMEOUT_SEC, "큰 값은 120초로 제한");
  advance(5 * MIN);
  for (const bad of [-500, "abc", null]) {
    const r = await activityPOST(req("/api/auth/activity", "POST", big, { inactiveSec: bad }));
    const c = cookieOf(r.headers.get("set-cookie"));
    assert.ok(idleOf(c) <= nowSec() + IDLE_TIMEOUT_SEC, "미래로 늘리는 값은 받지 않음");
    advance(ACTIVITY_MIN_INTERVAL_SEC * 1000);
  }
  // 너무 큰 요청 본문은 무시 (inactiveSec 0)
  const huge = await activityPOST(req("/api/auth/activity", "POST", big, { inactiveSec: 1, pad: "x".repeat(500) }));
  assert.equal(huge.status, 200);
  // 활동 갱신은 장표에 접근하지 않음
  assert.equal(dataCalls(gas), 0);
});

test("4) 최대 8시간: 활동이 계속돼도 8시간이 지나면 업무 API 거부(code reauth_required) / 활동 갱신으로 넘길 수 없음 / 그 자리 재확인(비밀번호+OTP)으로 이어서 사용, 이전 세션은 서버에서 삭제", async () => {
  useClock();
  const { gas } = setup();
  let cookie = await login();
  const firstSid = cookie.split(".")[1];
  const exp = Number(cookie.split(".")[2]);
  assert.equal(exp - Math.floor(Date.now() / 1000), SESSION_TTL_SEC);
  while (Date.now() / 1000 < exp - 20 * 60) {
    advance(20 * MIN);
    const next = cookieOf((await activity(cookie)).headers.get("set-cookie"));
    if (next) cookie = next;
  }
  assert.equal((await list(cookie)).status, 200);
  advance((exp - Math.floor(Date.now() / 1000)) * 1000 + 1000);
  const r = await list(cookie);
  assert.equal(r.status, 401);
  assert.equal(await codeOf(r), "reauth_required");
  assert.equal(await codeOf(await activity(cookie)), "reauth_required", "8시간을 활동 갱신으로 넘길 수 없음");
  assert.equal(await codeOf(await status(cookie)), "reauth_required");
  // 화면 새로 열기는 로그인 화면으로
  assert.equal((await callProxy("/sales", cookie)).status, 307);
  // 재확인: 같은 브라우저에서 로그인 API (예전 쿠키를 함께 보냄)
  const renewed = await login(cookie);
  assert.notEqual(renewed.split(".")[1], firstSid);
  assert.equal((await list(renewed)).status, 200);
  const hashes = authState(gas).sessions.map((s) => s.h);
  assert.ok(!hashes.includes(sessionIdHash(firstSid)), "이전 세션은 Apps Script 에서 삭제");
  assert.deepEqual(hashes, [sessionIdHash(renewed.split(".")[1])], "기기 3대 제한 칸을 더 차지하지 않음 (남은 세션은 새 세션 하나)");
  // 8시간 이상은 서명이 맞아도 받지 않음
  const tooLong = `__Host-ws_session=${signSession(key(), "L".repeat(32), Math.floor(Date.now() / 1000) + SESSION_TTL_SEC + 120)}`;
  assert.equal(await codeOf(await list(tooLong)), "unauthenticated");
});

test("5) 쿠키 위조·만료 우회 차단: 미사용 만료·최대 만료 숫자를 고친 쿠키 / 예전 형식(v1) / 다른 키 / 너무 먼 미사용 만료 → 401, Apps Script 호출 0건", async () => {
  useClock();
  const { gas } = setup();
  const cookie = await login();
  advance(31 * MIN); // 미사용으로 만료된 쿠키
  const [v, sid, exp, idle, sig] = tokenOf(cookie).split(".");
  const now = Math.floor(Date.now() / 1000);
  const v1data = `v1.${sid}.${exp}`;
  const forged = [
    `${v}.${sid}.${exp}.${now + 1500}.${sig}`, // 미사용 만료만 늘림
    `${v}.${sid}.${now + 7200}.${idle}.${sig}`, // 최대 만료만 늘림
    `${v1data}.${createHmac("sha256", key()).update(v1data).digest("base64url")}`, // 예전 형식 (서명은 맞음)
    signSession(Buffer.from("다른-키".repeat(8)), sid, now + 3600, now + 1500),
    signSession(key(), sid, now + 3600, now + IDLE_TIMEOUT_SEC + 600), // 서명은 맞지만 미사용 만료가 30분보다 멂
    `${v}.${sid}.${exp}.${idle}`,
    `${v}.${sid}.${exp}.${idle}.${sig}.x`,
  ];
  const before = gas.calls.length;
  for (const token of forged) {
    const c = `__Host-ws_session=${token}`;
    assert.equal(await codeOf(await list(c)), "unauthenticated", token.slice(0, 12));
    assert.equal(await codeOf(await activity(c)), "unauthenticated");
    assert.equal((await callProxy("/sales", c)).status, 307);
    assert.equal(await codeOf(await callProxy("/api/sales/list", c)), "unauthenticated");
  }
  assert.equal(gas.calls.length, before, "위조 쿠키로는 Apps Script 를 부르지 않음");
});

test("6) 모든 기기 로그아웃: 3대 모두 즉시 거부 / 만료된 쿠키로는 모든 기기 로그아웃 불가 / 한 기기 로그아웃은 만료된 쿠키여도 서버에서 삭제", async () => {
  useClock();
  const { gas } = setup();
  const a = await login();
  const b = await login();
  const c = await login();
  for (const x of [a, b, c]) assert.equal((await list(x)).status, 200);
  // 미사용 만료된 쿠키(예: 주운 예전 쿠키)로는 모든 기기를 끊을 수 없음
  const staleSecret = signSession(key(), a.split(".")[1], Number(a.split(".")[2]), Math.floor(Date.now() / 1000) - 1);
  const refused = await logoutPOST(req("/api/auth/logout", "POST", `__Host-ws_session=${staleSecret}`, { all: true }));
  assert.equal(refused.status, 401);
  assert.equal(authState(gas).sessions.length, 3);
  // 정상 세션에서 모든 기기 로그아웃
  const out = await logoutPOST(req("/api/auth/logout", "POST", b, { all: true }));
  assert.equal(out.status, 200);
  assert.match(out.headers.get("set-cookie") ?? "", /^__Host-ws_session=; .*Max-Age=0$/);
  assert.equal(authState(gas).sessions.length, 0);
  for (const x of [a, b, c]) {
    assert.equal(await codeOf(await list(x)), "unauthenticated");
    assert.equal(await codeOf(await status(x)), "unauthenticated", "다른 기기 화면도 다음 상태 확인에서 지워짐");
    assert.equal(await codeOf(await activity(x)), "unauthenticated");
  }
  // 한 기기 로그아웃: 미사용으로 만료된 쿠키여도 서버 세션을 지운다 (복사해 둔 쿠키를 되살릴 수 없게)
  const d = await login();
  const e = await login();
  advance(31 * MIN);
  const dl = await logoutPOST(req("/api/auth/logout", "POST", d, { all: false }));
  assert.equal(dl.status, 200);
  const hashes = authState(gas).sessions.map((s) => s.h);
  assert.ok(!hashes.includes(sessionIdHash(d.split(".")[1])));
  assert.ok(hashes.includes(sessionIdHash(e.split(".")[1])), "다른 기기 세션은 남음");
});

test("7) 기기는 최대 3대 그대로 / 로그인 쿠키는 브라우저를 닫으면 사라지는 쿠키(Max-Age·Expires 없음)", async () => {
  useClock();
  const { gas } = setup();
  advance(31_000);
  const r = await loginPOST(req("/api/auth/login", "POST", "", { password: TEST_PASSWORD, otp: otp() }));
  const set = r.headers.get("set-cookie") ?? "";
  assert.match(set, /; HttpOnly; Secure; SameSite=Strict$/);
  assert.doesNotMatch(set, /Max-Age|Expires/i);
  const body = (await r.json()) as Record<string, unknown>;
  assert.deepEqual(Object.keys(body).sort(), ["exp", "idleExp", "now", "ok"], "로그인 응답에는 시각만");
  const cookies = [cookieOf(set), await login(), await login(), await login()];
  assert.equal(authState(gas).sessions.length, 3);
  assert.equal(await codeOf(await list(cookies[0])), "unauthenticated", "가장 오래된 세션이 끊김");
  for (const x of cookies.slice(1)) assert.equal((await list(x)).status, 200);
});

test("8) 캐시 금지: 로그인이 필요한 화면·로그인 화면·인증 API·업무 API 응답 모두 no-store", async () => {
  useClock();
  setup();
  const cookie = await login();
  for (const p of ["/", "/sales", "/customer", "/budget", "/login", "/api/auth/login"]) {
    const r = await callProxy(p, cookie);
    assert.match(r.headers.get("cache-control") ?? "", /no-store/, p);
  }
  assert.match((await callProxy("/sales", "")).headers.get("cache-control") ?? "", /no-store/, "로그인 화면으로 보내는 응답");
  for (const r of [await status(cookie), await activity(cookie), await list(cookie), await list("")]) {
    assert.match(r.headers.get("cache-control") ?? "", /no-store/);
  }
  for (const [url, method, handler, body] of ROUTES) {
    assert.match((await handler(req(url, method, "", body))).headers.get("cache-control") ?? "", /no-store/, url);
  }
});

test("9) 상태 확인 API: 시각만 돌려주고 세션을 늘리지 않음 / 비밀값·세션 값은 응답·로그에 없음", async () => {
  useClock();
  setup();
  serverLogs.length = 0;
  responses.length = 0;
  const cookie = await login();
  const r = await status(cookie);
  const body = (await r.json()) as Record<string, unknown>;
  assert.deepEqual(Object.keys(body).sort(), ["exp", "idleExp", "now", "ok"]);
  const text = JSON.stringify(body) + serverLogs.join("\n");
  for (const secret of [TEST_PASSWORD, process.env.AUTH_TOTP_SECRET!, process.env.AUTH_SESSION_SECRET!, cookie.split(".")[1]]) {
    assert.ok(!text.includes(secret));
  }
});

test("10) 화면 쪽 규칙: 27분 59초 정상 / 28분 경고 / 30분 자동 로그아웃 / 8시간 30분 전 재확인 안내·지나면 재확인 / 타이머만 돌면 활동 갱신을 보내지 않음", () => {
  const t0 = 1_800_000_000_000;
  const at = (idleMs: number, abs: number | null = null) => policy.phaseAt({ now: t0 + idleMs, lastActivity: t0, absDeadline: abs });
  assert.equal(at(28 * MIN - 1000), "active");
  assert.equal(at(28 * MIN), "idle-warning");
  assert.equal(at(30 * MIN - 1), "idle-warning");
  assert.equal(at(30 * MIN), "idle-expired");
  assert.equal(policy.idleRemainingMs(t0 + 28 * MIN, t0), 2 * MIN);
  assert.equal(at(MIN, t0 + 40 * MIN), "active");
  assert.equal(at(MIN, t0 + 31 * MIN), "reauth-soon");
  assert.equal(at(MIN, t0 + MIN), "reauth-required");
  assert.equal(at(31 * MIN, t0 + MIN), "idle-expired", "재확인 창이 떠 있어도 30분 미사용이면 로그아웃");
  // 활동 갱신: 마지막 전송 뒤 실제 활동이 있고 1분이 지났을 때만
  assert.equal(policy.shouldHeartbeat(t0 + 2 * MIN, t0, t0), false, "활동 없이 시간만 흐름");
  assert.equal(policy.shouldHeartbeat(t0 + 30_000, t0 + 20_000, t0), false, "1분 안");
  assert.equal(policy.shouldHeartbeat(t0 + MIN, t0 + 20_000, t0), true);
  // 1초 타이머를 30분 동안 돌려도(활동 없음) 한 번도 보내지 않음
  let sent = 0;
  for (let s = 1; s <= 1800; s++) if (policy.shouldHeartbeat(t0 + s * 1000, t0, t0)) sent++;
  assert.equal(sent, 0);
  // 다른 탭의 활동이 서버에 있으면 반영, 서버 값으로 이 탭의 최근 활동을 줄이지는 않음
  assert.equal(policy.syncActivityFromServer(t0, t0 + 10 * MIN + policy.IDLE_MS), t0 + 10 * MIN);
  assert.equal(policy.syncActivityFromServer(t0 + 10 * MIN, t0 + policy.IDLE_MS), t0 + 10 * MIN);
  assert.equal(policy.toClientMs(1000, 900, t0), t0 + 100_000, "서버·PC 시계 차이 보정");
  for (const bad of ["//evil.example", "https://evil.example", "/\\evil", null]) assert.equal(policy.safeNext(bad), "/");
  assert.equal(policy.safeNext("/sales?x=1"), "/sales?x=1");
});

test("11) 같은 값 확인: 서버(auth.ts)·관문(proxy.ts)·화면(session-policy.ts)의 30분·8시간이 같음 / 활동 이벤트에 스크립트가 만든 이벤트·마우스 이동·scroll 제외", () => {
  assert.equal(policy.IDLE_MS, IDLE_TIMEOUT_SEC * 1000);
  assert.equal(policy.IDLE_WARN_MS, IDLE_TIMEOUT_SEC * 1000 - 2 * MIN);
  const proxySrc = readFileSync(path.join(WS, "proxy.ts"), "utf8");
  assert.match(proxySrc, new RegExp(`const SESSION_TTL_SEC = ${SESSION_TTL_SEC / 3600} \\* 60 \\* 60;`));
  assert.match(proxySrc, new RegExp(`const IDLE_TIMEOUT_SEC = ${IDLE_TIMEOUT_SEC / 60} \\* 60;`));
  assert.ok(!policy.ACTIVITY_EVENTS.includes("pointermove" as never));
  assert.ok(!policy.ACTIVITY_EVENTS.includes("scroll" as never));
  const guard = readFileSync(path.join(WS, "components/auth-guard.tsx"), "utf8");
  assert.match(guard, /if \(!event\.isTrusted/, "isTrusted 인 이벤트만");
  // 세션을 늘리는(새 쿠키를 주는) 곳은 로그인·활동 갱신 두 API 뿐
  const setters = ["app/api/auth/login/route.ts", "app/api/auth/activity/route.ts"];
  const walk = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = path.join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
  for (const file of walk(path.join(WS, "app/api")).filter((f) => f.endsWith(".ts"))) {
    const src = readFileSync(file, "utf8");
    const rel = path.relative(WS, file);
    if (setters.includes(rel)) assert.match(src, /sessionCookie\(signSession/);
    else assert.doesNotMatch(src, /sessionCookie\(|signSession/, rel);
  }
});

test("12) 기존 업무 영향 없음: 새 쿠키로 로그인한 뒤 판매 저장·조회 정상", async () => {
  useClock();
  setup();
  const cookie = await login();
  // web.ts 의 기본 로그인 쿠키로 저장 → 새로 로그인한 쿠키로 조회
  const saved = await register(report(A.name, A.ctn));
  assert.equal(saved.ok, true, JSON.stringify(saved));
  const r = await list(cookie);
  assert.equal(r.status, 200);
  assert.equal(((await r.json()) as { sales: { customer: string }[] }).sales.filter((s) => s.customer === A.name).length, 1);
});
