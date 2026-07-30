import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
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
  pickDriverEntries,
  pickDriverIdsForGroupCount,
  scoringNumber as asNumber
} from "@/lib/scoring-engine";
import {
  buildSeasonScoringModel,
  type LeagueScoringSnapshot,
  type ParticipantAnalyticsSnapshot,
  type SeasonScoringModel
} from "@/lib/season-scoring-model";
import { loadAllRows } from "@/lib/supabase/paginated-query";
import { SCORING_CACHE_TAG } from "@/lib/scoring-cache";
import { assignWeeklyRanks } from "@/lib/weekly-ranking";

export type {
  LeaderboardRow,
  LeagueScoringSnapshot,
  ParticipantAnalyticsRaceRow,
  ParticipantAnalyticsSnapshot,
  ParticipantAnalyticsSummary,
  RaceBreakdownColumn
} from "@/lib/season-scoring-model";

type DriverRow = {
  group_number: number;
  id: number;
};

type DriverNameRow = {
  driver_name: string;
  group_number: number;
  id: number;
};

type PickRow = {
  average_speed: number;
  driver_group1_id: number;
  driver_group2_id: number;
  driver_group3_id: number;
  driver_group4_id: number;
  driver_group5_id: number;
  driver_group6_id: number;
  driver_group7_id: number | null;
  driver_group8_id: number | null;
  race_id: number;
  user_id: string;
};

type ProfileRow = {
  full_name: string | null;
  id: string;
  is_active: boolean;
  role: "admin" | "participant";
  team_name: string;
};

type SeasonParticipantRow = {
  profile_id: string;
};

type RaceRow = {
  id: number;
  official_winning_average_speed: number | string | null;
  pick_format: RacePickFormat;
  race_date: string;
  race_name: string;
  round_number: number;
  season_id: number;
  results_status: "draft" | "published";
};

type ResultRow = {
  driver_id: number;
  points: number;
  race_id: number;
};

type RaceDriverGroupRow = {
  driver_id: number;
  group_number: number;
  qualifying_position?: number | null;
  race_id: number;
};

type Participant = {
  displayName: string;
  id: string;
  teamName: string;
};

