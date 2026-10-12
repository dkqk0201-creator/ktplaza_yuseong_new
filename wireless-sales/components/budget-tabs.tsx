import Link from "next/link";

/* 예산관리 안의 메뉴: 예산 현황 / 모델정책 정산 */

const TABS = [
  { href: "/budget", label: "예산 현황" },
  { href: "/budget/model-policy", label: "모델정책 정산" },
] as const;

export function BudgetTabs({ active }: { active: (typeof TABS)[number]["href"] }) {
  return (
    <nav aria-label="예산관리 메뉴" className="mb-4 flex gap-1.5">
      {TABS.map((tab) => {
        const on = tab.href === active;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={on ? "page" : undefined}
            className={`rounded-lg px-3.5 py-2 text-sm font-semibold ${
              on
                ? "bg-ink text-white"
                : "border border-line bg-white text-ink-sub hover:bg-zinc-50"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
