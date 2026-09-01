import "server-only";

import type { AppSupabaseClient } from "@/lib/supabase/types";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/service-role";
import type { RacePickFormat } from "@/lib/race-format";
import { buildRaceScoringProjection } from "@/lib/race-scoring-model";

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
  team_name: string;
};

type SeasonParticipantRow = {
  profile_id: string;
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
  season_id: number;
};

type RaceDriverGroupRow = {
  driver_id: number;
  group_number: number;
};

type PendingRaceRow = {
  id: number;
};

const withOfficialSpeedMigrationHint = (message: string): string =>
  message.includes("official_winning_average_speed")
    ? `${message}. Run the latest Supabase migration to add official race average speed support.`
    : message;

export async function scheduleRaceWinnerAutoCalculation(supabase: AppSupabaseClient, raceId: number) {
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
  supabase: AppSupabaseClient,
  raceId: number
): Promise<string | null> {
  const { data: race, error: raceError } = await supabase
    .from("races")
    .select("id,season_id,pick_format,official_winning_average_speed,results_status")
    .eq("id", raceId)
    .maybeSingle<RaceWinnerSpeedRow>();

  if (raceError) {
    throw new Error(withOfficialSpeedMigrationHint(raceError.message));
  }
  if (!race) {
    throw new Error("Selected race was not found.");
  }
  if (race.results_status !== "published") {
    throw new Error("Publish the complete race results before calculating a fantasy winner.");
  }

  const [picksRes, resultsRes, participantRes, driversRes, raceDriverGroupsRes] = await Promise.all([
    supabase
      .from("picks")
      .select(
        "user_id,average_speed,driver_group1_id,driver_group2_id,driver_group3_id,driver_group4_id,driver_group5_id,driver_group6_id,driver_group7_id,driver_group8_id"
      )
      .eq("race_id", raceId),
    supabase.from("results").select("driver_id,points").eq("race_id", raceId),
    supabase
      .from("season_participants")
      .select("profile_id")
      .eq("season_id", race.season_id)
      .eq("status", "registered"),
    supabase.from("drivers").select("id,group_number"),
    supabase
      .from("race_driver_groups")
      .select("driver_id,group_number")
      .eq("race_id", raceId)
  ]);

  if (picksRes.error) {
    throw new Error(picksRes.error.message);
  }
  if (resultsRes.error) {
    throw new Error(resultsRes.error.message);
  }
  if (participantRes.error) {
    throw new Error(participantRes.error.message);
  }
  if (driversRes.error) {
    throw new Error(driversRes.error.message);
  }
  if (raceDriverGroupsRes.error) {
    throw new Error(raceDriverGroupsRes.error.message);
  }

  const picks = (picksRes.data ?? []) as PickRow[];
  const results = (resultsRes.data ?? []) as ResultRow[];
  if (results.length === 0) {
    return null;
  }

  const registeredProfileIds = ((participantRes.data ?? []) as SeasonParticipantRow[]).map(
    (row) => row.profile_id
  );
  if (registeredProfileIds.length === 0) {
    return null;
  }

  const { data: profileData, error: profilesError } = await supabase
    .from("profiles")
    .select("id,team_name")
    .in("id", registeredProfileIds)
    .eq("is_active", true)
    .order("team_name", { ascending: true });

  if (profilesError) {
    throw new Error(profilesError.message);
  }

  const participants = ((profileData ?? []) as ProfileRow[])
    .filter((profile) => typeof profile.team_name === "string" && profile.team_name.trim().length > 0)
    .map((profile) => ({
      id: profile.id,
      teamName: profile.team_name.trim()
    }));
  if (participants.length === 0) {
    return null;
  }

  return buildRaceScoringProjection({
    currentDrivers: (driversRes.data ?? []) as DriverRow[],
    officialWinningAverageSpeed: race.official_winning_average_speed,
    participants,
    pickFormat: race.pick_format,
    picks,
    raceDriverGroups: (raceDriverGroupsRes.data ?? []) as RaceDriverGroupRow[],
    results
  }).winnerUserId;
}

export async function finalizeRaceWinnerNow(
  supabase: AppSupabaseClient,
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
  failedRaceCount: number;
  failures: Array<{ message: string; raceId: number }>;
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
  const failures: Array<{ message: string; raceId: number }> = [];
  let updatedRaceCount = 0;
  for (const race of pendingRaces) {
    try {
      await finalizeRaceWinnerNow(supabase, race.id);
      updatedRaceCount += 1;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown fantasy winner finalization error.";
      failures.push({ message, raceId: race.id });
      console.error(`[fantasy-winner] Race ${race.id} failed:`, message);
    }
  }

  return {
    failedRaceCount: failures.length,
    failures,
    processedRaceCount: pendingRaces.length,
    updatedRaceCount
  };
}
