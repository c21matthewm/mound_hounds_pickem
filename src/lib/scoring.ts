import "server-only";

import { unstable_cache } from "next/cache";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/service-role";
import {
  normalizeRacePickFormat,
  pickGroupCountForFormat,
  pickLockAtForRace,
  type RacePickFormat
} from "@/lib/race-format";
import { participantLeaderboardLabel } from "@/lib/participant-display";
import {
  buildRaceScoringProjection,
  type RaceScoringRow
} from "@/lib/race-scoring-model";
import { pickDriverIdsForGroupCount, scoringNumber as asNumber } from "@/lib/scoring-engine";
import {
  buildSeasonScoringModel,
  type LeagueScoringSnapshot,
  type ParticipantAnalyticsSnapshot,
  type SeasonScoringModel
} from "@/lib/season-scoring-model";
import { loadAllRows } from "@/lib/supabase/paginated-query";
import { SCORING_CACHE_TAG } from "@/lib/scoring-cache";
import type { Tables } from "@/lib/supabase/database.types";
import type { AppSupabaseClient } from "@/lib/supabase/types";

export type {
  LeaderboardRow,
  LeagueScoringSnapshot,
  ParticipantAnalyticsRaceRow,
  ParticipantAnalyticsSnapshot,
  ParticipantAnalyticsSummary,
  RaceBreakdownColumn
} from "@/lib/season-scoring-model";

type DriverRow = Pick<Tables<"drivers">, "group_number" | "id">;

type DriverNameRow = Pick<
  Tables<"drivers">,
  "driver_name" | "group_number" | "id"
>;

type PickRow = Pick<
  Tables<"picks">,
  | "average_speed"
  | "driver_group1_id"
  | "driver_group2_id"
  | "driver_group3_id"
  | "driver_group4_id"
  | "driver_group5_id"
  | "driver_group6_id"
  | "driver_group7_id"
  | "driver_group8_id"
  | "race_id"
  | "user_id"
>;

type ProfileRow = Pick<
  Tables<"profiles">,
  "full_name" | "id" | "is_active" | "team_name"
>;

type SeasonParticipantRow = Pick<Tables<"season_participants">, "profile_id">;

type RaceDatabaseRow = Pick<
  Tables<"races">,
  | "id"
  | "official_winning_average_speed"
  | "pick_format"
  | "race_date"
  | "race_name"
  | "results_status"
  | "round_number"
  | "season_id"
>;

type RaceRow = Omit<RaceDatabaseRow, "pick_format" | "results_status"> & {
  pick_format: RacePickFormat;
  results_status: "draft" | "published";
};

const toRaceRow = (race: RaceDatabaseRow): RaceRow => ({
  ...race,
  pick_format: normalizeRacePickFormat(race.pick_format),
  results_status: race.results_status === "published" ? "published" : "draft"
});

type ResultRow = Pick<Tables<"results">, "driver_id" | "points" | "race_id">;

type RaceDriverGroupRow = Pick<
  Tables<"race_driver_groups">,
  "driver_id" | "group_number" | "race_id"
>;

type Participant = {
  displayName: string;
  id: string;
  teamName: string;
};

const loadRegisteredProfiles = async (
  supabase: AppSupabaseClient,
  seasonId: number
): Promise<ProfileRow[]> => {
  const registrations = await loadAllRows<SeasonParticipantRow>(
    "season participant registrations",
    (from, to) =>
      supabase
        .from("season_participants")
        .select("profile_id")
        .eq("season_id", seasonId)
        .eq("status", "registered")
        .order("profile_id", { ascending: true })
        .range(from, to)
  );
  const profileIds = registrations.map((registration) => registration.profile_id);
  if (profileIds.length === 0) {
    return [];
  }

  return loadAllRows<ProfileRow>("registered profiles", (from, to) =>
    supabase
      .from("profiles")
      .select("id,team_name,full_name,is_active")
      .in("id", profileIds)
      .eq("is_active", true)
      .order("team_name", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to)
  );
};

