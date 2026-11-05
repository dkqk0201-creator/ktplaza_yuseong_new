"use client";

import { useState } from "react";
import { logout } from "./auth-guard";

export function LogoutButton() {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        const error = await logout(false);
        if (error) {
          window.alert(error);
          setBusy(false);
        }
      }}
      className="rounded-md border border-line px-2 py-1 text-xs font-semibold text-ink-muted disabled:opacity-60"
    >
      로그아웃
    </button>
  );
}
