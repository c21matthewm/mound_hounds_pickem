export type PrimaryNavigationItem = {
  href: string;
  label: string;
};

export const PRIMARY_NAVIGATION_ITEMS: PrimaryNavigationItem[] = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/picks", label: "Pick'em Form" },
  { href: "/leaderboard", label: "Standings" }
];

export const isPrimaryNavigationRouteActive = (
  pathname: string,
  href: string
): boolean => pathname === href || pathname.startsWith(`${href}/`);
