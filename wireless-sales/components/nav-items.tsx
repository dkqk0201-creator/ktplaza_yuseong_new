import type { ReactNode } from "react";

export interface NavItem {
  href: string;
  label: string;
  icon: ReactNode;
}

const iconProps = {
  width: 20,
  height: 20,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

export const NAV_ITEMS: NavItem[] = [
  {
    href: "/",
    label: "검수관리",
    icon: (
      <svg {...iconProps}>
        <rect x="5" y="3" width="14" height="18" rx="2" />
        <path d="M9 3.5h6M8.5 12l2.5 2.5 4.5-5" />
      </svg>
    ),
  },
  {
    href: "/quick",
    label: "간편등록",
    icon: (
      <svg {...iconProps}>
        <path d="M13 3 5 14h6l-1 7 8-11h-6l1-7z" />
      </svg>
    ),
  },
  {
    href: "/cards",
    label: "카드실적",
    icon: (
      <svg {...iconProps}>
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <path d="M3 10h18M7 15h4" />
      </svg>
    ),
  },
  {
    href: "/budget",
    label: "예산관리",
    icon: (
      <svg {...iconProps}>
        <rect x="3" y="6" width="18" height="13" rx="2" />
        <path d="M3 10h18M16 15h2" />
      </svg>
    ),
  },
  {
    href: "/spot",
    label: "스팟관리",
    icon: (
      <svg {...iconProps}>
        <path d="M12 3v3M12 18v3M3 12h3M18 12h3" />
        <circle cx="12" cy="12" r="5" />
        <circle cx="12" cy="12" r="1.5" />
      </svg>
    ),
  },
  {
    href: "/customer",
    label: "실력지표",
    icon: (
      <svg {...iconProps}>
        <circle cx="10" cy="8" r="3.5" />
        <path d="M3.5 19.5c.8-3.3 3.3-5 6.5-5 1.2 0 2.3.2 3.2.7" />
        <circle cx="17" cy="16" r="2.8" />
        <path d="m19.1 18.1 2.1 2.1" />
      </svg>
    ),
  },
  {
    href: "/staff",
    label: "직원 실적관리",
    icon: (
      <svg {...iconProps}>
        <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
      </svg>
    ),
  },
];

/** 현재 주소에 해당하는 메뉴인지 판단 (가장 길게 일치하는 메뉴만 활성) */
export function findActiveHref(pathname: string): string | undefined {
  return NAV_ITEMS.map((item) => item.href)
    .filter((href) =>
      href === "/"
        ? pathname === "/"
        : pathname === href || pathname.startsWith(`${href}/`),
    )
    .sort((a, b) => b.length - a.length)[0];
}
