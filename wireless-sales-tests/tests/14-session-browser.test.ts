/*
 * 브라우저(Chromium) 시험: 로그인 유지·30분 미사용 자동 로그아웃·경고·재확인·뒤로 가기·여러 탭·모든 기기 로그아웃.
 * 실제 웹앱의 로그인 부품(AuthGuard·LoginForm·LogoutButton)과 실제 서버 코드(proxy·인증 API·판매 조회 API)를
 * 가짜 Apps Script·가짜 고객 데이터로 돌린다 (e2e/server.ts). 실제 장표·Apps Script·운영 비밀값은 쓰지 않는다.
 * 브라우저 시계는 Playwright clock 으로, 서버 시계는 /__test/advance 로 같은 만큼 앞으로 돌린다.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import os from "node:os";
import { mkdtempSync } from "node:fs";
import { PEOPLE } from "../harness/fake-people.ts";

const here = import.meta.dirname;
const MODS = process.env.E2E_NODE_MODULES || "/opt/node-tools/node_modules";
const { chromium } = createRequire(path.join(MODS, "x.js"))("playwright") as typeof import("playwright");
type Browser = import("playwright").Browser;
type Page = import("playwright").Page;
type Context = import("playwright").BrowserContext;

const MIN = 60_000;
const NAME = PEOPLE[0].name; // 가짜 고객
let server: ChildProcess;
let base = "";
let browser: Browser;

before(async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "ws-e2e-"));
  const out = path.join(dir, "app.js");
  const { bundle } = (await import(path.join(here, "../e2e/build.mjs"))) as { bundle: (f: string) => Promise<void> };
  await bundle(out);
  server = spawn(process.execPath, [
    "--experimental-transform-types", "--no-warnings",
    "--import", "./harness/clock.mjs", "--import", "./harness/register.mjs",
    "e2e/server.ts", out,
  ], { cwd: path.join(here, ".."), stdio: ["ignore", "pipe", "inherit"] });
  base = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("시험 서버가 시작되지 않음")), 30_000);
    server.stdout!.on("data", (d: Buffer) => {
      const m = /READY (\d+)/.exec(String(d));
      if (m) { clearTimeout(timer); resolve(`http://localhost:${m[1]}`); }
    });
  });
  browser = await chromium.launch();
});
after(async () => {
  await browser?.close();
  server?.kill();
});

const ctl = async (p: string) => (await fetch(base + p)).json() as Promise<Record<string, unknown>>;
const advanceServer = (ms: number) => ctl(`/__test/advance?ms=${ms}`);
const sessions = async () => (await ctl("/__test/sessions")).hashes as string[];
/** 브라우저·서버 시계를 함께 앞으로 */
async function advance(page: Page, ms: number) {
  await advanceServer(ms);
  await page.clock.runFor(ms);
}
async function newPage(ctx?: Context): Promise<{ ctx: Context; page: Page }> {
  const c = ctx ?? (await browser.newContext());
  return { ctx: c, page: await c.newPage() };
}
async function login(page: Page) {
  await advanceServer(31_000); // OTP 칸이 겹치지 않게
  const { password, otp } = (await ctl("/__test/credentials")) as { password: string; otp: string };
  await page.goto(base + "/login");
  await page.getByLabel("비밀번호").fill(password);
  await page.getByLabel("인증 코드 (6자리)").fill(otp);
  await page.getByRole("button", { name: "로그인" }).click();
  await page.waitForURL(base + "/");
  await page.locator("#customers", { hasText: NAME }).waitFor();
}
const customersVisible = (page: Page) => page.locator("#customers", { hasText: NAME }).isVisible();
async function onLoginScreen(page: Page, reason?: RegExp) {
  await page.waitForURL((u) => u.pathname === "/login", { timeout: 10_000 });
  if (reason) assert.match(page.url(), reason);
  await page.getByRole("button", { name: "로그인" }).waitFor();
  assert.ok(!(await page.content()).includes(NAME), "로그인 화면에 고객 정보가 남으면 안 됨");
}
/** 가짜 시계를 쓰는 화면은 기다리는 동안 시계를 조금씩(0.1초) 움직여야 화면이 다시 그려진다 */
async function seen(page: Page, locator: import("playwright").Locator) {
  for (let i = 0; i < 150; i++) {
    if (await locator.first().isVisible()) return;
    await page.clock.runFor(100).catch(() => undefined);
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error("화면에 나타나지 않음: " + locator.toString() + " / 화면: " + (await page.evaluate(() => document.body.innerText)).slice(0, 200) + " / " + page.url() + " / " + (await page.evaluate(() => JSON.stringify({ ...localStorage, now: Date.now() }))));
}
/** 가짜 시계 화면에서의 실제 클릭 (Playwright 의 자동 대기 없이 좌표로 — 브라우저가 만든 isTrusted 이벤트) */
async function press(page: Page, locator: import("playwright").Locator) {
  await seen(page, locator);
  const box = await locator.first().boundingBox();
  assert.ok(box, "버튼 위치");
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}
/** 실제 사용자 클릭 (Playwright 클릭 = 브라우저가 만든 isTrusted 이벤트) */
const userClick = (page: Page) => page.locator("#area").click();

test("B1) 로그인: 브라우저를 닫으면 사라지는 쿠키(HttpOnly·Secure·SameSite=Strict, 만료일 없음) / 화면 스크립트로 쿠키를 읽을 수 없음", async () => {
  const { ctx, page } = await newPage();
  await login(page);
  const [c] = (await ctx.cookies()).filter((x) => x.name === "__Host-ws_session");
  assert.ok(c);
  assert.equal(c.expires, -1, "세션 쿠키 (브라우저 종료 시 삭제)");
  assert.equal(c.httpOnly, true);
  assert.equal(c.secure, true);
  assert.equal(c.sameSite, "Strict");
  assert.ok(!(await page.evaluate(() => document.cookie)).includes("ws_session"));
  // localStorage 에는 시각 숫자만 (고객 정보·세션 값 없음)
  const stored = await page.evaluate(() => JSON.stringify(Object.entries(localStorage)));
  assert.ok(!stored.includes(NAME) && !stored.includes(c.value.split(".")[1]));
  for (const [k, v] of JSON.parse(stored) as [string, string][]) {
    assert.match(k, /^ws-auth-/);
    assert.match(v, /^\d+$/);
  }
  await ctx.close();
});

test("B2) 실제 사용 중에는 30분이 지나도 유지 (2시간 동안 20분마다 클릭) — 활동 갱신은 1분에 최대 한 번", async () => {
  const { ctx, page } = await newPage();
  await page.clock.install();
  await login(page);
  const before = (await ctl("/__test/counts"))["POST /api/auth/activity"] ?? 0;
  for (let i = 0; i < 6; i++) {
    await userClick(page);
    await page.locator("#memo").fill(`가짜 메모 ${i}`); // 키 입력
    await advance(page, 61_000); // 1분 안에 활동 갱신이 서버로 감
    await advance(page, 19 * MIN);
    assert.ok(await customersVisible(page), `${(i + 1) * 20}분: 화면 유지`);
    assert.ok(!(await page.getByText("2분 후 자동 로그아웃됩니다").isVisible()));
  }
  const sent = ((await ctl("/__test/counts"))["POST /api/auth/activity"] ?? 0) - before;
  assert.ok(sent >= 6 && sent <= 12, `활동 갱신 ${sent}회 (활동 6번, 1분에 최대 1회)`);
  // 서버에서도 살아 있음: 화면 다시 열기
  await page.reload();
  await page.locator("#customers", { hasText: NAME }).waitFor();
  await ctx.close();
});

test("B3) 활동 없이 자동 새로고침만 → 28분에 경고(고객 정보 가림) → 30분에 자동 로그아웃·화면 제거·서버 세션 삭제", async () => {
  const { ctx, page } = await newPage();
  await page.clock.install();
  await login(page);
  const listBefore = (await ctl("/__test/counts"))["GET /api/sales/list"] ?? 0;
  const activityBefore = (await ctl("/__test/counts"))["POST /api/auth/activity"] ?? 0;
  const [own] = (await ctx.cookies()).filter((x) => x.name === "__Host-ws_session");
  const ownHash = (await ctl(`/__test/hash?sid=${own.value.split(".")[1]}`)).hash as string;
  assert.ok((await sessions()).includes(ownHash));
  await advance(page, 27 * MIN);
  assert.ok(await customersVisible(page), "27분: 아직 정상");
  await advance(page, 1 * MIN);
  await seen(page, page.getByText("2분 후 자동 로그아웃됩니다"));
  assert.ok(!(await customersVisible(page)), "경고 중에는 고객 정보를 가림");
  const counts = await ctl("/__test/counts");
  assert.ok(((counts["GET /api/sales/list"] as number) ?? 0) - listBefore >= 5, "자동 새로고침은 계속 돌았음");
  assert.equal(((counts["POST /api/auth/activity"] as number) ?? 0) - activityBefore, 0, "자동 새로고침·타이머는 활동 갱신을 보내지 않음");
  await advance(page, 2 * MIN);
  await onLoginScreen(page, /reason=(idle|expired)/);
  await seen(page, page.getByText("30분 동안 사용하지 않아 자동 로그아웃되었습니다"));
  assert.ok(!(await sessions()).includes(ownHash), "서버 세션도 삭제");
  assert.equal((await ctx.cookies()).filter((x) => x.name === "__Host-ws_session").length, 0, "쿠키도 삭제");
  await ctx.close();
});

test("B4) 28분 경고에서 '계속 사용' → 화면·입력 중인 내용 그대로, 다시 30분 연장", async () => {
  const { ctx, page } = await newPage();
  await page.clock.install();
  await login(page);
  await page.locator("#memo").fill("가짜 메모: 작성 중");
  await advance(page, 28 * MIN);
  await seen(page, page.getByText("2분 후 자동 로그아웃됩니다"));
  await press(page, page.getByRole("button", { name: "계속 사용" }));
  await seen(page, page.locator("#customers", { hasText: NAME }));
  assert.equal(await page.locator("#memo").inputValue(), "가짜 메모: 작성 중");
  await advance(page, 61_000);
  await advance(page, 25 * MIN);
  assert.ok(await customersVisible(page), "경고 후 계속 사용 → 다시 30분");
  await ctx.close();
});

test("B5) 로그아웃 후 뒤로 가기·주소 직접 입력·페이지 복원(pageshow) → 로그인 화면, 고객 정보 없음", async () => {
  const { ctx, page } = await newPage();
  await login(page);
  await page.goto(base + "/sales"); // 두 번째 화면 (방문 기록 만들기)
  await page.locator("#customers", { hasText: NAME }).waitFor();
  // 페이지 복원(bfcache, pageshow persisted) → 예전 화면을 쓰지 않고 서버에서 다시 받음
  await page.evaluate(() => { (window as unknown as { __old: boolean }).__old = true; });
  await Promise.all([
    page.waitForEvent("load"),
    page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }))),
  ]);
  assert.equal(await page.evaluate(() => (window as unknown as { __old?: boolean }).__old ?? false), false, "복원된 화면 대신 새로 불러옴");
  await page.locator("#customers", { hasText: NAME }).waitFor();
  await page.getByRole("button", { name: "로그아웃", exact: true }).click();
  await onLoginScreen(page);
  await page.goBack();
  await onLoginScreen(page);
  for (const p of ["/", "/sales", "/customer?x=1"]) {
    await page.goto(base + p);
    await onLoginScreen(page);
  }
  // API 직접 호출도 거부
  const r = await page.evaluate(async () => (await fetch("/api/sales/list?sheet=10월")).status);
  assert.equal(r, 401);
  await ctx.close();
});

