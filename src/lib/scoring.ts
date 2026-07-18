import "server-only";

import { unstable_cache } from "next/cache";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/service-role";
import {
  normalizeRacePickFormat,
  pickGroupCountForFormat,
  pickLockAtForRace,
  type RacePickFormat
} from "@/lib/race-format";
import { loadAllRows } from "@/lib/supabase/paginated-query";
import { SCORING_CACHE_TAG } from "@/lib/scoring-cache";
import {
  assignWeeklyRanks,
  calculateOfficialSpeedDelta
} from "@/lib/weekly-ranking";

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
  id: string;
  teamName: string;
};

export type LeaderboardRow = {
  change: number;
  currentStanding: number;
  raceBreakdown: Record<number, number>;
  teamName: string;
  totalPoints: number;
  userId: string;
};

export type RaceBreakdownColumn = {
  raceDate: string;
  raceId: number;
  raceName: string;
  roundNumber: number;
};

export type LeagueScoringSnapshot = {
  leaderboardRows: LeaderboardRow[];
  raceColumns: RaceBreakdownColumn[];
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

export type ParticipantAnalyticsRaceRow = {
  averageSpeedGuess: number | null;
  cumulativePoints: number;
  fieldSize: number;
  officialRaceAverageSpeed: number | null;
  pointsVsRaceAverage: number;
  raceAveragePoints: number;
  raceDate: string;
  raceId: number;
  raceName: string;
  roundNumber: number;
  submittedPick: boolean;
  tiebreakDelta: number | null;
  weeklyFinish: number | null;
  weeklyPoints: number;
};

export type ParticipantAnalyticsSummary = {
  averageFinish: number | null;
  averageTiebreakDelta: number | null;
  averageWeeklyPoints: number;
  bestWeek: ParticipantAnalyticsRaceRow | null;
  closestTiebreakDelta: number | null;
  completedRaces: number;
  currentStanding: number | null;
  fieldSize: number;
  lastThreeRaceAverage: number | null;
  momentumDelta: number | null;
  topThreeFinishes: number;
  totalPoints: number;
  weeklyWins: number;
  worstWeek: ParticipantAnalyticsRaceRow | null;
};

export type ParticipantAnalyticsSnapshot = {
  raceRows: ParticipantAnalyticsRaceRow[];
  summary: ParticipantAnalyticsSummary;
  teamName: string;
  userId: string;
};

const asNumber = (value: number | string | null | undefined): number => {
  if (typeof value === "number") {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }

  return 0;
};

const compareLeaderboardRows = (
  a: { racePoints: number; teamName: string; totalPoints: number },
  b: { racePoints: number; teamName: string; totalPoints: number }
): number => {
  if (b.totalPoints !== a.totalPoints) {
    return b.totalPoints - a.totalPoints;
  }

  if (b.racePoints !== a.racePoints) {
    return b.racePoints - a.racePoints;
  }

  return a.teamName.localeCompare(b.teamName);
};

const assignCompetitionRanks = <T extends { teamName: string; totalPoints: number; racePoints: number }>(
  rows: T[]
): Array<T & { rank: number }> => {
  const sorted = [...rows].sort(compareLeaderboardRows);
  const ranked: Array<T & { rank: number }> = [];

  let previous: { racePoints: number; totalPoints: number } | null = null;
  let previousRank = 0;

  sorted.forEach((row, index) => {
    const sameAsPrevious =
      previous !== null &&
      previous.totalPoints === row.totalPoints &&
      previous.racePoints === row.racePoints;

    const rank = sameAsPrevious ? previousRank : index + 1;
    ranked.push({ ...row, rank });

    previous = {
      racePoints: row.racePoints,
      totalPoints: row.totalPoints
    };
    previousRank = rank;
  });

  return ranked;
};

const keyForRaceDriver = (raceId: number, driverId: number): string => `${raceId}:${driverId}`;
const keyForRaceUser = (raceId: number, userId: string): string => `${raceId}:${userId}`;

const pickDriverIdsForGroupCount = (
  pick: PickRow | null,
  groupCount: number
): Array<number | null> => {
  const allDriverIds = [
    pick?.driver_group1_id ?? null,
    pick?.driver_group2_id ?? null,
    pick?.driver_group3_id ?? null,
    pick?.driver_group4_id ?? null,
    pick?.driver_group5_id ?? null,
    pick?.driver_group6_id ?? null,
    pick?.driver_group7_id ?? null,
    pick?.driver_group8_id ?? null
  ];

  return allDriverIds.slice(0, groupCount);
};

const buildGroupCountByRaceId = (races: RaceRow[]): Map<number, number> => {
  const groupCountByRaceId = new Map<number, number>();
  races.forEach((race) => {
    groupCountByRaceId.set(
      race.id,
      pickGroupCountForFormat(normalizeRacePickFormat(race.pick_format))
    );
  });
  return groupCountByRaceId;
};

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
    const groupedDriverIds: Array<[number, number]> = [
      [pick.driver_group1_id, 1],
      [pick.driver_group2_id, 2],
      [pick.driver_group3_id, 3],
      [pick.driver_group4_id, 4],
      [pick.driver_group5_id, 5],
      [pick.driver_group6_id, 6],
      [pick.driver_group7_id, 7],
      [pick.driver_group8_id, 8]
    ].filter((row): row is [number, number] => row[0] !== null);

    groupedDriverIds.forEach(([driverId, groupNumber]) => {
      const key = keyForRaceDriver(pick.race_id, driverId);
      if (!pickedDriverGroupByRaceDriver.has(key)) {
        pickedDriverGroupByRaceDriver.set(key, groupNumber);
      }
    });
  });

  return pickedDriverGroupByRaceDriver;
};

