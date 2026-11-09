"use client";

import { useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { markSignedIn } from "@/components/auth-guard";
import { safeNext } from "@/lib/session-policy";

/* 관리자 로그인 (비밀번호 + OTP 앱 6자리). 입력값은 서버로만 보내고 브라우저에 저장하지 않는다. */

/** 로그인 화면으로 오게 된 이유 (주소의 reason) */
const REASON_MESSAGE: Record<string, string> = {
  idle: "30분 동안 사용하지 않아 자동 로그아웃되었습니다. 다시 로그인해 주세요.",
  expired: "30분 동안 사용하지 않아 자동 로그아웃되었습니다. 다시 로그인해 주세요.",
  revoked: "로그인이 끝났습니다 (다른 기기에서 모든 기기 로그아웃 등). 다시 로그인해 주세요.",
};

export function LoginForm() {
  const params = useSearchParams();
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password, otp }),
        cache: "no-store",
      });
      const data = (await response.json()) as { ok?: boolean; message?: string };
      if (response.ok && data.ok === true) {
        setPassword("");
        setOtp("");
        markSignedIn();
        window.location.replace(safeNext(params.get("next")));
        return;
      }
      setError(data.message || "로그인하지 못했습니다.");
    } catch {
      setError("서버와 통신하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    }
    setOtp("");
    setBusy(false);
  }

  return (
    <div className="mx-auto mt-10 w-full max-w-sm rounded-2xl border border-line bg-white p-6">
      <h1 className="text-lg font-bold text-ink">관리자 로그인</h1>
      <p className="mt-1 text-sm text-ink-muted">비밀번호와 OTP 앱의 6자리 코드를 입력해 주세요.</p>
      {REASON_MESSAGE[params.get("reason") ?? ""] && !error && (
        <p role="status" className="mt-3 rounded-lg bg-zinc-100 px-3 py-2 text-sm font-semibold text-ink">
          {REASON_MESSAGE[params.get("reason") ?? ""]}
        </p>
      )}
      <form className="mt-5 space-y-4" onSubmit={submit}>
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
        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-lg bg-brand px-4 py-2.5 text-base font-bold text-white disabled:opacity-60"
        >
          {busy ? "확인 중…" : "로그인"}
        </button>
      </form>
    </div>
  );
}
