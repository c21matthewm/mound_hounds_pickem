import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/service-role";
import {
  normalizeRacePickFormat,
  pickGroupCountForFormat,
  type RacePickFormat
} from "@/lib/race-format";
import { isMissingColumnError } from "@/lib/supabase/schema-compat";
import { buildOrderedWeeklyRows } from "@/lib/weekly-ranking";

export const AUTO_WINNER_DELAY_MINUTES = 15;

type PickRow = {
  average_speed: number | string;
  driver_group1_id: number;
  driver_group2_id: number;
  driver_group3_id: number;
  driver_group4_id: number;
  driver_group5_id: number;
  driver_group6_id: number;
  driver_group7_id: number | null;
  driver_group8_id: number | null;
  user_id: string;
};

type DriverRow = {
  group_number: number;
  id: number;
};

type ProfileRow = {
  id: string;
  is_active: boolean;
  team_name: string;
};

type ResultRow = {
  driver_id: number;
  points: number;
};

type RaceWinnerSpeedRow = {
  id: number;
  official_winning_average_speed: number | string | null;
  pick_format: RacePickFormat;
  results_status: "draft" | "published";
};

type RaceDriverGroupRow = {
  driver_id: number;
  group_number: number;
};

type PendingRaceRow = {
  id: number;
};

const toNumber = (value: number | string): number => {
  if (typeof value === "number") {
    return value;
  }

  const parsed = Number(value);
  if (!Number.isNaN(parsed)) {
    return parsed;
  }

  return 0;
};

const withOfficialSpeedMigrationHint = (message: string): string =>
  message.includes("official_winning_average_speed")
    ? `${message}. Run the latest Supabase migration to add official race average speed support.`
    : message;

const pickDriverIdsByGroup = (pick: PickRow): Array<[number, number]> =>
  [
    [pick.driver_group1_id, 1],
    [pick.driver_group2_id, 2],
    [pick.driver_group3_id, 3],
    [pick.driver_group4_id, 4],
    [pick.driver_group5_id, 5],
    [pick.driver_group6_id, 6],
    [pick.driver_group7_id, 7],
    [pick.driver_group8_id, 8]
  ].filter((row): row is [number, number] => row[0] !== null);

const scorePick = (pick: PickRow, groupCount: number, pointsByDriverId: Map<number, number>): number => {
  const selectedDrivers = pickDriverIdsByGroup(pick)
    .filter(([, groupNumber]) => groupNumber <= groupCount)
    .map(([driverId]) => driverId);

  return selectedDrivers.reduce((sum, driverId) => sum + (pointsByDriverId.get(driverId) ?? 0), 0);
};

const buildPickedDriverGroupByDriverId = (picks: PickRow[]): Map<number, number> => {
  const groupByDriverId = new Map<number, number>();

  picks.forEach((pick) => {
    pickDriverIdsByGroup(pick).forEach(([driverId, groupNumber]) => {
      if (!groupByDriverId.has(driverId)) {
        groupByDriverId.set(driverId, groupNumber);
      }
    });
  });

  return groupByDriverId;
};

const resolveRaceDriverGroup = (
  driverId: number,
  raceDriverGroupByDriverId: Map<number, number>,
  pickedDriverGroupByDriverId: Map<number, number>,
  currentDriverGroupById: Map<number, number>
): number | undefined =>
  raceDriverGroupByDriverId.get(driverId) ??
  pickedDriverGroupByDriverId.get(driverId) ??
  currentDriverGroupById.get(driverId);

const computeLowestPossibleScore = (
  groupCount: number,
  results: ResultRow[],
  raceDriverGroupByDriverId: Map<number, number>,
  pickedDriverGroupByDriverId: Map<number, number>,
  currentDriverGroupById: Map<number, number>
): number => {
  const pointsByGroup = new Map<number, number[]>();
  for (let groupNumber = 1; groupNumber <= groupCount; groupNumber += 1) {
    pointsByGroup.set(groupNumber, []);
  }

  results.forEach((result) => {
    const groupNumber = resolveRaceDriverGroup(
      result.driver_id,
      raceDriverGroupByDriverId,
      pickedDriverGroupByDriverId,
      currentDriverGroupById
    );
    if (!groupNumber || groupNumber < 1 || groupNumber > groupCount) {
      return;
    }

    const groupPoints = pointsByGroup.get(groupNumber) ?? [];
    groupPoints.push(toNumber(result.points));
    pointsByGroup.set(groupNumber, groupPoints);
  });

  let lowestPossibleScore = 0;
  for (let groupNumber = 1; groupNumber <= groupCount; groupNumber += 1) {
    const groupPoints = pointsByGroup.get(groupNumber) ?? [];
    if (groupPoints.length > 0) {
      lowestPossibleScore += Math.min(...groupPoints);
    }
  }

  return lowestPossibleScore;
};

