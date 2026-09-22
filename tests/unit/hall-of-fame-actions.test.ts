import { beforeEach, describe, expect, it, vi } from "vitest";
import { finalizeHallOfFameSeasonAction } from "@/app/admin/hall-of-fame-actions";
import type { LeagueScoringSnapshot } from "@/lib/season-scoring-model";

const mocks = vi.hoisted(() => ({
  snapshot: vi.fn(),
  backup: vi.fn(),
  rpc: vi.fn(),
  audit: vi.fn(),
  revalidatePath: vi.fn(),
  redirect: vi.fn()
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/admin-audit", () => ({ recordAdminAudit: mocks.audit }));
vi.mock("@/lib/scoring", () => ({ buildLeagueScoringSnapshotUncached: mocks.snapshot }));
vi.mock("@/lib/admin", () => ({
  requireAdmin: async () => ({
    user: { id: "test-admin" },
    supabase: {
      rpc: mocks.rpc,
      from: () => {
        const query = {
          select: () => query,
          eq: () => query,
          maybeSingle: async () => ({ data: { id: 27, season_year: 2027, status: "active" }, error: null }),
          order: async () => ({
            data: [1, 2, 3].map((id) => ({
              id, race_name: `Race ${id}`, race_date: "2020-01-01T00:00:00Z", results_status: "published", round_number: id
            })),
            error: null
          })
        };
        return query;
      }
    }
  })
}));
vi.mock("@/app/admin/action-runtime", () => ({
  HALL_OF_FAME_MIGRATION_FILE: "hall-of-fame.sql",
  LEAGUE_SEASONS_MIGRATION_FILE: "league-seasons.sql",
  adminMutationRedirect: mocks.redirect,
  asText: (value: unknown) => typeof value === "string" ? value : "",
  createSeasonSafetySnapshot: mocks.backup,
  parseAdminTab: () => "results",
  parsePositiveInteger: (value: string) => Number(value),
  reportAdminActionFailure: async () => { throw new Error("Unexpected admin action failure"); }
}));

const snapshot = (ranks: number[]): LeagueScoringSnapshot => ({
  leaderboardRows: ranks.map((currentStanding, index) => ({
    currentStanding,
    teamName: `Team ${index + 1}`,
    displayName: `Team ${index + 1}`,
    userId: `user-${index + 1}`,
    change: 0,
    totalPoints: 100,
    raceBreakdown: { 1: 40, 2: 40, 3: 20 }
  })),
  raceColumns: [1, 2, 3].map((raceId) => ({
    raceId, raceDate: "2020-01-01T00:00:00Z", raceName: `Race ${raceId}`, roundNumber: raceId
  }))
});
const form = () => {
  const data = new FormData();
  data.set("season_id", "27");
  data.set("tab", "results");
  return data;
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.rpc.mockResolvedValue({ data: 1, error: null });
  mocks.redirect.mockImplementation((key, value) => { throw new Error(`${key}: ${value}`); });
});

describe("season champion finalization", () => {
  it("stops an unresolved championship before creating a backup or writing an archive", async () => {
    mocks.snapshot.mockResolvedValue(snapshot([1, 1, 3]));
    await expect(finalizeHallOfFameSeasonAction(form())).rejects.toThrow("Finalization is paused until the league resolves the tie");
    expect(mocks.backup).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("refuses a snapshot without a first-place team", async () => {
    mocks.snapshot.mockResolvedValue(snapshot([2, 3]));
    await expect(finalizeHallOfFameSeasonAction(form())).rejects.toThrow("A single season champion has not been determined");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it.each([[[1, 2, 3]], [[1, 2, 2]]])("archives the computed ranks with exactly one champion (%j)", async (ranks) => {
    const calculated = snapshot(ranks);
    mocks.snapshot.mockResolvedValue(calculated);
    await expect(finalizeHallOfFameSeasonAction(form())).rejects.toThrow("message: 2027 final standings saved");
    expect(mocks.backup).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("finalize_hall_of_fame_season", {
      p_season_year: 2027,
      p_race_count: 3,
      p_entries: calculated.leaderboardRows.map((row) => ({
        final_rank: row.currentStanding,
        team_name: row.teamName,
        total_points: row.totalPoints,
        race_breakdown: calculated.raceColumns.map((race) => ({
          points: row.raceBreakdown[race.raceId], race_id: race.raceId, race_date: race.raceDate,
          race_name: race.raceName, round_number: race.roundNumber
        }))
      }))
    });
    expect(mocks.backup.mock.invocationCallOrder[0]).toBeLessThan(mocks.rpc.mock.invocationCallOrder[0]);
    expect(mocks.audit).toHaveBeenCalledTimes(1);
  });
});