test("B6) 절전 후 복귀(시계만 31분 건너뜀) → 돌아오는 순간 화면을 가리고 로그아웃", async () => {
  const { ctx, page } = await newPage();
  await page.clock.install();
  await login(page);
  const now = await page.evaluate(() => Date.now());
  await advanceServer(31 * MIN);
  await page.clock.setSystemTime(now + 31 * MIN); // 타이머는 돌지 않음 (절전)
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await onLoginScreen(page, /reason=(idle|expired)/);
  await ctx.close();
});

test("B7) 서버에서 먼저 만료된 경우(브라우저는 모름): 다음 상태 확인·자동 새로고침 401 에서 화면 제거 / 쿠키 숫자를 고치면 거부", async () => {
  const a = await newPage();
  await login(a.page);
  await advanceServer(31 * MIN);
  await a.page.evaluate(() => window.dispatchEvent(new Event("test-refresh"))); // 자동 새로고침 → 401
  await onLoginScreen(a.page, /reason=expired/);
  await a.ctx.close();

  const b = await newPage();
  await login(b.page);
  const [c] = (await b.ctx.cookies()).filter((x) => x.name === "__Host-ws_session");
  const parts = c.value.split(".");
  parts[3] = String(Number(parts[3]) + 600); // 미사용 만료를 10분 늘린 위조
  await b.ctx.addCookies([{ ...c, value: parts.join(".") }]);
  await b.page.reload();
  await onLoginScreen(b.page);
  await b.ctx.close();
});