export async function scheduleRaceWinnerAutoCalculation(supabase: SupabaseClient, raceId: number) {
  const eligibleAt = new Date(Date.now() + AUTO_WINNER_DELAY_MINUTES * 60_000).toISOString();

  const { data: updatedRace, error } = await supabase
    .from("races")
    .update({
      winner_auto_eligible_at: eligibleAt,
      winner_is_manual_override: false
    })
    .eq("id", raceId)
    .eq("is_archived", false)
    .select("id")
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }
  if (!updatedRace) {
    throw new Error("Cannot schedule winner auto-calculation for an archived race.");
  }
}

export async function calculateRaceWinnerProfileId(
  supabase: SupabaseClient,
  raceId: number
): Promise<string | null> {
  const [picksRes, resultsRes, raceRes, profilesRes, driversRes, raceDriverGroupsRes] = await Promise.all([
    supabase
      .from("picks")
      .select(
        "user_id,average_speed,driver_group1_id,driver_group2_id,driver_group3_id,driver_group4_id,driver_group5_id,driver_group6_id,driver_group7_id,driver_group8_id"
      )
      .eq("race_id", raceId),
    supabase.from("results").select("driver_id,points").eq("race_id", raceId),
    supabase
      .from("races")
      .select("id,pick_format,official_winning_average_speed,results_status")
      .eq("id", raceId)
      .maybeSingle(),
    supabase
      .from("profiles")
      .select("id,team_name,is_active")
      .in("role", ["participant", "admin"])
      .eq("is_active", true)
      .order("team_name", { ascending: true }),
    supabase.from("drivers").select("id,group_number"),
    supabase
      .from("race_driver_groups")
      .select("driver_id,group_number")
      .eq("race_id", raceId)
  ]);

  let picksData = (picksRes.data ?? null) as PickRow[] | null;
  let picksError = picksRes.error;
  let raceData = (raceRes.data ?? null) as RaceWinnerSpeedRow | null;
  let raceError = raceRes.error;

  if (picksError) {
    if (
      isMissingColumnError(picksError, "driver_group7_id") ||
      isMissingColumnError(picksError, "driver_group8_id")
    ) {
      const legacyPicksRes = await supabase
        .from("picks")
        .select(
          "user_id,average_speed,driver_group1_id,driver_group2_id,driver_group3_id,driver_group4_id,driver_group5_id,driver_group6_id"
        )
        .eq("race_id", raceId);

      picksData = (legacyPicksRes.data ?? []).map((pick) => ({
          ...pick,
          driver_group7_id: null,
          driver_group8_id: null
        })) as PickRow[];
      picksError = legacyPicksRes.error;
    }
  }
  if (raceError && isMissingColumnError(raceError, "pick_format")) {
    const legacyRaceRes = await supabase
      .from("races")
      .select("id,official_winning_average_speed")
      .eq("id", raceId)
      .maybeSingle();

    raceData = legacyRaceRes.data
      ? ({
          ...legacyRaceRes.data,
          pick_format: "standard" as const,
          results_status: "published" as const
        } as RaceWinnerSpeedRow)
      : null;
    raceError = legacyRaceRes.error;
  }
  if (picksError) {
    throw new Error(picksError.message);
  }
  if (resultsRes.error) {
    throw new Error(resultsRes.error.message);
  }
  if (raceError) {
    throw new Error(withOfficialSpeedMigrationHint(raceError.message));
  }
  if (profilesRes.error) {
    throw new Error(profilesRes.error.message);
  }
  if (driversRes.error) {
    throw new Error(driversRes.error.message);
  }
  if (raceDriverGroupsRes.error) {
    throw new Error(raceDriverGroupsRes.error.message);
  }

  const picks = picksData ?? [];
  const results = (resultsRes.data ?? []) as ResultRow[];
  const race = raceData;
  if (!race) {
    throw new Error("Selected race was not found.");
  }
  if (race.results_status !== "published") {
    throw new Error("Publish the complete race results before calculating a fantasy winner.");
  }
  if (results.length === 0) {
    return null;
  }

  const participants = ((profilesRes.data ?? []) as ProfileRow[])
    .filter((profile) => typeof profile.team_name === "string" && profile.team_name.trim().length > 0)
    .map((profile) => ({
      id: profile.id,
      teamName: profile.team_name.trim()
    }));
  if (participants.length === 0) {
    return null;
  }

  const pointsByDriverId = new Map<number, number>();
  results.forEach((row) => {
    pointsByDriverId.set(row.driver_id, toNumber(row.points));
  });

  const officialWinningAverageSpeed =
    race.official_winning_average_speed === null || race.official_winning_average_speed === undefined
      ? null
      : toNumber(race.official_winning_average_speed);
  const groupCount = pickGroupCountForFormat(normalizeRacePickFormat(race.pick_format));
  const currentDriverGroupById = new Map<number, number>();
  ((driversRes.data ?? []) as DriverRow[]).forEach((driver) => {
    currentDriverGroupById.set(driver.id, driver.group_number);
  });
  const raceDriverGroupByDriverId = new Map<number, number>();
  ((raceDriverGroupsRes.data ?? []) as RaceDriverGroupRow[]).forEach((row) => {
    raceDriverGroupByDriverId.set(row.driver_id, row.group_number);
  });
  const pickedDriverGroupByDriverId = buildPickedDriverGroupByDriverId(picks);
  const lowestPossibleScore = computeLowestPossibleScore(
    groupCount,
    results,
    raceDriverGroupByDriverId,
    pickedDriverGroupByDriverId,
    currentDriverGroupById
  );
  const pickByUserId = new Map<string, PickRow>();
  picks.forEach((pick) => {
    pickByUserId.set(pick.user_id, pick);
  });

  const ranked = buildOrderedWeeklyRows(
    participants.map((participant) => {
      const pick = pickByUserId.get(participant.id);
      return {
        averageSpeed: pick ? toNumber(pick.average_speed) : null,
        points: pick ? scorePick(pick, groupCount, pointsByDriverId) : lowestPossibleScore,
        teamName: participant.teamName,
        userId: participant.id
      };
    }),
    officialWinningAverageSpeed
  );

  return ranked[0]?.userId ?? null;
}

