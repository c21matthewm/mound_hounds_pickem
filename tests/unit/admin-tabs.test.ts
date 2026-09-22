import { describe, expect, it } from "vitest";
import { ADMIN_WORKSPACE_TABS, isAdminWorkspaceTab, parseAdminWorkspaceTab, visibleAdminWorkspaceTab } from "@/lib/admin-tabs";
describe("Admin workspace navigation", () => {
  it("recognizes every new and existing destination", () => {
    for(const tab of ADMIN_WORKSPACE_TABS) {
      expect(isAdminWorkspaceTab(tab)).toBe(true);
      expect(parseAdminWorkspaceTab(tab)).toBe(tab);
    }
    expect(ADMIN_WORKSPACE_TABS).toContain("seasons");
    expect(ADMIN_WORKSPACE_TABS).toContain("race-week");
  });
  it("opens Race Week by default while respecting explicit fallbacks", () => {
    expect(parseAdminWorkspaceTab("unknown")).toBe("race-week");
    expect(parseAdminWorkspaceTab(undefined)).toBe("race-week");
    expect(parseAdminWorkspaceTab(undefined,"drivers")).toBe("drivers");
  });
  it("keeps old results links focused and selects the matching visible navigation item", () => {
    expect(parseAdminWorkspaceTab("results")).toBe("results");
    expect(visibleAdminWorkspaceTab("results")).toBe("race-week");
    expect(visibleAdminWorkspaceTab("health")).toBe("health");
    expect(visibleAdminWorkspaceTab("races")).toBe("races");
  });
});