test("B8) 여러 탭: 한 탭에서 작업 중이면 다른 탭은 로그아웃하지 않음 / 한 탭에서 로그아웃하면 다른 탭도 즉시 화면 제거", async () => {
  const ctx = await browser.newContext();
  const A = await ctx.newPage();
  await A.clock.install();
  await login(A);
  const B = await ctx.newPage();
  await B.goto(base + "/");
  await B.locator("#customers", { hasText: NAME }).waitFor();
  for (let i = 0; i < 5; i++) {
    await userClick(A); // A 에서만 작업
    await advance(A, 61_000);
    await advance(A, 9 * MIN);
  }
  // 50분: A 에서만 활동 → B 도 그대로 (B 의 미사용 타이머가 세션을 끊지 않음)
  assert.ok(await customersVisible(A));
  assert.ok(await customersVisible(B), "다른 탭의 활동이 반영됨");
  assert.ok(!(await B.getByText("2분 후 자동 로그아웃됩니다").isVisible()));
  await A.getByRole("button", { name: "로그아웃", exact: true }).click();
  await onLoginScreen(A);
  await onLoginScreen(B);
  await ctx.close();
});

test("B9) 모든 기기 로그아웃: 확인 창 → 이 기기·다른 기기 모두 서버 세션 무효화 / 다른 기기에 열린 화면도 다음 확인에서 제거", async () => {
  const d1 = await newPage();
  const d2 = await newPage();
  await login(d1.page);
  await login(d2.page);
  // 확인 창에서 취소 → 아무 일 없음
  d1.page.once("dialog", (dlg) => { assert.match(dlg.message(), /모든 기기/); void dlg.dismiss(); });
  await d1.page.getByRole("button", { name: "모든 기기 로그아웃" }).click();
  assert.ok(await customersVisible(d1.page));
  assert.ok((await sessions()).length >= 2);
  // 확인 → 실행
  d1.page.once("dialog", (dlg) => void dlg.accept());
  await d1.page.getByRole("button", { name: "모든 기기 로그아웃" }).click();
  await onLoginScreen(d1.page);
  assert.equal((await sessions()).length, 0, "모든 세션 삭제");
  // 다른 기기: 화면이 다시 보일 때(또는 5분마다) 서버 확인 → 화면 제거
  assert.ok(await customersVisible(d2.page), "아직 확인 전");
  await d2.page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await onLoginScreen(d2.page, /reason=revoked/);
  // 다른 기기의 페이지 복원(pageshow persisted)도 서버에서 다시 받음
  await d2.page.goto(base + "/");
  await onLoginScreen(d2.page);
  await d1.ctx.close();
  await d2.ctx.close();
});