export async function finalizeRaceWinnerNow(
  supabase: SupabaseClient,
  raceId: number
): Promise<string | null> {
  const winnerProfileId = await calculateRaceWinnerProfileId(supabase, raceId);
  const winnerSetAt = winnerProfileId ? new Date().toISOString() : null;

  const { data: updatedRace, error } = await supabase
    .from("races")
    .update({
      winner_auto_eligible_at: null,
      winner_is_manual_override: false,
      winner_profile_id: winnerProfileId,
      winner_set_at: winnerSetAt,
      winner_source: "auto"
    })
    .eq("id", raceId)
    .eq("is_archived", false)
    .eq("results_status", "published")
    .select("id")
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }
  if (!updatedRace) {
    throw new Error("Cannot finalize winner for an archived race.");
  }

  return winnerProfileId;
}

export async function finalizeDueRaceWinners(): Promise<{
  processedRaceCount: number;
  updatedRaceCount: number;
}> {
  const supabase = createServiceRoleSupabaseClient();
  const nowIso = new Date().toISOString();

  const { data: races, error: racesError } = await supabase
    .from("races")
    .select("id")
    .eq("is_archived", false)
    .eq("winner_is_manual_override", false)
    .not("winner_auto_eligible_at", "is", null)
    .lte("winner_auto_eligible_at", nowIso)
    .order("winner_auto_eligible_at", { ascending: true })
    .limit(100);

  if (racesError) {
    throw new Error(racesError.message);
  }

  const pendingRaces = (races ?? []) as PendingRaceRow[];
  for (const race of pendingRaces) {
    await finalizeRaceWinnerNow(supabase, race.id);
  }

  return {
    processedRaceCount: pendingRaces.length,
    updatedRaceCount: pendingRaces.length
  };
}
