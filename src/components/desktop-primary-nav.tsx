"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  isPrimaryNavigationRouteActive,
  PRIMARY_NAVIGATION_ITEMS
} from "@/lib/primary-navigation";

export function DesktopPrimaryNav() {
  const pathname = usePathname();

  return (
    <nav aria-label="Primary navigation" className="hidden md:block">
      <ul className="ui-panel flex items-center gap-1 rounded-md border border-slate-200 bg-white p-1 shadow-sm">
        {PRIMARY_NAVIGATION_ITEMS.map((item) => {
          const active = isPrimaryNavigationRouteActive(pathname, item.href);

          return (
            <li key={item.href}>
              <Link
                aria-current={active ? "page" : undefined}
                className={`inline-flex min-h-9 items-center rounded px-2.5 py-1.5 text-xs font-semibold transition-colors lg:px-3 lg:text-sm ${
                  active
                    ? "ui-action-primary bg-blue-800 text-white shadow-sm"
                    : "text-slate-600 hover:bg-slate-100 hover:text-slate-950"
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
