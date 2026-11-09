"use client";

import { useState } from "react";
import { logout } from "./auth-guard";

/** 로그아웃 (이 기기) + 모든 기기에서 로그아웃 (확인 후, 이 기기 포함 모든 세션을 서버에서 무효화) */
export function LogoutButton() {
  const [busy, setBusy] = useState(false);
  async function run(all: boolean) {
    if (all && !window.confirm("모든 기기에서 로그아웃할까요?\n이 기기를 포함해 로그인된 모든 기기(최대 3대)의 로그인이 즉시 끝납니다.")) return;
    setBusy(true);
    const error = await logout(all);
    if (error) {
      window.alert(error);
      setBusy(false);
    }
  }
  const style = "rounded-md border border-line px-2 py-1 text-xs font-semibold text-ink-muted disabled:opacity-60";
  return (
    <span className="inline-flex items-center gap-1.5">
      <button type="button" disabled={busy} onClick={() => void run(false)} className={style}>
        로그아웃
      </button>
      <button type="button" disabled={busy} onClick={() => void run(true)} className={style}>
        모든 기기 로그아웃
      </button>
    </span>
  );
}
