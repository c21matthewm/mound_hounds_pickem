import "server-only";

import type { AppSupabaseClient } from "@/lib/supabase/types";
import type {
  DriverRow,
  PickSummaryRow,
  RaceDriverGroupRow,
  RaceRow,
  ResultRow,
  ScoringAudit,
  WinnerProfileRow
} from "@/app/admin/admin-types";
import {
  parseAdminWorkspaceTab,
  type AdminWorkspaceTab
} from "@/lib/admin-tabs";
import { buildRaceScoringProjection } from "@/lib/race-scoring-model";
import { normalizeRacePickFormat } from "@/lib/race-format";
import { scoringNumber } from "@/lib/scoring-engine";
import { loadAllRows } from "@/lib/supabase/paginated-query";
import {
  formatLeagueDateTime,
  formatLeagueDateTimeLocalInput
} from "@/lib/timezone";
import { calculateOfficialSpeedDelta } from "@/lib/weekly-ranking";

export const formatDateTime = (value: string): string =>
  formatLeagueDateTime(value, { dateStyle: "medium", timeStyle: "short" });

export const formatDateTimeLocalInput = (value: string): string =>
  formatLeagueDateTimeLocalInput(value);

export const parseAdminTab = (value: string | undefined): AdminWorkspaceTab =>
  parseAdminWorkspaceTab(value);

export const parsePositiveQueryInteger = (value: string | undefined): number | null => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

export const formatOptionalDecimal = (value: number | null, digits = 3): string =>
  value === null ? "-" : value.toFixed(digits);

export const ADMIN_RACE_FIELDS =
  "id,race_name,pick_format,pick_window_key,title_image_url,qualifying_start_at,race_date,payout,official_winning_average_speed,results_status,results_published_at,is_archived,archived_at,winner_profile_id,winner_source,winner_is_manual_override,winner_auto_eligible_at,winner_set_at,season_id,round_number,field_frozen_at";

export const loadAdminRaces = async (supabase: AppSupabaseClient, seasonId: number) =>
  supabase
    .from("races")
    .select(ADMIN_RACE_FIELDS)
    .eq("season_id", seasonId)
    .order("race_date", { ascending: false });

export const loadAdminFeedback = (
  supabase: AppSupabaseClient,
  status: string,
  page: number,
  pageSize: number
) => {
  let query = supabase
    .from("feedback_items")
    .select(
      "id,user_id,feedback_type,category,details,status,resolved_at,created_at",
      { count: "exact" }
    )
    .order("created_at", { ascending: false })
    .order("id", { ascending: false });

  if (status !== "all") {
    query = query.eq("status", status);
  }

  const from = (page - 1) * pageSize;
  return query.range(from, from + pageSize - 1);
};

export const loadAdminResultRaces = async (
  supabase: AppSupabaseClient,
  seasonId: number
) =>
  supabase
    .from("races")
    .select(ADMIN_RACE_FIELDS)
    .eq("season_id", seasonId)
    .eq("is_archived", false)
    .order("round_number", { ascending: true })
    .order("id", { ascending: true });

export const paginatedAdminLoad = async <T,>(
  label: string,
  loadPage: Parameters<typeof loadAllRows<T>>[1]
): Promise<{ data: T[] | null; error: { message: string } | null }> => {
  try {
    return { data: await loadAllRows<T>(label, loadPage), error: null };
  } catch (error) {
    return {
      data: null,
      error: { message: error instanceof Error ? error.message : `Failed to load ${label}.` }
    };
  }
};

export const loadRaceDriverGroups = async (supabase: AppSupabaseClient, raceIds: number[]) =>
  paginatedAdminLoad<RaceDriverGroupRow>("race driver groups", (from, to) =>
    supabase
      .from("race_driver_groups")
      .select("race_id,driver_id,group_number,qualifying_position")
      .in("race_id", raceIds)
      .order("race_id", { ascending: true })
      .order("driver_id", { ascending: true })
      .range(from, to)
  );

