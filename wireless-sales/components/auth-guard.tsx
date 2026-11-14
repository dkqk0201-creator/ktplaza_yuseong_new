"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { flushSync } from "react-dom";
import {
  ACTIVITY_EVENTS,
  STATUS_POLL_MS,
  STORAGE_KEYS,
  idleRemainingMs,
  phaseAt,
  shouldHeartbeat,
  syncActivityFromServer,
  toClientMs,
  type Phase,
} from "@/lib/session-policy";

/*
 * 로그인 유지·자동 로그아웃 (화면 쪽). 서버도 같은 규칙을 강제한다 (lib/server/auth.ts) — 이 파일은
 * 화면을 제때 가리거나 지우고, 실제 사용자 활동을 서버에 알리는 역할.
 *
 *  - 실제 사용자 활동(클릭·키 입력·터치·휠/터치 스크롤, isTrusted 만)이 있으면 1분에 최대 한 번
 *    /api/auth/activity 로 알려 서버의 30분 미사용 만료를 늘린다. 업무 API·자동 조회·타이머는 활동이 아니다.
 *  - 28분 미사용: 화면을 가리고 "2분 후 자동 로그아웃" 경고 (아무 곳이나 누르면 계속, 입력 내용 유지)
 *  - 30분 미사용: 화면 내용을 지우고(메모리에서도 제거) 서버 세션을 지운 뒤 로그인 화면으로
 *  - 최대 8시간: 30분 전부터 재확인 안내, 지나면 화면을 가린 채 비밀번호+OTP 재확인 창 (입력 중인 내용 유지)
 *  - 여러 탭: 활동·로그아웃·재확인을 localStorage 시각 값으로 공유 (고객 정보·세션 값은 저장하지 않음)
 *  - 다른 탭에서 돌아올 때·절전에서 깨어날 때·5분마다·페이지 복원(뒤로 가기) 때 서버로 다시 확인
 *  - 업무 API 가 401 이면 이유에 따라 재확인 창 또는 화면 제거 후 로그인 화면
 * 쿠키·비밀값은 다루지 않는다 (세션 쿠키는 HttpOnly 라 브라우저 스크립트가 읽을 수 없음).
 */

type EndReason = "idle" | "expired" | "revoked" | "signout";
const END_EVENT = "ws-auth-end";
const DENIED_EVENT = "ws-auth-denied";

function store(key: string, value: number) {
  try {
    window.localStorage.setItem(key, String(value));
  } catch {
    /* 저장소를 쓸 수 없는 브라우저(사생활 보호 모드 등): 이 탭만 기준으로 동작 */
  }
}
function storedNumber(key: string): number {
  try {
    const n = Number(window.localStorage.getItem(key));
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

/** 로그인 화면이 로그인 성공 직후 부른다: 다른 탭에 알리고 활동 시각을 지금으로 */
export function markSignedIn() {
  const now = Date.now();
  store(STORAGE_KEYS.activity, now);
  store(STORAGE_KEYS.heartbeat, now);
  store(STORAGE_KEYS.renewed, now);
}

/** 로그아웃: 서버 세션을 지운 뒤(모든 기기면 모든 세션) 화면을 지우고 로그인 화면으로. 실패하면 안내 문구 */
export async function logout(all = false): Promise<string | null> {
  try {
    const response = await fetch("/api/auth/logout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ all }),
      cache: "no-store",
    });
    const data = (await response.json()) as { ok?: boolean; message?: string };
    if (!data.ok) return data.message || "로그아웃하지 못했습니다.";
  } catch {
    return "서버와 통신하지 못했습니다. 다시 시도해 주세요.";
  }
  const handled = !window.dispatchEvent(new CustomEvent(END_EVENT, { detail: "signout", cancelable: true }));
  if (!handled) window.location.replace("/login");
  return null;
}

/** 이 사이트의 업무 API(/api/auth/ 제외)가 401 이면 이유(code)를 알린다 */
let installed = false;
function installFetchGuard() {
  if (installed) return;
  installed = true;
  const original = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const response = await original(input, init);
    if (response.status !== 401) return response;
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, window.location.href);
    if (url.origin !== window.location.origin || !url.pathname.startsWith("/api/") || url.pathname.startsWith("/api/auth/")) {
      return response;
    }
    let code = "unauthenticated";
    try {
      code = String(((await response.clone().json()) as { code?: unknown }).code ?? code);
    } catch {
      /* 본문이 JSON 이 아니면 일반 로그인 필요로 처리 */
    }
    window.dispatchEvent(new CustomEvent(DENIED_EVENT, { detail: code }));
    return response;
  };
}

