import "server-only";

import type { AppSupabaseClient } from "@/lib/supabase/types";
import { loadAllRows } from "@/lib/supabase/paginated-query";

export type HallOfFameEntry = {
  finalRank: number;
  teamName: string;
  totalPoints: number;
};

export type HallOfFameSeason = {
  championTeamName: string;
  championTotalPoints: number;
  entries: HallOfFameEntry[];
  finalizedAt: string;
  participantCount: number;
  raceCount: number;
  seasonId: number;
  seasonYear: number;
};

export type HallOfFameSnapshot = {
  migrationReady: boolean;
  seasons: HallOfFameSeason[];
};

type SeasonRow = {
  champion_team_name: string;
  champion_total_points: number;
  finalized_at: string;
  id: number;
  participant_count: number;
  race_count: number;
  season_year: number;
};

type EntryRow = {
  final_rank: number;
  season_id: number;
  team_name: string;
  total_points: number;
};

export async function loadHallOfFameSnapshot(
  supabase: AppSupabaseClient,
  selectedYear?: number
): Promise<HallOfFameSnapshot> {
  try {
    const seasonRows = await loadAllRows<SeasonRow>("Hall of Fame seasons", (from, to) =>
      supabase
        .from("hall_of_fame_seasons")
        .select(
          "id,season_year,champion_team_name,champion_total_points,participant_count,race_count,finalized_at"
        )
        .order("season_year", { ascending: false })
        .range(from, to)
    );

    if (seasonRows.length === 0) {
      return { migrationReady: true, seasons: [] };
    }

    const selectedSeason = seasonRows.find((season) => season.season_year === selectedYear);
    const seasonIds = selectedSeason ? [selectedSeason.id] : seasonRows.map((season) => season.id);
    const entryRows = await loadAllRows<EntryRow>("Hall of Fame entries", (from, to) =>
      supabase
        .from("hall_of_fame_entries")
        .select("season_id,final_rank,team_name,total_points")
        .in("season_id", seasonIds)
        .order("season_id", { ascending: false })
        .order("final_rank", { ascending: true })
        .order("team_name", { ascending: true })
        .range(from, to)
    );

    const entriesBySeasonId = new Map<number, HallOfFameEntry[]>();
    entryRows.forEach((entry) => {
      const entries = entriesBySeasonId.get(entry.season_id) ?? [];
      entries.push({
        finalRank: entry.final_rank,
        teamName: entry.team_name,
        totalPoints: entry.total_points
      });
      entriesBySeasonId.set(entry.season_id, entries);
    });

    return {
      migrationReady: true,
      seasons: seasonRows.map((season) => ({
        championTeamName: season.champion_team_name,
        championTotalPoints: season.champion_total_points,
        entries: entriesBySeasonId.get(season.id) ?? [],
        finalizedAt: season.finalized_at,
        participantCount: season.participant_count,
        raceCount: season.race_count,
        seasonId: season.id,
        seasonYear: season.season_year
      }))
    };
  } catch (error) {
    const cause = error instanceof Error ? error.cause : undefined;
    if (
      typeof cause === "object" && cause !== null && "code" in cause &&
      (cause.code === "PGRST205" || cause.code === "42P01")
    ) {
      return { migrationReady: false, seasons: [] };
    }

    throw error;
  }
}
