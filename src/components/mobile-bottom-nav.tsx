"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type NavItem = {
  href: string;
  label: string;
};

const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/picks", label: "Pick'em" },
  { href: "/leaderboard", label: "Leaderboard" },
  { href: "/feedback", label: "Feedback" }
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
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 backdrop-blur md:hidden">
      <ul className="mx-auto grid max-w-3xl grid-cols-4">
        {NAV_ITEMS.map((item) => {
          const active = isActiveRoute(pathname, item.href);
          return (
            <li key={item.href}>
              <Link
                className={`flex h-14 items-center justify-center text-xs font-semibold ${
                  active ? "text-slate-900" : "text-slate-500"
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