export function AuthGuard({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  if (pathname === "/login") return <>{children}</>;
  return <SessionManager>{children}</SessionManager>;
}

type ServerTimes = { now: number; exp: number; idleExp: number };

function SessionManager({ children }: { children: ReactNode }) {
  const [ended, setEnded] = useState(false);
  const [phase, setPhase] = useState<Phase>("active");
  /** 30분 미사용을 감지하고 서버에 확인하는 동안 (화면을 가림) */
  const [checking, setChecking] = useState(false);
  /** 최대 시간 전에 스스로 연 재확인 창 */
  const [reauthOpen, setReauthOpen] = useState(false);
  const [, setTick] = useState(0);

  /** 마지막 실제 사용자 활동 (이 탭 + 다른 탭). 활동 갱신 API 는 이 값으로만 보낸다 */
  const lastActivity = useRef(0);
  /**
   * 서버의 미사용 만료로 거꾸로 계산한 활동 시각 (저장소를 못 쓰는 브라우저에서 다른 탭 활동 반영용).
   * 화면의 로그아웃 시점을 늦추는 데만 쓰고, 활동 갱신 API 를 보내는 근거로는 쓰지 않는다
   * (서버 확인 응답이 늦게 와도 그것이 "활동"이 되어 세션이 늘어나는 일이 없게).
   */
  const serverActivity = useRef(0);
  const lastSent = useRef(0);
  const lastStored = useRef(0);
  const absDeadline = useRef<number | null>(null);
  /** 첫 서버 확인 전에는 브라우저 시계만으로 로그아웃하지 않는다 (저장된 예전 시각으로 잘못 끊지 않게) */
  const verified = useRef(false);
  const endedRef = useRef(false);
  const checkingRef = useRef(false);

  const end = useCallback((reason: EndReason, opts: { broadcast?: boolean; revoke?: boolean } = {}) => {
    if (endedRef.current) return;
    endedRef.current = true;
    // 고객 정보가 들어 있는 화면을 먼저 지운다 (메모리의 판매 데이터도 함께 사라짐) — 페이지 복원 사진에도 남지 않게
    flushSync(() => setEnded(true));
    if (opts.broadcast !== false) store(STORAGE_KEYS.signout, Date.now());
    const next = window.location.pathname + window.location.search;
    const go = () => {
      const params = new URLSearchParams();
      if (reason !== "signout") params.set("reason", reason);
      if (reason === "idle" || reason === "expired") params.set("next", next);
      const query = params.toString();
      window.location.replace(`/login${query ? `?${query}` : ""}`);
    };
    if (opts.revoke) {
      // 서버 세션도 지운다 (실패해도 서버의 30분 만료가 따로 막음)
      fetch("/api/auth/logout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ all: false }),
        cache: "no-store",
        keepalive: true,
      }).catch(() => undefined).finally(go);
    } else {
      go();
    }
  }, []);

  /** 서버 시각 반영. startedAt = 요청을 보낸 브라우저 시각 (응답이 늦어도 만료를 뒤로 미루지 않도록 보수적으로) */
  const applyServer = useCallback((t: ServerTimes, startedAt: number) => {
    absDeadline.current = toClientMs(t.exp, t.now, startedAt);
    serverActivity.current = syncActivityFromServer(serverActivity.current, toClientMs(t.idleExp, t.now, startedAt));
    verified.current = true;
  }, []);
  const effectiveActivity = useCallback(() => Math.max(lastActivity.current, serverActivity.current), []);

  /** 서버 응답이 401 일 때: 재확인이 필요하면 창을, 아니면 화면을 지우고 로그인 화면으로 */
  const handleDenied = useCallback((code: string) => {
    if (code === "reauth_required") {
      absDeadline.current = Math.min(absDeadline.current ?? Date.now(), Date.now());
      setPhase("reauth-required");
      return;
    }
    // 브라우저 쿠키도 지우도록 로그아웃 API 를 거친다 (서버에서 이미 끊긴 세션이어도 무해)
    end(code === "idle_expired" ? "expired" : "revoked", { revoke: true });
  }, [end]);

  /** 서버 로그인 상태 확인 (세션을 늘리지 않음). 결과: ok / denied / unavailable */
  const checkStatus = useCallback(async (): Promise<"ok" | "denied" | "unavailable"> => {
    const startedAt = Date.now();
    try {
      const response = await fetch("/api/auth/status", { cache: "no-store" });
      const data = (await response.json()) as Partial<ServerTimes> & { ok?: boolean; code?: string };
      if (response.ok && data.ok && typeof data.now === "number" && typeof data.exp === "number" && typeof data.idleExp === "number") {
        applyServer(data as ServerTimes, startedAt);
        return "ok";
      }
      if (response.status === 401) {
        handleDenied(String(data.code ?? "unauthenticated"));
        return "denied";
      }
    } catch {
      /* 통신 실패 */
    }
    return "unavailable";
  }, [applyServer, handleDenied]);

  /** 30분 미사용을 감지했을 때: 화면을 가리고, 다른 탭의 활동이 서버에 있었는지 확인한 뒤 끝낸다 */
  const onIdleExpired = useCallback(async () => {
    if (checkingRef.current || endedRef.current) return;
    checkingRef.current = true;
    setChecking(true);
    const result = await checkStatus(); // 서버의 미사용 만료로 다른 탭 활동을 반영 (통신 실패면 브라우저 시계로)
    checkingRef.current = false;
    if (result === "denied") return; // checkStatus 가 이미 처리
    if (phaseAt({ now: Date.now(), lastActivity: effectiveActivity(), absDeadline: null }) !== "idle-expired") {
      setChecking(false); // 다른 탭에서 작업 중이었음 → 계속
      return;
    }
    end("idle", { revoke: true });
  }, [checkStatus, effectiveActivity, end]);

  const sendHeartbeat = useCallback(async () => {
    const now = Date.now();
    lastSent.current = now;
    store(STORAGE_KEYS.heartbeat, now);
    try {
      const response = await fetch("/api/auth/activity", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inactiveSec: Math.max(0, Math.floor((now - lastActivity.current) / 1000)) }),
        cache: "no-store",
      });
      const data = (await response.json()) as Partial<ServerTimes> & { ok?: boolean; code?: string };
      if (response.ok && data.ok && typeof data.now === "number") applyServer(data as ServerTimes, now);
      else if (response.status === 401) handleDenied(String(data.code ?? "unauthenticated"));
    } catch {
      /* 통신 실패: 다음 활동 때 다시 (서버 만료가 따로 막음) */
    }
  }, [applyServer, handleDenied]);

  /** 1초마다 상태 계산 (화면이 안 보이는 탭은 브라우저가 느리게 돌림 — 돌아올 때 따로 확인) */
  const evaluate = useCallback(() => {
    if (endedRef.current || !verified.current) return;
    const now = Date.now();
    lastActivity.current = Math.max(lastActivity.current, storedNumber(STORAGE_KEYS.activity));
    lastSent.current = Math.max(lastSent.current, storedNumber(STORAGE_KEYS.heartbeat));
    const next = phaseAt({ now, lastActivity: effectiveActivity(), absDeadline: absDeadline.current });
    setPhase(next);
    if (next === "idle-warning" || next === "reauth-soon") setTick((n) => (n + 1) % 1_000_000); // 남은 시간 표시
    if (next === "idle-expired") {
      void onIdleExpired();
      return;
    }
    if (next !== "reauth-required" && shouldHeartbeat(now, lastActivity.current, lastSent.current)) void sendHeartbeat();
  }, [effectiveActivity, onIdleExpired, sendHeartbeat]);

  useEffect(() => {
    installFetchGuard();
    const mountedAt = Date.now();
    lastActivity.current = storedNumber(STORAGE_KEYS.activity);
    void checkStatus().then((r) => {
      if (r === "unavailable") {
        // 서버 확인이 안 되면 지금을 기준으로 브라우저 규칙만 적용 (서버가 API 마다 따로 막음). 활동으로 치지는 않음
        serverActivity.current = Math.max(serverActivity.current, mountedAt);
        verified.current = true;
      }
      evaluate();
    });

    const onActivity = (event: Event) => {
      if (!event.isTrusted || endedRef.current) return;
      const now = Date.now();
      lastActivity.current = now;
      if (now - lastStored.current >= 1000) {
        lastStored.current = now;
        store(STORAGE_KEYS.activity, now);
      }
      if (checkingRef.current) return;
      evaluate();
    };
    for (const name of ACTIVITY_EVENTS) window.addEventListener(name, onActivity, { capture: true, passive: true });

    const onStorage = (event: StorageEvent) => {
      if (event.key === STORAGE_KEYS.signout && event.newValue) end("signout", { broadcast: false });
      else if (event.key === STORAGE_KEYS.renewed && event.newValue) {
        void checkStatus().then(() => {
          setReauthOpen(false);
          evaluate();
        });
      } else if (event.key === STORAGE_KEYS.activity) evaluate();
    };
    window.addEventListener("storage", onStorage);

    // 다른 탭·절전에서 돌아오면: 먼저 브라우저 시계로 판단(30분 넘었으면 바로 가림), 그다음 서버 확인
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      evaluate();
      if (!endedRef.current && !checkingRef.current) void checkStatus().then(evaluate);
    };
    document.addEventListener("visibilitychange", onVisible);

    // 뒤로·앞으로 가기로 예전 화면이 복원되면 서버에서 새로 받는다 (로그아웃했으면 로그인 화면으로 감)
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) {
        flushSync(() => setChecking(true));
        window.location.reload();
      }
    };
    window.addEventListener("pageshow", onPageShow);

    const onDenied = (event: Event) => handleDenied(String((event as CustomEvent).detail));
    window.addEventListener(DENIED_EVENT, onDenied);
    const onEnd = (event: Event) => {
      event.preventDefault();
      end((event as CustomEvent).detail as EndReason);
    };
    window.addEventListener(END_EVENT, onEnd);

    const tick = window.setInterval(evaluate, 1000);
    const poll = window.setInterval(() => {
      if (document.visibilityState === "visible" && !endedRef.current && !checkingRef.current) void checkStatus().then(evaluate);
    }, STATUS_POLL_MS);

    return () => {
      for (const name of ACTIVITY_EVENTS) window.removeEventListener(name, onActivity, { capture: true });
      window.removeEventListener("storage", onStorage);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pageshow", onPageShow);
      window.removeEventListener(DENIED_EVENT, onDenied);
      window.removeEventListener(END_EVENT, onEnd);
      window.clearInterval(tick);
      window.clearInterval(poll);
    };
  }, [checkStatus, end, evaluate, handleDenied]);

  if (ended) return null;

  const reauthRequired = phase === "reauth-required";
  const warning = phase === "idle-warning";
  const covered = checking || warning || reauthRequired || reauthOpen;
  const now = Date.now();

  return (
    <>
      {/* 가린 동안에는 보이지도 누를 수도 없게 (입력 중인 내용은 그대로 남음) */}
      <div style={{ display: covered ? "none" : "contents" }} inert={covered} aria-hidden={covered || undefined}>
        {children}
      </div>
      {phase === "reauth-soon" && !covered && absDeadline.current !== null && (
        <ReauthNotice minutes={Math.max(1, Math.ceil((absDeadline.current - now) / 60_000))} onOpen={() => setReauthOpen(true)} />
      )}
      {checking && !warning && !reauthRequired && <Cover title="로그인 상태를 확인하는 중입니다…" />}
      {warning && !reauthRequired && (
        <IdleWarning seconds={Math.ceil(idleRemainingMs(now, effectiveActivity()) / 1000)} />
      )}
      {(reauthRequired || reauthOpen) && (
        <ReauthDialog
          required={reauthRequired}
          onDone={(t, startedAt) => {
            applyServer(t, startedAt);
            lastActivity.current = Date.now();
            markSignedIn();
            lastSent.current = Date.now();
            setReauthOpen(false);
            setPhase("active");
            evaluate();
          }}
          onCancel={() => setReauthOpen(false)}
          onSignOut={() => void logout(false)}
        />
      )}
    </>
  );
}

