"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type NavItem = {
  href: string;
  label: string;
};

const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/picks", label: "Pick'em Form" },
  { href: "/leaderboard", label: "Standings" }
];

const isActiveRoute = (pathname: string, href: string): boolean => {
  if (pathname === href) {
    return true;
  }

  if (href === "/leaderboard" && pathname.startsWith("/leaderboard")) {
    return true;
  }

  return false;
};

export function MobileBottomNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Primary mobile navigation"
      className="mobile-bottom-navigation fixed inset-x-0 z-40 px-3 md:hidden"
      data-mobile-navigation
    >
      <ul className="ui-panel ui-panel-translucent mx-auto grid max-w-md grid-cols-3 rounded-full border border-slate-200 bg-white/90 p-1 shadow-[0_18px_50px_-28px_rgba(15,23,42,0.85)] backdrop-blur">
        {NAV_ITEMS.map((item) => {
          const active = isActiveRoute(pathname, item.href);
          return (
            <li key={item.href}>
              <Link
                aria-current={active ? "page" : undefined}
                className={`flex h-11 items-center justify-center rounded-full text-xs font-semibold ${
                  active
                    ? "ui-action-primary bg-slate-900 text-white shadow-sm"
                    : "text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                }`}
                href={item.href}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