export type PicksByRaceOption = {
  groupCount: number;
  officialWinningAverageSpeed: number | null;
  pickFormat: RacePickFormat;
  raceDate: string;
  raceId: number;
  raceName: string;
  roundNumber: number;
  resultsStatus: "draft" | "published";
  qualifyingStartAt: string;
};

export type PicksByRaceDriverCell = {
  driverName: string | null;
  groupNumber: number;
  points: number | null;
};

export type PicksByRaceParticipantRow = {
  averageSpeed: number | null;
  displayName: string;
  driverCells: PicksByRaceDriverCell[];
  rank: number | null;
  teamName: string;
  totalPoints: number | null;
  userId: string;
};

export type PicksByRaceSnapshot = {
  availableRaces: PicksByRaceOption[];
  resultsPosted: boolean;
  rows: PicksByRaceParticipantRow[];
  selectedRace: PicksByRaceOption | null;
};

const loadSeasonScoringModelUncached = async (
  seasonId: number
): Promise<SeasonScoringModel> => {
  const supabase = createServiceRoleSupabaseClient();

  const [profiles, raceDatabaseRows, drivers] = await Promise.all([
    loadRegisteredProfiles(supabase, seasonId),
    loadAllRows<RaceDatabaseRow>("published races", (from, to) =>
      supabase
        .from("races")
        .select(
          "id,race_name,pick_format,race_date,official_winning_average_speed,results_status,season_id,round_number"
        )
        .eq("is_archived", false)
        .eq("results_status", "published")
        .eq("season_id", seasonId)
        .order("round_number", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to)
    ),
    loadAllRows<DriverRow>("drivers", (from, to) =>
      supabase
        .from("drivers")
        .select("id,group_number")
        .order("id", { ascending: true })
        .range(from, to)
    )
  ]);
  const races = raceDatabaseRows.map(toRaceRow);

  const publishedRaceIds = races.map((race) => race.id);
  const [picks, results, raceDriverGroups]: [PickRow[], ResultRow[], RaceDriverGroupRow[]] =
    publishedRaceIds.length === 0
      ? [[], [], []]
      : await Promise.all([
      loadAllRows<PickRow>("picks", (from, to) =>
        supabase
          .from("picks")
          .select(
            "user_id,race_id,average_speed,driver_group1_id,driver_group2_id,driver_group3_id,driver_group4_id,driver_group5_id,driver_group6_id,driver_group7_id,driver_group8_id"
          )
          .in("race_id", publishedRaceIds)
          .order("race_id", { ascending: true })
          .order("user_id", { ascending: true })
          .range(from, to)
      ),
      loadAllRows<ResultRow>("race results", (from, to) =>
        supabase
          .from("results")
          .select("race_id,driver_id,points")
          .in("race_id", publishedRaceIds)
          .order("race_id", { ascending: true })
          .order("driver_id", { ascending: true })
          .range(from, to)
      ),
      loadAllRows<RaceDriverGroupRow>("race driver groups", (from, to) =>
        supabase
          .from("race_driver_groups")
          .select("race_id,driver_id,group_number")
          .in("race_id", publishedRaceIds)
          .order("race_id", { ascending: true })
          .order("driver_id", { ascending: true })
          .range(from, to)
      )
    ]);

  const participants: Participant[] = profiles
    .filter((profile) => typeof profile.team_name === "string" && profile.team_name.trim().length > 0)
    .map((profile) => ({
      displayName: participantLeaderboardLabel(profile.full_name, profile.team_name.trim()),
      id: profile.id,
      teamName: profile.team_name.trim()
    }));

  return buildSeasonScoringModel({
    drivers,
    participants,
    picks,
    raceDriverGroups,
    races,
    results
  });
};

const buildCachedSeasonScoringModel = unstable_cache(
  loadSeasonScoringModelUncached,
  ["season-scoring-model-v2"],
  { revalidate: 3600, tags: [SCORING_CACHE_TAG] }
);

export const buildSeasonScoringSnapshot = (
  seasonId: number
): Promise<SeasonScoringModel> => buildCachedSeasonScoringModel(seasonId);