function Cover({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-white px-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className="w-full max-w-sm rounded-2xl border border-line bg-white p-6 text-center shadow-sm">
        <p className="text-base font-bold text-ink">{title}</p>
        {children}
      </div>
    </div>
  );
}

function IdleWarning({ seconds }: { seconds: number }) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return (
    <Cover title="2분 후 자동 로그아웃됩니다">
      <p className="mt-2 text-sm text-ink-muted">
        28분 동안 사용하지 않아 고객 정보 화면을 가렸습니다. 남은 시간{" "}
        <b className="text-brand">{m}:{String(s).padStart(2, "0")}</b>
      </p>
      <p className="mt-1 text-sm text-ink-muted">계속 사용하려면 아래 버튼(또는 아무 곳이나)을 누르세요. 입력 중인 내용은 그대로 남아 있습니다.</p>
      <button type="button" className="mt-4 w-full rounded-lg bg-brand px-4 py-2.5 text-base font-bold text-white">
        계속 사용
      </button>
    </Cover>
  );
}

function ReauthNotice({ minutes, onOpen }: { minutes: number; onOpen: () => void }) {
  return (
    <div className="fixed inset-x-0 bottom-20 z-40 mx-auto w-[min(32rem,calc(100%-2rem))] rounded-xl border border-line bg-white px-4 py-3 shadow-lg md:bottom-6" role="status">
      <p className="text-sm text-ink">
        보안을 위해 약 <b>{minutes}분</b> 후 비밀번호·OTP 재확인이 필요합니다. 지금 확인하면 작업이 끊기지 않습니다.
      </p>
      <button type="button" onClick={onOpen} className="mt-2 rounded-lg bg-brand px-3 py-1.5 text-sm font-bold text-white">
        지금 다시 확인
      </button>
    </div>
  );
}

