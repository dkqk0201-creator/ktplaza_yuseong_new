/*
 * 브라우저 시험용 화면 (가짜 데이터만). 실제 웹앱의 로그인 부품을 그대로 쓴다:
 *   AuthGuard(로그인 유지·자동 로그아웃) · LoginForm · LogoutButton(모든 기기 로그아웃 포함)
 * 업무 화면 대신 고객 이름 목록·메모 입력칸·5분마다 자동 새로고침만 있는 가짜 화면을 넣는다.
 */
import { createRoot } from "react-dom/client";
import { useCallback, useEffect, useState } from "react";
import { AuthGuard } from "@/components/auth-guard";
import { LoginForm } from "@/components/login-form";
import { LogoutButton } from "@/components/logout-button";

function FakeSalesView() {
  const [names, setNames] = useState<string[]>([]);
  const load = useCallback(async () => {
    const r = await fetch("/api/sales/list?sheet=10월", { cache: "no-store" });
    const d = (await r.json()) as { ok?: boolean; sales?: { customer: string }[] };
    if (d.ok && d.sales) setNames(d.sales.map((s) => s.customer));
  }, []);
  useEffect(() => {
    void load();
    // 자동 새로고침 (사용자 활동이 아님)
    const t = window.setInterval(() => void load(), 5 * 60_000);
    const onTest = () => void load();
    window.addEventListener("test-refresh", onTest);
    return () => {
      window.clearInterval(t);
      window.removeEventListener("test-refresh", onTest);
    };
  }, [load]);
  return (
    <main>
      <h1>판매 현황 (시험)</h1>
      <div id="customers">{names.join(",")}</div>
      <input id="memo" aria-label="메모" />
      <div id="area" style={{ width: 300, height: 120 }}>빈 곳</div>
      <LogoutButton />
    </main>
  );
}

function Root() {
  if (window.location.pathname === "/login") return <LoginForm />;
  return <FakeSalesView />;
}

createRoot(document.getElementById("root")!).render(
  <AuthGuard>
    <Root />
  </AuthGuard>,
);