export async function buildLeagueScoringSnapshotUncached(
  seasonId: number
): Promise<LeagueScoringSnapshot> {
  return (await loadSeasonScoringModelUncached(seasonId)).leaderboardSnapshot;
}

export const buildLeagueScoringSnapshot = (
  seasonId: number
): Promise<LeagueScoringSnapshot> =>
  buildSeasonScoringSnapshot(seasonId).then((model) => model.leaderboardSnapshot);

async function buildPicksByRaceSnapshotUncached(
  seasonId: number,
  selectedRaceIdInput?: number
): Promise<PicksByRaceSnapshot> {
  const supabase = createServiceRoleSupabaseClient();
  const nowIso = new Date().toISOString();

  const [profiles, seasonRaceDatabaseRows, drivers] = await Promise.all([
    loadRegisteredProfiles(supabase, seasonId),
    loadAllRows<RaceDatabaseRow & Pick<Tables<"races">, "qualifying_start_at">>(
      "locked season races",
      (from, to) =>
        supabase
          .from("races")
          .select(
            "id,race_name,pick_format,race_date,qualifying_start_at,official_winning_average_speed,results_status,season_id,round_number"
          )
          .eq("is_archived", false)
          .eq("season_id", seasonId)
          .lte("qualifying_start_at", nowIso)
          .order("round_number", { ascending: false })
          .order("id", { ascending: false })
          .range(from, to)
    ),
    loadAllRows<DriverNameRow>("drivers", (from, to) =>
      supabase
        .from("drivers")
        .select("id,driver_name,group_number")
        .order("id", { ascending: true })
        .range(from, to)
    )
  ]);

  const raceRows = seasonRaceDatabaseRows.map((race) => ({
    ...toRaceRow(race),
    qualifying_start_at: race.qualifying_start_at
  }));

  const participants: Participant[] = profiles
    .filter((profile) => typeof profile.team_name === "string" && profile.team_name.trim().length > 0)
    .map((profile) => ({
      displayName: participantLeaderboardLabel(profile.full_name, profile.team_name.trim()),
      id: profile.id,
      teamName: profile.team_name.trim()
    }));

  const lockedRaceRows = raceRows.filter((race) => Date.parse(pickLockAtForRace(race)) <= Date.now());
  const availableRaces: PicksByRaceOption[] = lockedRaceRows.map((race) => {
    const pickFormat = normalizeRacePickFormat(race.pick_format);
    return {
      groupCount: pickGroupCountForFormat(pickFormat),
      officialWinningAverageSpeed:
        race.official_winning_average_speed === null
          ? null
          : asNumber(race.official_winning_average_speed),
      pickFormat,
      raceDate: race.race_date,
      raceId: race.id,
      raceName: race.race_name,
      roundNumber: race.round_number,
      resultsStatus: race.results_status,
      qualifyingStartAt: pickLockAtForRace(race)
    };
  });

  if (availableRaces.length === 0) {
    return {
      availableRaces,
      resultsPosted: false,
      rows: [],
      selectedRace: null
    };
  }

  const selectedRace =
    availableRaces.find((race) => race.raceId === selectedRaceIdInput) ?? availableRaces[0];

  const [selectedRacePicks, loadedResultRows, raceDriverGroups] = await Promise.all([
    loadAllRows<PickRow>("selected race picks", (from, to) =>
      supabase
        .from("picks")
        .select(
          "user_id,race_id,average_speed,driver_group1_id,driver_group2_id,driver_group3_id,driver_group4_id,driver_group5_id,driver_group6_id,driver_group7_id,driver_group8_id"
        )
        .eq("race_id", selectedRace.raceId)
        .order("user_id", { ascending: true })
        .range(from, to)
    ),
    loadAllRows<ResultRow>("selected race results", (from, to) =>
      supabase
        .from("results")
        .select("race_id,driver_id,points")
        .eq("race_id", selectedRace.raceId)
        .order("driver_id", { ascending: true })
        .range(from, to)
    ),
    loadAllRows<RaceDriverGroupRow>("selected race driver groups", (from, to) =>
      supabase
        .from("race_driver_groups")
        .select("race_id,driver_id,group_number")
        .eq("race_id", selectedRace.raceId)
        .order("driver_id", { ascending: true })
        .range(from, to)
    )
  ]);
  const picksByUser = new Map<string, PickRow>();
  selectedRacePicks.forEach((pick) => {
    picksByUser.set(pick.user_id, pick);
  });

  const driverNameById = new Map<number, string>();
  drivers.forEach((driver) => {
    driverNameById.set(driver.id, driver.driver_name);
  });

  const resultRows = selectedRace.resultsStatus === "published" ? loadedResultRows : [];
  const resultsPosted = selectedRace.resultsStatus === "published" && resultRows.length > 0;
  const participantById = new Map(participants.map((participant) => [participant.id, participant]));
  const projection = resultsPosted
    ? buildRaceScoringProjection({
        currentDrivers: drivers,
        officialWinningAverageSpeed: selectedRace.officialWinningAverageSpeed,
        participants,
        pickFormat: selectedRace.pickFormat,
        picks: selectedRacePicks,
        raceDriverGroups,
        results: resultRows
      })
    : null;

  const toDisplayRow = (
    participant: Participant,
    scoredRow: RaceScoringRow | null
  ): PicksByRaceParticipantRow => {
    const pick = picksByUser.get(participant.id) ?? null;
    const driverIds = scoredRow?.driverIds ??
      pickDriverIdsForGroupCount(pick, selectedRace.groupCount);
    const driverCells: PicksByRaceDriverCell[] = driverIds.map((driverId, index) => ({
      driverName:
        driverId === null ? null : (driverNameById.get(driverId) ?? `Unknown #${driverId}`),
      groupNumber: index + 1,
      points: scoredRow?.driverPoints[index] ?? null
    }));

    return {
      averageSpeed: scoredRow?.averageSpeed ?? (pick ? asNumber(pick.average_speed) : null),
      displayName: participant.displayName,
      driverCells,
      rank: scoredRow?.rank ?? null,
      teamName: participant.teamName,
      totalPoints: scoredRow?.points ?? null,
      userId: participant.id
    };
  };

  const rows: PicksByRaceParticipantRow[] = projection
    ? projection.rows.flatMap((scoredRow) => {
        const participant = participantById.get(scoredRow.userId);
        return participant ? [toDisplayRow(participant, scoredRow)] : [];
      })
    : [...participants]
        .sort((a, b) => a.teamName.localeCompare(b.teamName))
        .map((participant) => toDisplayRow(participant, null));

  return {
    availableRaces,
    resultsPosted,
    rows,
    selectedRace
  };
}