function ReauthDialog({
  required,
  onDone,
  onCancel,
  onSignOut,
}: {
  required: boolean;
  onDone: (t: ServerTimes, startedAt: number) => void;
  onCancel: () => void;
  onSignOut: () => void;
}) {
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    const startedAt = Date.now();
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password, otp }),
        cache: "no-store",
      });
      const data = (await response.json()) as Partial<ServerTimes> & { ok?: boolean; message?: string };
      if (response.ok && data.ok === true && typeof data.now === "number") {
        setPassword("");
        setOtp("");
        onDone(data as ServerTimes, startedAt);
        return;
      }
      setError(data.message || "확인하지 못했습니다.");
    } catch {
      setError("서버와 통신하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    }
    setOtp("");
    setBusy(false);
  }

  return (
    <Cover title={required ? "보안을 위해 다시 확인해 주세요" : "비밀번호·OTP 재확인"}>
      <p className="mt-2 text-sm text-ink-muted">
        {required
          ? "로그인 후 8시간이 지났습니다. 화면과 입력 중인 내용은 그대로 남아 있으며, 확인하면 바로 이어서 작업할 수 있습니다. 저장하던 내용이 있었다면 확인 후 저장을 다시 눌러 주세요."
          : "지금 확인하면 다시 8시간 동안 끊기지 않습니다."}
      </p>
      <form className="mt-4 space-y-3 text-left" onSubmit={submit}>
        <label className="block text-sm font-semibold text-ink">
          비밀번호
          <input
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 block w-full rounded-lg border border-line px-3 py-2 text-base"
          />
        </label>
        <label className="block text-sm font-semibold text-ink">
          인증 코드 (6자리)
          <input
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            maxLength={6}
            required
            value={otp}
            onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
            className="mt-1 block w-full rounded-lg border border-line px-3 py-2 text-base tracking-widest"
          />
        </label>
        {error && (
          <p role="alert" className="rounded-lg bg-brand-soft px-3 py-2 text-sm font-semibold text-brand-strong">
            {error}
          </p>
        )}
        <button type="submit" disabled={busy} className="w-full rounded-lg bg-brand px-4 py-2.5 text-base font-bold text-white disabled:opacity-60">
          {busy ? "확인 중…" : "확인"}
        </button>
      </form>
      <div className="mt-3 flex justify-center gap-4 text-sm">
        {!required && (
          <button type="button" onClick={onCancel} className="font-semibold text-ink-muted underline">
            나중에
          </button>
        )}
        <button type="button" onClick={onSignOut} className="font-semibold text-ink-muted underline">
          로그아웃
        </button>
      </div>
    </Cover>
  );
}