const scorePick = (
  pick: PickRow,
  groupCount: number,
  resultPointsByRaceDriver: Map<string, number>
): { averageSpeed: number; racePoints: number } => {
  const driverIds = pickDriverIdsForGroupCount(pick, groupCount).filter(
    (driverId): driverId is number => driverId !== null
  );

  const racePoints = driverIds.reduce((sum, driverId) => {
    return sum + (resultPointsByRaceDriver.get(keyForRaceDriver(pick.race_id, driverId)) ?? 0);
  }, 0);

  return {
    averageSpeed: asNumber(pick.average_speed),
    racePoints
  };
};

const computeRaceExtremes = (
  raceId: number,
  groupCount: number,
  results: ResultRow[],
  raceDriverGroupByRaceDriver: Map<string, number>,
  pickedDriverGroupByRaceDriver: Map<string, number>,
  currentDriverGroupById: Map<number, number>
): { highest: number; lowest: number } => {
  const pointsByGroup = new Map<number, number[]>();
  for (let group = 1; group <= groupCount; group += 1) {
    pointsByGroup.set(group, []);
  }

  results.forEach((result) => {
    const group = resolveRaceDriverGroup(
      raceId,
      result.driver_id,
      raceDriverGroupByRaceDriver,
      pickedDriverGroupByRaceDriver,
      currentDriverGroupById
    );
    if (!group || group < 1 || group > groupCount) {
      return;
    }

    const arr = pointsByGroup.get(group) ?? [];
    arr.push(asNumber(result.points));
    pointsByGroup.set(group, arr);
  });

  let highest = 0;
  let lowest = 0;
  for (let group = 1; group <= groupCount; group += 1) {
    const arr = pointsByGroup.get(group) ?? [];
    if (arr.length === 0) {
      continue;
    }

    highest += Math.max(...arr);
    lowest += Math.min(...arr);
  }

  return { highest, lowest };
};

const computeLowestFallbackByRace = (
  resultsByRace: Map<number, ResultRow[]>,
  groupCountByRaceId: Map<number, number>,
  raceDriverGroupByRaceDriver: Map<string, number>,
  pickedDriverGroupByRaceDriver: Map<string, number>,
  currentDriverGroupById: Map<number, number>
): Map<number, number> => {
  const byRace = new Map<number, number>();
  resultsByRace.forEach((raceResults, raceId) => {
    byRace.set(
      raceId,
      computeRaceExtremes(
        raceId,
        groupCountByRaceId.get(raceId) ?? 6,
        raceResults,
        raceDriverGroupByRaceDriver,
        pickedDriverGroupByRaceDriver,
        currentDriverGroupById
      ).lowest
    );
  });
  return byRace;
};