const buildCachedPicksByRaceSnapshot = unstable_cache(
  buildPicksByRaceSnapshotUncached,
  ["picks-by-race-snapshot-v2"],
  { revalidate: 60, tags: [SCORING_CACHE_TAG] }
);

export const buildPicksByRaceSnapshot = (
  seasonId: number,
  selectedRaceIdInput?: number
): Promise<PicksByRaceSnapshot> =>
  buildCachedPicksByRaceSnapshot(seasonId, selectedRaceIdInput);

export async function buildParticipantAnalyticsSnapshotUncached(
  userId: string,
  seasonId: number
): Promise<ParticipantAnalyticsSnapshot> {
  const model = await loadSeasonScoringModelUncached(seasonId);
  const snapshot = model.analyticsByUserId[userId];
  if (!snapshot) {
    throw new Error("Participant profile not found for analytics.");
  }
  return snapshot;
}

export const buildParticipantAnalyticsSnapshot = async (
  userId: string,
  seasonId: number
): Promise<ParticipantAnalyticsSnapshot> => {
  const model = await buildSeasonScoringSnapshot(seasonId);
  const snapshot = model.analyticsByUserId[userId];
  if (!snapshot) {
    throw new Error("Participant profile not found for analytics.");
  }
  return snapshot;
};
