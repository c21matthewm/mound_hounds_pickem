import { describe, expect, it } from "vitest";
// @ts-expect-error One-time Node operator helper intentionally remains JavaScript.
import { KEEPER_ID, planAuthRemoval } from "../../scripts/lib/prelaunch-2027-plan.mjs";

const fixture = () => ({
  inventory: { keeperId: KEEPER_ID, projectFingerprint: "fixture", authUserIds: [KEEPER_ID, "test-user"], hallOfFame: { entries: ["preserved"] } },
  projectFingerprint: "fixture", reset: { keeper_id: KEEPER_ID }, keeper: { id: KEEPER_ID, role: "admin", is_active: true },
  users: [KEEPER_ID, "test-user"], profiles: [{ id: KEEPER_ID, role: "admin", is_active: true }, { id: "test-user", role: "participant", is_active: false }],
  counts: { races: 0, season_restore_points: 0 }, hallOfFame: { entries: ["preserved"] }
});

describe("one-time prelaunch Auth removal", () => {
  it("targets only inventoried test accounts and supports a completed rerun", () => {
    const input = fixture();
    expect(planAuthRemoval(input)).toEqual(["test-user"]);
    input.users = [KEEPER_ID];
    input.profiles = input.profiles.slice(0, 1);
    expect(planAuthRemoval(input)).toEqual([]);
  });
  it("refuses a different project or keeper", () => {
    expect(() => planAuthRemoval({ ...fixture(), projectFingerprint: "other" })).toThrow(/different Supabase project/);
    const input = fixture();
    input.inventory.keeperId = "other";
    expect(() => planAuthRemoval(input)).toThrow(/different administrator/);
  });
  it("requires the SQL cleanup and a functioning administrator", () => {
    expect(() => planAuthRemoval({ ...fixture(), reset: null })).toThrow(/SQL cleanup/);
    const input = fixture();
    input.keeper.role = "participant";
    expect(() => planAuthRemoval(input)).toThrow(/administrator/);
  });
  it("refuses new users and accounts that are still active", () => {
    const input = fixture();
    input.users.push("new-user");
    expect(() => planAuthRemoval(input)).toThrow(/New Auth accounts/);
    input.users.pop();
    input.profiles[1].is_active = true;
    expect(() => planAuthRemoval(input)).toThrow(/still active/);
  });
  it("refuses leftover recovery data and changed archives", () => {
    const input = fixture();
    input.counts.season_restore_points = 1;
    expect(() => planAuthRemoval(input)).toThrow(/still contains test data/);
    input.counts.season_restore_points = 0;
    input.hallOfFame.entries = ["changed"];
    expect(() => planAuthRemoval(input)).toThrow(/Archived standings changed/);
  });
});