export async function buildLeagueScoringSnapshotUncached(
  seasonId: number
): Promise<LeagueScoringSnapshot> {
  const supabase = createServiceRoleSupabaseClient();

  const [profiles, races, allPicks, allResults, drivers, allRaceDriverGroups] =
    await Promise.all([
      loadAllRows<ProfileRow>("profiles", (from, to) =>
        supabase
          .from("profiles")
          .select("id,team_name,role,full_name,is_active")
          .in("role", ["participant", "admin"])
          .eq("is_active", true)
          .order("team_name", { ascending: true })
          .order("id", { ascending: true })
          .range(from, to)
      ),
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
      loadAllRows<PickRow>("picks", (from, to) =>
        supabase
          .from("picks")
          .select(
            "user_id,race_id,average_speed,driver_group1_id,driver_group2_id,driver_group3_id,driver_group4_id,driver_group5_id,driver_group6_id,driver_group7_id,driver_group8_id"
          )
          .order("race_id", { ascending: true })
          .order("user_id", { ascending: true })
          .range(from, to)
      ),
      loadAllRows<ResultRow>("race results", (from, to) =>
        supabase
          .from("results")
          .select("race_id,driver_id,points")
          .order("race_id", { ascending: true })
          .order("driver_id", { ascending: true })
          .range(from, to)
      ),
      loadAllRows<DriverRow>("drivers", (from, to) =>
        supabase
          .from("drivers")
          .select("id,group_number")
          .order("id", { ascending: true })
          .range(from, to)
      ),
      loadAllRows<RaceDriverGroupRow>("race driver groups", (from, to) =>
        supabase
          .from("race_driver_groups")
          .select("race_id,driver_id,group_number")
          .order("race_id", { ascending: true })
          .order("driver_id", { ascending: true })
          .range(from, to)
      )
    ]);

  const participants: Participant[] = profiles
    .filter((profile) => typeof profile.team_name === "string" && profile.team_name.trim().length > 0)
    .map((profile) => ({
      id: profile.id,
      teamName: profile.team_name.trim()
    }));

  const publishedRaceIds = new Set(races.map((race) => race.id));
  const picks = allPicks.filter((pick) => publishedRaceIds.has(pick.race_id));
  const results = allResults.filter((result) => publishedRaceIds.has(result.race_id));
  const raceDriverGroups = allRaceDriverGroups.filter((row) =>
    publishedRaceIds.has(row.race_id)
  );

  const resultPointsByRaceDriver = new Map<string, number>();
  const resultsByRace = new Map<number, ResultRow[]>();
  results.forEach((result) => {
    resultPointsByRaceDriver.set(keyForRaceDriver(result.race_id, result.driver_id), asNumber(result.points));
    const arr = resultsByRace.get(result.race_id) ?? [];
    arr.push(result);
    resultsByRace.set(result.race_id, arr);
  });

  const completedRaceIds = new Set<number>(Array.from(resultsByRace.keys()));
  const completedRaces = races.filter((race) => completedRaceIds.has(race.id));
  const groupCountByRaceId = buildGroupCountByRaceId(races);
  const raceColumns: RaceBreakdownColumn[] = completedRaces.map((race) => ({
    raceDate: race.race_date,
    raceId: race.id,
    raceName: race.race_name,
    roundNumber: race.round_number
  }));

  if (completedRaces.length === 0) {
    return {
      leaderboardRows: [],
      raceColumns
    };
  }

  const pickScoreByRaceUser = new Map<string, { averageSpeed: number; racePoints: number }>();
  picks.forEach((pick) => {
    if (!completedRaceIds.has(pick.race_id)) {
      return;
    }

    pickScoreByRaceUser.set(
      keyForRaceUser(pick.race_id, pick.user_id),
      scorePick(pick, groupCountByRaceId.get(pick.race_id) ?? 6, resultPointsByRaceDriver)
    );
  });
  const pickedDriverGroupByRaceDriver = buildPickedDriverGroupByRaceDriver(picks);

  const currentDriverGroupById = new Map<number, number>();
  drivers.forEach((driver) => {
    currentDriverGroupById.set(driver.id, driver.group_number);
  });
  const raceDriverGroupByRaceDriver = new Map<string, number>();
  raceDriverGroups.forEach((row) => {
    raceDriverGroupByRaceDriver.set(keyForRaceDriver(row.race_id, row.driver_id), row.group_number);
  });

  const lowestFallbackByRaceId = computeLowestFallbackByRace(
    resultsByRace,
    groupCountByRaceId,
    raceDriverGroupByRaceDriver,
    pickedDriverGroupByRaceDriver,
    currentDriverGroupById
  );

  const latestRace = completedRaces[completedRaces.length - 1];
  const cumulativeByUser = new Map<string, number>();
  const standingByRaceUser = new Map<string, number>();
  const raceBreakdownByUser = new Map<string, Map<number, number>>();

  participants.forEach((participant) => {
    cumulativeByUser.set(participant.id, 0);
    raceBreakdownByUser.set(participant.id, new Map<number, number>());
  });

  completedRaces.forEach((race) => {
    const missingPickRacePoints = lowestFallbackByRaceId.get(race.id) ?? 0;
    const rankingInput = participants.map((participant) => {
      const weekly = pickScoreByRaceUser.get(keyForRaceUser(race.id, participant.id));
      const weeklyPoints = weekly?.racePoints ?? missingPickRacePoints;
      const nextTotal = (cumulativeByUser.get(participant.id) ?? 0) + weeklyPoints;

      cumulativeByUser.set(participant.id, nextTotal);
      raceBreakdownByUser.get(participant.id)?.set(race.id, weeklyPoints);

      return {
        racePoints: weeklyPoints,
        teamName: participant.teamName,
        totalPoints: nextTotal,
        userId: participant.id
      };
    });

    const ranked = assignCompetitionRanks(rankingInput);
    ranked.forEach((row) => {
      standingByRaceUser.set(keyForRaceUser(race.id, row.userId), row.rank);
    });
  });

  const previousRace = completedRaces.length > 1 ? completedRaces[completedRaces.length - 2] : null;

  const leaderboardRows: LeaderboardRow[] = participants
    .map((participant) => {
      const currentStanding = standingByRaceUser.get(keyForRaceUser(latestRace.id, participant.id)) ?? 0;
      const previousStanding = previousRace
        ? (standingByRaceUser.get(keyForRaceUser(previousRace.id, participant.id)) ?? null)
        : null;
      const baselinePrevious = previousStanding ?? currentStanding;
      const change = baselinePrevious - currentStanding;

      return {
        change,
        currentStanding,
        raceBreakdown: Object.fromEntries(raceBreakdownByUser.get(participant.id) ?? []),
        teamName: participant.teamName,
        totalPoints: cumulativeByUser.get(participant.id) ?? 0,
        userId: participant.id
      };
    })
    .sort((a, b) => {
      if (a.currentStanding !== b.currentStanding) {
        return a.currentStanding - b.currentStanding;
      }

      if (b.totalPoints !== a.totalPoints) {
        return b.totalPoints - a.totalPoints;
      }

      return a.teamName.localeCompare(b.teamName);
    });

  return {
    leaderboardRows,
    raceColumns
  };
}

