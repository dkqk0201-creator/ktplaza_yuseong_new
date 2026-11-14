/**
 * 무선 판매 관리 웹앱 — 관리자 로그인 상태 (Apps Script 에 새 파일 auth-handler.gs 로 추가)
 *
 * 장표(구글시트)에는 접근하지 않는다. 스크립트 속성 WS_AUTH_STATE 하나에 JSON 으로만 보관:
 *   { sessions: [{ h: 세션ID의 SHA-256, exp: 만료(초) }], lastStep: 마지막으로 쓴 OTP 칸,
 *     fails: 연속 실패 수, lockUntil: 잠금 끝(ms), lockCount: 잠긴 횟수 }
 * Vercel 서버가 여러 개여도 이 한 곳을 잠금(LockService) 안에서 읽고 쓰므로 횟수·잠금·로그아웃이 모두 공통이다.
 * 단, auth-check(세션 확인)는 읽기만 하므로 잠금을 잡지 않는다 — 장표 저장 등이 잠금을 잡고 있어도 기다리지 않는다.
 *
 * 요청 (웹앱 서버만 보냄, API_SECRET 필요):
 *   auth-login  { result: "ok"|"fail", session, exp, step }  → 잠겨 있으면 결과와 상관없이 거부
 *                 ok 이고 step 이 마지막 OTP 칸보다 클 때만 세션 등록 (같은 OTP 다시 쓰기 차단)
 *                 그 밖은 실패 1회. 연속 5회 실패하면 15분 잠금, 다시 잠길 때마다 2배 (최대 24시간)
 *   auth-check  { session } → 살아 있는 세션인지
 *   auth-logout { session, all } → 그 세션(또는 모든 세션) 즉시 삭제
 * 응답 handler = "ws-auth". 이 파일은 update-handler.gs 의 wsHandleSaleUpdate_ 가 action "auth-*" 를 넘겨줄 때 실행된다.
 *
 * 복구: 잠금을 풀거나 모든 세션을 끊으려면 Apps Script 편집기에서 wsAuthReset 을 골라 ▶ 실행 (소유자만 가능).
 */
var WS_AUTH_HANDLER = "ws-auth";
var WS_AUTH_STATE_KEY = "WS_AUTH_STATE";
var WS_AUTH_MAX_FAILS = 5;
var WS_AUTH_LOCK_BASE_MS = 15 * 60 * 1000;
var WS_AUTH_LOCK_MAX_MS = 24 * 60 * 60 * 1000;
var WS_AUTH_MAX_SESSIONS = 3;
var WS_AUTH_SESSION_MAX_SEC = 13 * 60 * 60;

function wsAuthReadState_() {
  var raw = PropertiesService.getScriptProperties().getProperty(WS_AUTH_STATE_KEY);
  var s = {};
  try {
    s = raw ? JSON.parse(raw) : {};
  } catch (err) {
    s = {};
  }
  return {
    sessions: Array.isArray(s.sessions) ? s.sessions : [],
    lastStep: Number(s.lastStep) || 0,
    fails: Number(s.fails) || 0,
    lockUntil: Number(s.lockUntil) || 0,
    lockCount: Number(s.lockCount) || 0,
  };
}

function wsAuthWriteState_(state) {
  PropertiesService.getScriptProperties().setProperty(WS_AUTH_STATE_KEY, JSON.stringify(state));
}

function wsAuthReply_(obj) {
  obj.handler = WS_AUTH_HANDLER;
  return wsJson_(obj);
}

function wsHandleAuth_(body) {
  if (!wsAuthorized_(body)) return wsAuthReply_({ ok: false, code: "unauthorized", message: "인증에 실패했습니다." });
  var session = typeof body.session === "string" && /^[0-9a-f]{64}$/.test(body.session) ? body.session : "";

  // 세션 확인은 읽기만 하므로 잠금 없이 처리한다 (저장·수정이 잠금을 잡고 있어도 기다리지 않음).
  // 로그아웃·로그인은 잠금 안에서 스크립트 속성을 다 쓴 뒤에 끝나므로, 그 뒤의 확인은 항상 바뀐 상태를 읽는다.
  if (body.action === "auth-check") {
    var nowCheck = Math.floor(Date.now() / 1000);
    var alive = !!session && wsAuthReadState_().sessions.some(function (x) {
      return x && x.h === session && Number(x.exp) > nowCheck;
    });
    return wsAuthReply_({ ok: alive, code: alive ? "ok" : "invalid" });
  }

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return wsAuthReply_({ ok: false, code: "busy", message: "잠시 후 다시 시도해 주세요." });
  try {
    var state = wsAuthReadState_();
    var nowMs = Date.now();
    var nowSec = Math.floor(nowMs / 1000);
    // 만료된 세션 정리
    state.sessions = state.sessions.filter(function (x) {
      return x && typeof x.h === "string" && Number(x.exp) > nowSec;
    });

    if (body.action === "auth-logout") {
      state.sessions = body.all === true ? [] : state.sessions.filter(function (x) { return x.h !== session; });
      wsAuthWriteState_(state);
      return wsAuthReply_({ ok: true, code: "ok" });
    }

    if (body.action === "auth-login") {
      if (state.lockUntil > nowMs) {
        return wsAuthReply_({ ok: false, code: "locked", retryAfterSec: Math.ceil((state.lockUntil - nowMs) / 1000) });
      }
      var step = Number(body.step);
      var exp = Number(body.exp);
      var passed =
        body.result === "ok" &&
        !!session &&
        Number.isInteger(step) &&
        step > state.lastStep && // 이미 쓴 OTP(또는 그보다 이전 칸)는 다시 쓸 수 없다
        Number.isInteger(exp) &&
        exp > nowSec &&
        exp <= nowSec + WS_AUTH_SESSION_MAX_SEC;
      if (passed) {
        state.fails = 0;
        state.lockCount = 0;
        state.lockUntil = 0;
        state.lastStep = step;
        state.sessions.push({ h: session, exp: exp });
        // 기기는 최대 3개 (가장 오래된 세션부터 끊음)
        while (state.sessions.length > WS_AUTH_MAX_SESSIONS) state.sessions.shift();
        wsAuthWriteState_(state);
        return wsAuthReply_({ ok: true, code: "ok" });
      }
      state.fails += 1;
      if (state.fails >= WS_AUTH_MAX_FAILS) {
        state.lockCount += 1;
        state.lockUntil = nowMs + Math.min(WS_AUTH_LOCK_BASE_MS * Math.pow(2, state.lockCount - 1), WS_AUTH_LOCK_MAX_MS);
        state.fails = 0;
        wsAuthWriteState_(state);
        return wsAuthReply_({ ok: false, code: "locked", retryAfterSec: Math.ceil((state.lockUntil - nowMs) / 1000) });
      }
      wsAuthWriteState_(state);
      return wsAuthReply_({ ok: false, code: "invalid" });
    }
    return wsAuthReply_({ ok: false, code: "unknown", message: "알 수 없는 로그인 요청입니다." });
  } finally {
    lock.releaseLock();
  }
}

/** 편집기에서 ▶ 실행 (복구용): 로그인 잠금 해제 + 모든 기기 로그아웃. 마지막 OTP 칸 기록은 유지 */
function wsAuthReset() {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var state = wsAuthReadState_();
    wsAuthWriteState_({ sessions: [], lastStep: state.lastStep, fails: 0, lockUntil: 0, lockCount: 0 });
    console.log("로그인 잠금을 풀고 모든 기기를 로그아웃했습니다.");
  } finally {
    lock.releaseLock();
  }
}