test("B10) 최대 8시간: 30분 전 재확인 안내 → 지나면 화면을 가린 재확인 창 → 비밀번호+OTP 후 그 자리에서 계속 (입력 내용 유지, 이전 세션 삭제)", async () => {
  const { ctx, page } = await newPage();
  await page.clock.install();
  // 최대 만료가 40분 남은 세션 (8시간을 기다리지 않기 위해 시험 서버가 만듦)
  // 시험 서버가 Set-Cookie 로 넣어 줌 (__Host- 쿠키는 응답으로만 넣을 수 있음)
  const shortRes = await page.goto(base + "/__test/short-session?sec=2400");
  const short = (await shortRes!.json()) as { sid: string };
  await page.goto(base + "/");
  await seen(page, page.locator("#customers", { hasText: NAME }));
  await page.locator("#memo").fill("가짜 메모: 8시간 직전 작성 중");
  for (let i = 0; i < 4; i++) {
    await userClick(page);
    await advance(page, 61_000);
    await advance(page, 9 * MIN);
    if (i === 1) await seen(page, page.getByText("재확인이 필요합니다")); // 30분 전부터 안내
  }
  // 40분 지남 → 재확인 창, 고객 정보는 가림
  await seen(page, page.getByText("보안을 위해 다시 확인해 주세요"));
  assert.ok(!(await customersVisible(page)));
  assert.equal(await page.url(), base + "/", "로그인 화면으로 이동하지 않음");
  await advanceServer(31_000);
  const { password, otp } = (await ctl("/__test/credentials")) as { password: string; otp: string };
  await page.getByLabel("비밀번호").fill(password);
  await page.getByLabel("인증 코드 (6자리)").fill(otp);
  await press(page, page.getByRole("button", { name: "확인", exact: true }));
  await seen(page, page.locator("#customers", { hasText: NAME }));
  assert.equal(await page.locator("#memo").inputValue(), "가짜 메모: 8시간 직전 작성 중", "입력 내용 유지");
  const oldHash = (await ctl(`/__test/hash?sid=${short.sid}`)).hash as string;
  assert.ok(!(await sessions()).includes(oldHash), "이전 세션은 서버에서 삭제");
  await page.evaluate(() => window.dispatchEvent(new Event("test-refresh")));
  await advance(page, 5_000);
  assert.ok(await customersVisible(page));
  await ctx.close();
});
