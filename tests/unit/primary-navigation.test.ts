import { describe, expect, it } from "vitest";
import {
  isPrimaryNavigationRouteActive,
  PRIMARY_NAVIGATION_ITEMS
} from "@/lib/primary-navigation";

describe("primary navigation", () => {
  it("keeps desktop and mobile destinations in the intended order", () => {
    expect(PRIMARY_NAVIGATION_ITEMS).toEqual([
      { href: "/dashboard", label: "Dashboard" },
      { href: "/picks", label: "Pick'em Form" },
      { href: "/leaderboard", label: "Standings" }
    ]);
  });

  it("matches exact and nested routes without matching similar prefixes", () => {
    expect(isPrimaryNavigationRouteActive("/leaderboard", "/leaderboard")).toBe(true);
    expect(isPrimaryNavigationRouteActive("/leaderboard/history", "/leaderboard")).toBe(true);
    expect(isPrimaryNavigationRouteActive("/leaderboards", "/leaderboard")).toBe(false);
  });
});