export const loadAdminPicks = async (supabase: AppSupabaseClient, raceIds: number[]) =>
  paginatedAdminLoad<PickSummaryRow>("admin picks", (from, to) =>
    supabase
      .from("picks")
      .select(
        "user_id,race_id,average_speed,driver_group1_id,driver_group2_id,driver_group3_id,driver_group4_id,driver_group5_id,driver_group6_id,driver_group7_id,driver_group8_id"
      )
      .in("race_id", raceIds)
      .order("race_id", { ascending: true })
      .order("user_id", { ascending: true })
      .range(from, to)
  );

export const buildScoringAudits = ({
  drivers,
  participants,
  picks,
  raceDriverGroups,
  races,
  results
}: {
  drivers: DriverRow[];
  participants: WinnerProfileRow[];
  picks: PickSummaryRow[];
  raceDriverGroups: RaceDriverGroupRow[];
  races: RaceRow[];
  results: ResultRow[];
}): ScoringAudit[] => {
  const driverNameById = new Map(drivers.map((driver) => [driver.id, driver.driver_name]));
  const resultsByRaceId = new Map<number, ResultRow[]>();
  results.forEach((result) => {
    const raceResults = resultsByRaceId.get(result.race_id) ?? [];
    raceResults.push(result);
    resultsByRaceId.set(result.race_id, raceResults);
  });
  const picksByRaceId = new Map<number, PickSummaryRow[]>();
  picks.forEach((pick) => {
    const racePicks = picksByRaceId.get(pick.race_id) ?? [];
    racePicks.push(pick);
    picksByRaceId.set(pick.race_id, racePicks);
  });
  const groupsByRaceId = new Map<number, RaceDriverGroupRow[]>();
  raceDriverGroups.forEach((group) => {
    const raceGroups = groupsByRaceId.get(group.race_id) ?? [];
    raceGroups.push(group);
    groupsByRaceId.set(group.race_id, raceGroups);
  });
  const scoringParticipants = participants.map((participant) => ({
    id: participant.id,
    teamName: participant.team_name
  }));

  return races
    .flatMap((race) => {
      const raceResults = resultsByRaceId.get(race.id) ?? [];
      if (raceResults.length === 0) {
        return [];
      }

      const pickFormat = normalizeRacePickFormat(race.pick_format);
      const officialWinningAverageSpeed =
        race.official_winning_average_speed === null
          ? null
          : scoringNumber(race.official_winning_average_speed);
      const projection = buildRaceScoringProjection({
        currentDrivers: drivers,
        officialWinningAverageSpeed,
        participants: scoringParticipants,
        pickFormat,
        picks: picksByRaceId.get(race.id) ?? [],
        raceDriverGroups: groupsByRaceId.get(race.id) ?? [],
        results: raceResults
      });
      const submittedPickCount = projection.rows.filter((row) => row.submittedPick).length;

      return [
        {
          groupCount: projection.groupCount,
          highestPossibleScore: projection.highestPossibleScore,
          lowestPossibleScore: projection.lowestPossibleScore,
          noPickCount: Math.max(0, participants.length - submittedPickCount),
          officialWinningAverageSpeed,
          pickFormat,
          raceDate: race.race_date,
          raceId: race.id,
          raceName: race.race_name,
          resultCount: raceResults.length,
          resultsStatus: race.results_status,
          rows: projection.rows.map((row) => ({
            averageSpeed: row.averageSpeed,
            driverCells: row.driverIds.map((driverId, index) => ({
              driverName:
                driverId === null
                  ? null
                  : (driverNameById.get(driverId) ?? `Driver #${driverId}`),
              groupNumber: index + 1,
              points: row.driverPoints[index] ?? null
            })),
            points: row.points,
            rank: row.rank,
            submittedPick: row.submittedPick,
            teamName: row.teamName,
            tiebreakDelta: calculateOfficialSpeedDelta(row.averageSpeed, officialWinningAverageSpeed),
            userId: row.userId
          })),
          submittedPickCount,
          winnerTeamName: projection.rows[0]?.teamName ?? null
        }
      ];
    })
    .sort((a, b) => new Date(b.raceDate).getTime() - new Date(a.raceDate).getTime());
};
