"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { NAV_ITEMS, findActiveHref } from "./nav-items";

function BrandMark() {
  return (
    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand text-sm font-extrabold text-white">
      kt
    </span>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const activeHref = findActiveHref(pathname);

  return (
    <div className="flex min-h-full flex-1">
      {/* PC: 왼쪽 사이드바 */}
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-line bg-white md:flex">
        <div className="flex h-16 items-center gap-2.5 border-b border-line px-5">
          <BrandMark />
          <span className="text-base font-bold text-ink">무선 판매 관리</span>
        </div>
        <nav className="flex flex-col gap-1 p-3" aria-label="주 메뉴">
          {NAV_ITEMS.map((item) => {
            const active = item.href === activeHref;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-[15px] font-medium transition-colors ${
                  active
                    ? "bg-brand-soft text-brand"
                    : "text-ink-sub hover:bg-zinc-100 hover:text-ink"
                }`}
              >
                {item.icon}
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="mt-auto border-t border-line px-5 py-4 text-xs text-ink-muted">
          KT플라자 유성점
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* 모바일: 상단 바 */}
        <header className="sticky top-0 z-20 flex h-14 items-center gap-2.5 border-b border-line bg-white/95 px-4 backdrop-blur md:hidden">
          <BrandMark />
          <span className="text-base font-bold text-ink">무선 판매 관리</span>
        </header>

        <main className="flex-1 px-4 pt-5 pb-24 sm:px-6 md:px-8 md:py-8">
          {children}
        </main>
      </div>

      {/* 모바일: 하단 탭 메뉴 */}
      <nav
        className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-5 border-t border-line bg-white pb-[env(safe-area-inset-bottom)] md:hidden"
        aria-label="주 메뉴"
      >
        {NAV_ITEMS.map((item) => {
          const active = item.href === activeHref;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={`flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-medium ${
                active ? "text-brand" : "text-ink-muted"
              }`}
            >
              {item.icon}
              {item.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
