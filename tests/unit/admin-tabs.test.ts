import { describe, expect, it } from "vitest";
import {
  ADMIN_WORKSPACE_TABS,
  isAdminWorkspaceTab,
  parseAdminWorkspaceTab
} from "@/lib/admin-tabs";

describe("admin workspace tabs", () => {
  it("recognizes every rendered admin destination, including drivers", () => {
    for (const tab of ADMIN_WORKSPACE_TABS) {
      expect(isAdminWorkspaceTab(tab)).toBe(true);
      expect(parseAdminWorkspaceTab(tab)).toBe(tab);
    }
  });

  it("uses the requested fallback for invalid input", () => {
    expect(parseAdminWorkspaceTab("unknown")).toBe("health");
    expect(parseAdminWorkspaceTab(undefined, "drivers")).toBe("drivers");
  });
});