const buildCachedLeagueScoringSnapshot = unstable_cache(
  async (seasonId: number) => buildLeagueScoringSnapshotUncached(seasonId),
  ["league-scoring-snapshot"],
  { revalidate: 3600, tags: [SCORING_CACHE_TAG] }
);

export const buildLeagueScoringSnapshot = (
  seasonId: number
): Promise<LeagueScoringSnapshot> => buildCachedLeagueScoringSnapshot(seasonId);

export async function buildPicksByRaceSnapshot(
  seasonId: number,
  selectedRaceIdInput?: number
): Promise<PicksByRaceSnapshot> {
  const supabase = createServiceRoleSupabaseClient();
  const nowIso = new Date().toISOString();

  const [profiles, seasonRaceRows, drivers] = await Promise.all([
    loadAllRows<ProfileRow>("profiles", (from, to) =>
      supabase
        .from("profiles")
        .select("id,team_name,role,full_name,is_active")
        .in("role", ["participant", "admin"])
        .eq("is_active", true)
        .order("team_name", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to)
    ),
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

const average = (values: number[]): number | null =>
  values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;

const pickBetterBestWeek = (
  current: ParticipantAnalyticsRaceRow | null,
  candidate: ParticipantAnalyticsRaceRow
): ParticipantAnalyticsRaceRow => {
  if (!current) {
    return candidate;
  }
  if (candidate.weeklyPoints !== current.weeklyPoints) {
    return candidate.weeklyPoints > current.weeklyPoints ? candidate : current;
  }
  const candidateFinish = candidate.weeklyFinish ?? Number.POSITIVE_INFINITY;
  const currentFinish = current.weeklyFinish ?? Number.POSITIVE_INFINITY;
  if (candidateFinish !== currentFinish) {
    return candidateFinish < currentFinish ? candidate : current;
  }
  return candidate.raceDate > current.raceDate ? candidate : current;
};

const pickWorseWeek = (
  current: ParticipantAnalyticsRaceRow | null,
  candidate: ParticipantAnalyticsRaceRow
): ParticipantAnalyticsRaceRow => {
  if (!current) {
    return candidate;
  }
  if (candidate.weeklyPoints !== current.weeklyPoints) {
    return candidate.weeklyPoints < current.weeklyPoints ? candidate : current;
  }
  const candidateFinish = candidate.weeklyFinish ?? Number.POSITIVE_INFINITY;
  const currentFinish = current.weeklyFinish ?? Number.POSITIVE_INFINITY;
  if (candidateFinish !== currentFinish) {
    return candidateFinish > currentFinish ? candidate : current;
  }
  return candidate.raceDate > current.raceDate ? candidate : current;
};

export async function buildParticipantAnalyticsSnapshotUncached(
  userId: string,
  seasonId: number
): Promise<ParticipantAnalyticsSnapshot> {
  const supabase = createServiceRoleSupabaseClient();

  const [profiles, races, allPicks, allResults, drivers, allRaceDriverGroups] =
    await Promise.all([
      loadAllRows<ProfileRow>("profiles", (from, to) =>
        supabase
          .from("profiles")
          .select("id,team_name,role,full_name,is_active")
          .in("role", ["participant", "admin"])
          .eq("is_active", true)
          .order("team_name", { ascending: true })
          .order("id", { ascending: true })
          .range(from, to)
      ),
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
      loadAllRows<PickRow>("picks", (from, to) =>
        supabase
          .from("picks")
          .select(
            "user_id,race_id,average_speed,driver_group1_id,driver_group2_id,driver_group3_id,driver_group4_id,driver_group5_id,driver_group6_id,driver_group7_id,driver_group8_id"
          )
          .order("race_id", { ascending: true })
          .order("user_id", { ascending: true })
          .range(from, to)
      ),
      loadAllRows<ResultRow>("race results", (from, to) =>
        supabase
          .from("results")
          .select("race_id,driver_id,points")
          .order("race_id", { ascending: true })
          .order("driver_id", { ascending: true })
          .range(from, to)
      ),
      loadAllRows<DriverRow>("drivers", (from, to) =>
        supabase
          .from("drivers")
          .select("id,group_number")
          .order("id", { ascending: true })
          .range(from, to)
      ),
      loadAllRows<RaceDriverGroupRow>("race driver groups", (from, to) =>
        supabase
          .from("race_driver_groups")
          .select("race_id,driver_id,group_number")
          .order("race_id", { ascending: true })
          .order("driver_id", { ascending: true })
          .range(from, to)
      )
    ]);

  const participants: Participant[] = profiles
    .filter((profile) => typeof profile.team_name === "string" && profile.team_name.trim().length > 0)
    .map((profile) => ({
      id: profile.id,
      teamName: profile.team_name.trim()
    }));
  const participant = participants.find((row) => row.id === userId);
  if (!participant) {
    throw new Error("Participant profile not found for analytics.");
  }

  const publishedRaceIds = new Set(races.map((race) => race.id));
  const picks = allPicks.filter((pick) => publishedRaceIds.has(pick.race_id));
  const results = allResults.filter((result) => publishedRaceIds.has(result.race_id));
  const raceDriverGroups = allRaceDriverGroups.filter((row) =>
    publishedRaceIds.has(row.race_id)
  );
  const fieldSize = participants.length;

  const resultPointsByRaceDriver = new Map<string, number>();
  const resultsByRace = new Map<number, ResultRow[]>();
  results.forEach((result) => {
    resultPointsByRaceDriver.set(keyForRaceDriver(result.race_id, result.driver_id), asNumber(result.points));
    const arr = resultsByRace.get(result.race_id) ?? [];
    arr.push(result);
    resultsByRace.set(result.race_id, arr);
  });

  const completedRaceIds = new Set<number>(Array.from(resultsByRace.keys()));
  const completedRaces = races.filter((race) => completedRaceIds.has(race.id));
  const groupCountByRaceId = buildGroupCountByRaceId(races);
  const currentDriverGroupById = new Map<number, number>();
  drivers.forEach((driver) => {
    currentDriverGroupById.set(driver.id, driver.group_number);
  });
  const raceDriverGroupByRaceDriver = new Map<string, number>();
  raceDriverGroups.forEach((row) => {
    raceDriverGroupByRaceDriver.set(keyForRaceDriver(row.race_id, row.driver_id), row.group_number);
  });

  const lowestFallbackByRaceId = computeLowestFallbackByRace(
    resultsByRace,
    groupCountByRaceId,
    raceDriverGroupByRaceDriver,
    buildPickedDriverGroupByRaceDriver(picks),
    currentDriverGroupById
  );

  if (completedRaces.length === 0) {
    return {
      raceRows: [],
      summary: {
        averageFinish: null,
        averageTiebreakDelta: null,
        averageWeeklyPoints: 0,
        bestWeek: null,
        closestTiebreakDelta: null,
        completedRaces: 0,
        currentStanding: null,
        fieldSize,
        lastThreeRaceAverage: null,
        momentumDelta: null,
        topThreeFinishes: 0,
        totalPoints: 0,
        weeklyWins: 0,
        worstWeek: null
      },
      teamName: participant.teamName,
      userId: participant.id
    };
  }

  const pickScoreByRaceUser = new Map<string, { averageSpeed: number; racePoints: number }>();
  picks.forEach((pick) => {
    if (!completedRaceIds.has(pick.race_id)) {
      return;
    }
    pickScoreByRaceUser.set(
      keyForRaceUser(pick.race_id, pick.user_id),
      scorePick(pick, groupCountByRaceId.get(pick.race_id) ?? 6, resultPointsByRaceDriver)
    );
  });

  const cumulativeByUser = new Map<string, number>();
  participants.forEach((row) => cumulativeByUser.set(row.id, 0));

  let currentStanding: number | null = null;
  const raceRows: ParticipantAnalyticsRaceRow[] = [];

  completedRaces.forEach((race) => {
    const officialRaceAverageSpeed =
      race.official_winning_average_speed === null
        ? null
        : asNumber(race.official_winning_average_speed);
    const missingPickRacePoints = lowestFallbackByRaceId.get(race.id) ?? 0;

    const weeklyRows = participants.map((row) => {
      const weekly = pickScoreByRaceUser.get(keyForRaceUser(race.id, row.id));
      return {
        averageSpeed: weekly?.averageSpeed ?? null,
        racePoints: weekly?.racePoints ?? missingPickRacePoints,
        teamName: row.teamName,
        userId: row.id
      };
    });
    const weeklyRanks = assignWeeklyRanks(
      weeklyRows.map((row) => ({
        ...row,
        points: row.racePoints
      })),
      officialRaceAverageSpeed
    );
    const weeklyRankByUser = new Map(weeklyRanks.map((row) => [row.userId, row.rank]));
    const raceAveragePoints =
      weeklyRows.length === 0
        ? 0
        : weeklyRows.reduce((sum, row) => sum + row.racePoints, 0) / weeklyRows.length;

    const cumulativeRankingInput = participants.map((row) => {
      const weekly = pickScoreByRaceUser.get(keyForRaceUser(race.id, row.id));
      const weeklyPoints = weekly?.racePoints ?? missingPickRacePoints;
      const nextTotal = (cumulativeByUser.get(row.id) ?? 0) + weeklyPoints;
      cumulativeByUser.set(row.id, nextTotal);
      return {
        racePoints: weeklyPoints,
        teamName: row.teamName,
        totalPoints: nextTotal,
        userId: row.id
      };
    });
    const cumulativeRanks = assignCompetitionRanks(cumulativeRankingInput);
    currentStanding =
      cumulativeRanks.find((row) => row.userId === participant.id)?.rank ?? currentStanding;

    const participantWeekly = weeklyRows.find((row) => row.userId === participant.id);
    const participantWeeklyPoints = participantWeekly?.racePoints ?? missingPickRacePoints;
    const participantAverageSpeed = participantWeekly?.averageSpeed ?? null;

    raceRows.push({
      averageSpeedGuess: participantAverageSpeed,
      cumulativePoints: cumulativeByUser.get(participant.id) ?? 0,
      fieldSize,
      officialRaceAverageSpeed,
      pointsVsRaceAverage: participantWeeklyPoints - raceAveragePoints,
      raceAveragePoints,
      raceDate: race.race_date,
      raceId: race.id,
      raceName: race.race_name,
      roundNumber: race.round_number,
      submittedPick: participantAverageSpeed !== null,
      tiebreakDelta: calculateOfficialSpeedDelta(participantAverageSpeed, officialRaceAverageSpeed),
      weeklyFinish: weeklyRankByUser.get(participant.id) ?? null,
      weeklyPoints: participantWeeklyPoints
    });
  });

  const weeklyPoints = raceRows.map((row) => row.weeklyPoints);
  const weeklyFinishes = raceRows
    .map((row) => row.weeklyFinish)
    .filter((value): value is number => value !== null);
  const tiebreakDeltas = raceRows
    .map((row) => row.tiebreakDelta)
    .filter((value): value is number => value !== null);
  const bestWeek = raceRows.reduce<ParticipantAnalyticsRaceRow | null>(
    (best, row) => pickBetterBestWeek(best, row),
    null
  );
  const worstWeek = raceRows.reduce<ParticipantAnalyticsRaceRow | null>(
    (worst, row) => pickWorseWeek(worst, row),
    null
  );
  const averageWeeklyPoints = average(weeklyPoints) ?? 0;
  const lastThreeRaceRows = raceRows.slice(-3);
  const lastThreeRaceAverage = average(lastThreeRaceRows.map((row) => row.weeklyPoints));

  return {
    raceRows,
    summary: {
      averageFinish: average(weeklyFinishes),
      averageTiebreakDelta: average(tiebreakDeltas),
      averageWeeklyPoints,
      bestWeek,
      closestTiebreakDelta: tiebreakDeltas.length === 0 ? null : Math.min(...tiebreakDeltas),
      completedRaces: raceRows.length,
      currentStanding,
      fieldSize,
      lastThreeRaceAverage,
      momentumDelta: lastThreeRaceAverage === null ? null : lastThreeRaceAverage - averageWeeklyPoints,
      topThreeFinishes: weeklyFinishes.filter((finish) => finish <= 3).length,
      totalPoints: raceRows[raceRows.length - 1]?.cumulativePoints ?? 0,
      weeklyWins: weeklyFinishes.filter((finish) => finish === 1).length,
      worstWeek
    },
    teamName: participant.teamName,
    userId: participant.id
  };
}

const buildCachedParticipantAnalyticsSnapshot = unstable_cache(
  async (userId: string, seasonId: number) =>
    buildParticipantAnalyticsSnapshotUncached(userId, seasonId),
  ["participant-analytics-snapshot"],
  { revalidate: 3600, tags: [SCORING_CACHE_TAG] }
);

export const buildParticipantAnalyticsSnapshot = (
  userId: string,
  seasonId: number
): Promise<ParticipantAnalyticsSnapshot> =>
  buildCachedParticipantAnalyticsSnapshot(userId, seasonId);
