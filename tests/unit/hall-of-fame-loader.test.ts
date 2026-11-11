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

const entry = {
  season_id: season.id,
  final_rank: 1,
  team_name: season.champion_team_name,
  total_points: season.champion_total_points,
  race_breakdown: []
};

function clientWithArchiveError(
  failingTable?: "hall_of_fame_seasons" | "hall_of_fame_entries",
  error?: { code: string; message: string }
): AppSupabaseClient {
  return {
    from(table: string) {
      const query = {
        select: () => query,
        order: () => query,
        in: () => query,
        range: async () => table === failingTable
          ? { data: null, error }
          : { data: table === "hall_of_fame_seasons" ? [season] : [entry], error: null }
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

  it("loads available archive entries", async () => {
    await expect(loadHallOfFameSnapshot(clientWithArchiveError())).resolves.toMatchObject({
      migrationReady: true,
      seasons: [{ seasonYear: 2026, entries: [{ finalRank: 1, teamName: "Fixture team" }] }]
    });
  });
});
