"use client";

import { useEffect } from "react";

/*
 * 로그인 세션이 끝났을 때(만료·다른 기기에서 로그아웃 등) 업무 API 가 401 을 돌려주면 로그인 화면으로 보낸다.
 * 이 사이트의 /api/ 요청만 본다. 쿠키·비밀값은 다루지 않는다 (세션 쿠키는 HttpOnly 라 브라우저 스크립트가 읽을 수 없음).
 */
let installed = false;

export function AuthGuard() {
  useEffect(() => {
    if (installed) return;
    installed = true;
    const original = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const response = await original(input, init);
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const sameSiteApi = new URL(url, window.location.href).origin === window.location.origin
        && new URL(url, window.location.href).pathname.startsWith("/api/")
        && !new URL(url, window.location.href).pathname.startsWith("/api/auth/");
      if (response.status === 401 && sameSiteApi && window.location.pathname !== "/login") {
        const next = window.location.pathname + window.location.search;
        window.location.replace(`/login?next=${encodeURIComponent(next)}`);
      }
      return response;
    };
  }, []);
  return null;
}

/** 로그아웃: 서버 세션을 지운 뒤 로그인 화면으로 */
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
  window.location.replace("/login");
  return null;
}