const loadRegisteredProfiles = async (
  supabase: SupabaseClient,
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
      .select("id,team_name,role,full_name,is_active")
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

const keyForRaceDriver = (raceId: number, driverId: number): string => `${raceId}:${driverId}`;

const resolveRaceDriverGroup = (
  raceId: number,
  driverId: number,
  raceDriverGroupByRaceDriver: Map<string, number>,
  pickedDriverGroupByRaceDriver: Map<string, number>,
  currentDriverGroupById: Map<number, number>
): number | undefined => {
  const raceSpecific = raceDriverGroupByRaceDriver.get(keyForRaceDriver(raceId, driverId));
  if (raceSpecific !== undefined) {
    return raceSpecific;
  }

  const pickedGroup = pickedDriverGroupByRaceDriver.get(keyForRaceDriver(raceId, driverId));
  if (pickedGroup !== undefined) {
    return pickedGroup;
  }

  return currentDriverGroupById.get(driverId);
};

const buildPickedDriverGroupByRaceDriver = (picks: PickRow[]): Map<string, number> => {
  const pickedDriverGroupByRaceDriver = new Map<string, number>();

  picks.forEach((pick) => {
    pickDriverEntries(pick).forEach(([driverId, groupNumber]) => {
      const key = keyForRaceDriver(pick.race_id, driverId);
      if (!pickedDriverGroupByRaceDriver.has(key)) {
        pickedDriverGroupByRaceDriver.set(key, groupNumber);
      }
    });
  });

  return pickedDriverGroupByRaceDriver;
};

const loadSeasonScoringModelUncached = async (
  seasonId: number
): Promise<SeasonScoringModel> => {
  const supabase = createServiceRoleSupabaseClient();

  const [profiles, races, drivers] = await Promise.all([
      loadRegisteredProfiles(supabase, seasonId),
      loadAllRows<RaceRow>("published races", (from, to) =>
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
  ["season-scoring-model-v1"],
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

export async function buildPicksByRaceSnapshot(
  seasonId: number,
  selectedRaceIdInput?: number
): Promise<PicksByRaceSnapshot> {
  const supabase = createServiceRoleSupabaseClient();
  const nowIso = new Date().toISOString();

  const [profiles, seasonRaceRows, drivers] = await Promise.all([
    loadRegisteredProfiles(supabase, seasonId),
    loadAllRows<RaceRow & { qualifying_start_at: string }>("locked season races", (from, to) =>
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

  const raceRows = seasonRaceRows;

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
  const pickedDriverGroupByRaceDriver = buildPickedDriverGroupByRaceDriver(selectedRacePicks);

  const driverNameById = new Map<number, string>();
  const currentDriverGroupById = new Map<number, number>();
  drivers.forEach((driver) => {
    driverNameById.set(driver.id, driver.driver_name);
    currentDriverGroupById.set(driver.id, driver.group_number);
  });
  const raceDriverGroupByRaceDriver = new Map<string, number>();
  raceDriverGroups.forEach((row) => {
    raceDriverGroupByRaceDriver.set(keyForRaceDriver(row.race_id, row.driver_id), row.group_number);
  });

  const resultPointsByDriverId = new Map<number, number>();
  const minimumPointsByGroup = new Map<number, number>();
  const resultRows = selectedRace.resultsStatus === "published" ? loadedResultRows : [];
  resultRows.forEach((result) => {
    const points = asNumber(result.points);
    resultPointsByDriverId.set(result.driver_id, points);
    const group = resolveRaceDriverGroup(
      selectedRace.raceId,
      result.driver_id,
      raceDriverGroupByRaceDriver,
      pickedDriverGroupByRaceDriver,
      currentDriverGroupById
    );
    if (!group || group < 1 || group > selectedRace.groupCount) {
      return;
    }
    const currentMin = minimumPointsByGroup.get(group);
    if (currentMin === undefined || points < currentMin) {
      minimumPointsByGroup.set(group, points);
    }
  });
  const resultsPosted = selectedRace.resultsStatus === "published" && resultRows.length > 0;

  const baseRows = participants.map((participant) => {
    const pick = picksByUser.get(participant.id) ?? null;

    const driverCells: PicksByRaceDriverCell[] = pickDriverIdsForGroupCount(
      pick,
      selectedRace.groupCount
    ).map((driverId, index) => ({
      driverName: driverId === null ? null : (driverNameById.get(driverId) ?? `Unknown #${driverId}`),
      groupNumber: index + 1,
      points: resultsPosted
        ? driverId !== null
          ? (resultPointsByDriverId.get(driverId) ?? 0)
          : pick
            ? null
            : (minimumPointsByGroup.get(index + 1) ?? null)
        : null
    }));

    const totalPoints = resultsPosted
      ? driverCells.reduce((sum, driverCell) => sum + (driverCell.points ?? 0), 0)
      : null;

    return {
      averageSpeed: pick ? asNumber(pick.average_speed) : null,
      displayName: participant.displayName,
      driverCells,
      rank: null as number | null,
      teamName: participant.teamName,
      totalPoints,
      userId: participant.id
    };
  });

  let rows: PicksByRaceParticipantRow[] = [];

  if (resultsPosted) {
    const ranked = assignWeeklyRanks(
      baseRows.map((row) => ({
        ...row,
        points: row.totalPoints ?? 0
      })),
      selectedRace.officialWinningAverageSpeed
    );

    rows = ranked.map(({ points, ...row }) => ({
      ...row,
      rank: row.rank,
      totalPoints: points
    }));
  } else {
    rows = [...baseRows]
      .sort((a, b) => a.teamName.localeCompare(b.teamName))
      .map((row) => ({ ...row, rank: null }));
  }

  return {
    availableRaces,
    resultsPosted,
    rows,
    selectedRace
  };
}

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
