import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/service-role";
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
  user_id: string;
};

type ProfileRow = {
  id: string;
  team_name: string;
};

type ResultRow = {
  driver_id: number;
  points: number;
};

type RaceWinnerSpeedRow = {
  id: number;
  official_winning_average_speed: number | string | null;
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

const scorePick = (pick: PickRow, pointsByDriverId: Map<number, number>): number => {
  const selectedDrivers = [
    pick.driver_group1_id,
    pick.driver_group2_id,
    pick.driver_group3_id,
    pick.driver_group4_id,
    pick.driver_group5_id,
    pick.driver_group6_id
  ];

  return selectedDrivers.reduce((sum, driverId) => sum + (pointsByDriverId.get(driverId) ?? 0), 0);
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
  const [picksRes, resultsRes, raceRes] = await Promise.all([
    supabase
      .from("picks")
      .select(
        "user_id,average_speed,driver_group1_id,driver_group2_id,driver_group3_id,driver_group4_id,driver_group5_id,driver_group6_id"
      )
      .eq("race_id", raceId),
    supabase.from("results").select("driver_id,points").eq("race_id", raceId),
    supabase.from("races").select("id,official_winning_average_speed").eq("id", raceId).maybeSingle()
  ]);

  if (picksRes.error) {
    throw new Error(picksRes.error.message);
  }
  if (resultsRes.error) {
    throw new Error(resultsRes.error.message);
  }
  if (raceRes.error) {
    throw new Error(withOfficialSpeedMigrationHint(raceRes.error.message));
  }

  const picks = (picksRes.data ?? []) as PickRow[];
  const results = (resultsRes.data ?? []) as ResultRow[];
  const race = raceRes.data as RaceWinnerSpeedRow | null;
  if (picks.length === 0) {
    return null;
  }

  const pointsByDriverId = new Map<number, number>();
  results.forEach((row) => {
    pointsByDriverId.set(row.driver_id, toNumber(row.points));
  });

  const userIds = Array.from(new Set(picks.map((pick) => pick.user_id)));
  const { data: profiles, error: profilesError } = await supabase
    .from("profiles")
    .select("id,team_name")
    .in("id", userIds);

  if (profilesError) {
    throw new Error(profilesError.message);
  }

  const teamNameByUserId = new Map<string, string>();
  ((profiles ?? []) as ProfileRow[]).forEach((profile) => {
    teamNameByUserId.set(profile.id, profile.team_name);
  });

  const officialWinningAverageSpeed =
    race?.official_winning_average_speed === null || race?.official_winning_average_speed === undefined
      ? null
      : toNumber(race.official_winning_average_speed);

  const ranked = buildOrderedWeeklyRows(
    picks.map((pick) => ({
      averageSpeed: toNumber(pick.average_speed),
      points: scorePick(pick, pointsByDriverId),
      teamName: teamNameByUserId.get(pick.user_id) ?? `Team-${pick.user_id.slice(0, 8)}`,
      userId: pick.user_id
    })),
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
