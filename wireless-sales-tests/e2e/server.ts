/*
 * 브라우저 시험용 웹 서버 (가짜 Apps Script·가짜 장표·가짜 비밀값). 실제 웹앱 코드를 그대로 부른다:
 *   proxy.ts(화면·API 관문) → app/api/auth/*, app/api/sales/list 의 route handler
 * 시험 조작용 주소 /__test/* 는 이 시험 서버에만 있다 (웹앱 코드 아님).
 * 서버 시계: Date.now 를 /__test/advance 로 앞으로 돌린다 (이 프로세스 안에서만).
 */
import http from "node:http";
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { setup, register, report, TEST_PASSWORD, TEST_TOTP_KEY } from "../harness/web.ts";
import { PEOPLE } from "../harness/fake-people.ts";
import { proxy } from "@/proxy";
import { totpCode, signSession, sessionIdHash, sessionCookie } from "@/lib/server/auth";
import { POST as loginPOST } from "@/app/api/auth/login/route";
import { POST as logoutPOST } from "@/app/api/auth/logout/route";
import { POST as activityPOST } from "@/app/api/auth/activity/route";
import { GET as statusGET } from "@/app/api/auth/status/route";
import { GET as listGET } from "@/app/api/sales/list/route";

const bundle = readFileSync(process.argv[2], "utf8");
let shift = 0;
const baseNow = Date.now.bind(Date);
Date.now = () => baseNow() + shift;

const { gas } = setup();
await register(report(PEOPLE[0].name, PEOPLE[0].ctn), report(PEOPLE[1].name, PEOPLE[1].ctn));

const ROUTES: Record<string, (r: Request) => Promise<Response>> = {
  "POST /api/auth/login": loginPOST,
  "POST /api/auth/logout": logoutPOST,
  "POST /api/auth/activity": activityPOST,
  "GET /api/auth/status": statusGET,
  "GET /api/sales/list": listGET,
};
const PAGE = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>시험</title></head><body><div id="root"></div><script src="/app.js"></script></body></html>`;
export const counts: Record<string, number> = {};

function cookieValue(header: string | undefined, name: string) {
  for (const part of (header ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > -1 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return undefined;
}
async function send(res: http.ServerResponse, r: Response) {
  const headers: Record<string, string | string[]> = {};
  r.headers.forEach((v, k) => { if (k !== "set-cookie" && k !== "x-middleware-next") headers[k] = v; });
  const sc = r.headers.getSetCookie();
  if (sc.length) headers["set-cookie"] = sc;
  res.writeHead(r.status, headers);
  res.end(Buffer.from(await r.arrayBuffer()));
}
const state = () => JSON.parse(gas.props.get("WS_AUTH_STATE") ?? "{}") as { sessions?: { h: string }[] };

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
    const key = `${req.method} ${url.pathname}`;
    counts[key] = (counts[key] ?? 0) + 1;
    // ── 시험 조작 ──
    if (url.pathname.startsWith("/__test/")) {
      const out = (o: unknown) => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(o)); };
      if (url.pathname === "/__test/advance") { shift += Number(url.searchParams.get("ms")); return out({ now: Date.now() }); }
      if (url.pathname === "/__test/credentials") return out({ password: TEST_PASSWORD, otp: totpCode(TEST_TOTP_KEY, Math.floor(Date.now() / 30000)) });
      if (url.pathname === "/__test/sessions") return out({ hashes: (state().sessions ?? []).map((s) => s.h) });
      if (url.pathname === "/__test/counts") return out(counts);
      if (url.pathname === "/__test/hash") return out({ hash: sessionIdHash(url.searchParams.get("sid") ?? "") });
      if (url.pathname === "/__test/short-session") {
        // 최대 만료가 곧 오는 세션 (8시간을 기다리지 않고 재확인 시험)
        shift += 31_000; // 앞선 시험 로그인과 같은 OTP 칸을 쓰지 않게
        const now = Math.floor(Date.now() / 1000);
        const exp = now + Number(url.searchParams.get("sec"));
        const sid = randomBytes(24).toString("base64url");
        const r = gas.doPost({ action: "auth-login", result: "ok", session: sessionIdHash(sid), exp, step: Math.floor(Date.now() / 30000) });
        if (!r.ok) throw new Error("시험 세션 등록 실패");
        shift += 31_000; // 같은 OTP 칸을 시험 로그인이 다시 쓰지 않게
        const value = signSession(Buffer.from(process.env.AUTH_SESSION_SECRET!, "utf8"), sid, exp, now + 1800);
        res.writeHead(200, { "content-type": "application/json", "set-cookie": sessionCookie(value) });
        return res.end(JSON.stringify({ ok: r.ok, sid }));
      }
      res.writeHead(404); return res.end();
    }
    if (url.pathname === "/app.js") { res.writeHead(200, { "content-type": "text/javascript" }); return res.end(bundle); }
    // ── Next.js 처럼: 관문(proxy) 먼저 ──
    const nextUrl = Object.assign(new URL(url.href), { clone: () => new URL(url.href) });
    const token = cookieValue(req.headers.cookie, "__Host-ws_session");
    const gate = await proxy({ nextUrl, cookies: { get: (n: string) => (n === "__Host-ws_session" && token ? { value: token } : undefined) } } as never);
    if (!gate.headers.get("x-middleware-next")) return send(res, gate);
    if (url.pathname.startsWith("/api/")) {
      const handler = ROUTES[key];
      if (!handler) { res.writeHead(404); return res.end(); }
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      const headers = new Headers();
      for (const h of ["cookie", "origin", "sec-fetch-site", "content-type"]) if (req.headers[h]) headers.set(h, String(req.headers[h]));
      const r = await handler(new Request(url, { method: req.method, headers, ...(req.method === "GET" ? {} : { body: Buffer.concat(chunks) }) }));
      return send(res, r);
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": gate.headers.get("cache-control") ?? "" });
    res.end(PAGE);
  } catch (error) {
    res.writeHead(500);
    res.end(String(error));
  }
});
server.listen(0, () => {
  const a = server.address() as { port: number };
  console.info(`READY ${a.port}`); // 시험 러너가 읽음 (web.ts 가 console 을 모으므로 stdout 에 직접)
  process.stdout.write(`READY ${a.port}\n`);
});
