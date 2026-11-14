import { describe, expect, it, vi } from "vitest";
import { loadHallOfFameSnapshot } from "@/lib/hall-of-fame";
import type { AppSupabaseClient } from "@/lib/supabase/types";

vi.mock("server-only", () => ({}));

const season = {
  id: 1,
  season_year: 2026,
  champion_team_name: "Fixture team",
  champion_total_points: 140,
  participant_count: 1,
  race_count: 1,
  finalized_at: "2026-09-30T00:00:00Z"
};

const previousSeason = { ...season, id: 2, season_year: 2025 };
const entry = {
  season_id: season.id,
  final_rank: 1,
  team_name: season.champion_team_name,
  total_points: season.champion_total_points,
  race_breakdown: [{ race_id: 1, points: 140 }]
};

function clientWithArchiveError(
  failingTable?: "hall_of_fame_seasons" | "hall_of_fame_entries",
  error?: { code: string; message: string },
  entryColumns = vi.fn(),
  entrySeasonIds = vi.fn()
): AppSupabaseClient {
  return {
    from(table: string) {
      let seasonIds: number[] = [];
      const query = {
        select: (columns: string) => {
          if (table === "hall_of_fame_entries") entryColumns(columns);
          return query;
        },
        order: () => query,
        in: (_column: string, ids: number[]) => {
          seasonIds = ids;
          entrySeasonIds(ids);
          return query;
        },
        range: async () => table === failingTable
          ? { data: null, error }
          : {
              data: table === "hall_of_fame_seasons"
                ? [season, previousSeason]
                : [entry, { ...entry, season_id: previousSeason.id }].filter(row => seasonIds.includes(row.season_id)),
              error: null
            }
      };
      return query;
    }
  } as unknown as AppSupabaseClient;
}

describe("Hall of Fame archive loading", () => {
  it.each([
    ["hall_of_fame_seasons", "PGRST205"],
    ["hall_of_fame_entries", "42P01"]
  ] as const)("shows setup only for missing archive tables (%s)", async (table, code) => {
    const client = clientWithArchiveError(table, { code, message: "Archive table missing" });
    await expect(loadHallOfFameSnapshot(client)).resolves.toEqual({
      migrationReady: false,
      seasons: []
    });
  });

  it.each([
    { code: "42501", message: "permission denied for table hall_of_fame_entries" },
    { code: "PGRST002", message: "Could not query the database for the schema cache" }
  ])("propagates $code so the page can offer a retry", async (error) => {
    const client = clientWithArchiveError("hall_of_fame_entries", error);
    await expect(loadHallOfFameSnapshot(client)).rejects.toMatchObject({
      message: `Failed to load Hall of Fame entries: ${error.message}`,
      cause: error
    });
  });

  it.each([undefined, 1999])("loads compact summary entries for all seasons for year %s", async (year) => {
    const columns = vi.fn();
    const seasonIds = vi.fn();
    const client = clientWithArchiveError(undefined, undefined, columns, seasonIds);
    const { migrationReady, seasons } = await loadHallOfFameSnapshot(client, year);
    expect(migrationReady).toBe(true);
    expect(columns).toHaveBeenCalledWith("season_id,final_rank,team_name,total_points");
    expect(seasonIds).toHaveBeenCalledWith([1, 2]);
    expect(seasons.map(season => season.entries)).toEqual([
      [{ finalRank: 1, teamName: "Fixture team", totalPoints: 140 }],
      [{ finalRank: 1, teamName: "Fixture team", totalPoints: 140 }]
    ]);
  });

  it("loads only the selected season's entries and keeps all years for navigation", async () => {
    const seasonIds = vi.fn();
    const client = clientWithArchiveError(undefined, undefined, vi.fn(), seasonIds);
    const { seasons } = await loadHallOfFameSnapshot(client, 2025);
    expect(seasonIds).toHaveBeenCalledWith([2]);
    expect(seasons.map(season => [season.seasonYear, season.entries.length])).toEqual([
      [2026, 0], [2025, 1]
    ]);
  });
});
