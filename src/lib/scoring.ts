import "server-only";

import { createServiceRoleSupabaseClient } from "@/lib/supabase/service-role";
import { getLeagueSeasonDateRange } from "@/lib/timezone";
import {
  assignWeeklyRanks,
  buildOrderedWeeklyRows,
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
  race_id: number;
  user_id: string;
};

type ProfileRow = {
  full_name: string | null;
  id: string;
  role: "admin" | "participant";
  team_name: string;
};

type RaceRow = {
  id: number;
  official_winning_average_speed: number | string | null;
  race_date: string;
  race_name: string;
};

type ResultRow = {
  driver_id: number;
  points: number;
  race_id: number;
};

type Participant = {
  id: string;
  teamName: string;
};

export type LeaderboardRow = {
  change: number;
  currentStanding: number;
  previousStanding: number | null;
  raceBreakdown: Map<number, number>;
  teamName: string;
  totalPoints: number;
  trend: "flat" | "up" | "down";
  userId: string;
};

export type RaceBreakdownColumn = {
  raceDate: string;
  raceId: number;
  raceName: string;
};

export type RaceScoreboardRow = {
  averageSpeed: number | null;
  points: number;
  rowType: "benchmark_high" | "benchmark_low" | "participant";
  teamName: string;
};

export type RaceScoreboard = {
  raceDate: string;
  raceId: number;
  raceName: string;
  rows: RaceScoreboardRow[];
};

export type LeagueScoringSnapshot = {
  leaderboardRows: LeaderboardRow[];
  latestRaceScoreboard: RaceScoreboard | null;
  raceColumns: RaceBreakdownColumn[];
};

export type PicksByRaceOption = {
  officialWinningAverageSpeed: number | null;
  raceDate: string;
  raceId: number;
  raceName: string;
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
  pickSubmissionRate: number;
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

const withOfficialSpeedMigrationHint = (message: string): string =>
  message.includes("official_winning_average_speed")
    ? `${message}. Run the latest Supabase migration to add official race average speed support.`
    : message;

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

const assignWeeklyRaceRanks = <T extends { averageSpeed: number | null; racePoints: number; teamName: string }>(
  rows: T[],
  officialRaceAverageSpeed: number | null
): Array<T & { rank: number }> => {
  const sorted = buildOrderedWeeklyRows(
    rows.map((row) => ({
      ...row,
      points: row.racePoints
    })),
    officialRaceAverageSpeed
  );

  if (sorted.length === 0) {
    return [];
  }

  const topPoints = sorted[0].points;
  const topTieCount = sorted.filter((row) => row.points === topPoints).length;

  const ranked: Array<T & { rank: number }> = [];
  let previousPoints: number | null = null;
  let previousRank = 0;

  sorted.forEach((row, index) => {
    let rank: number;

    if (topTieCount > 1 && row.points === topPoints) {
      rank = index + 1;
    } else if (previousPoints !== null && row.points === previousPoints) {
      rank = previousRank;
    } else {
      rank = index + 1;
    }

    ranked.push({ ...(row as T), rank });
    previousPoints = row.points;
    previousRank = rank;
  });

  return ranked;
};

const keyForRaceDriver = (raceId: number, driverId: number): string => `${raceId}:${driverId}`;
const keyForRaceUser = (raceId: number, userId: string): string => `${raceId}:${userId}`;

const scorePick = (
  pick: PickRow,
  resultPointsByRaceDriver: Map<string, number>
): { averageSpeed: number; racePoints: number } => {
  const driverIds = [
    pick.driver_group1_id,
    pick.driver_group2_id,
    pick.driver_group3_id,
    pick.driver_group4_id,
    pick.driver_group5_id,
    pick.driver_group6_id
  ];

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
  results: ResultRow[],
  driverGroupById: Map<number, number>
): { highest: number; lowest: number } => {
  const pointsByGroup = new Map<number, number[]>();
  for (let group = 1; group <= 6; group += 1) {
    pointsByGroup.set(group, []);
  }

  results.forEach((result) => {
    const group = driverGroupById.get(result.driver_id);
    if (!group || group < 1 || group > 6) {
      return;
    }

    const arr = pointsByGroup.get(group) ?? [];
    arr.push(asNumber(result.points));
    pointsByGroup.set(group, arr);
  });

  let highest = 0;
  let lowest = 0;
  for (let group = 1; group <= 6; group += 1) {
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
  driverGroupById: Map<number, number>
): Map<number, number> => {
  const byRace = new Map<number, number>();
  resultsByRace.forEach((raceResults, raceId) => {
    byRace.set(raceId, computeRaceExtremes(raceId, raceResults, driverGroupById).lowest);
  });
  return byRace;
};

const pickDriverIds = (pick: PickRow | null): Array<number | null> => [
  pick?.driver_group1_id ?? null,
  pick?.driver_group2_id ?? null,
  pick?.driver_group3_id ?? null,
  pick?.driver_group4_id ?? null,
  pick?.driver_group5_id ?? null,
  pick?.driver_group6_id ?? null
];

export async function buildLeagueScoringSnapshot(): Promise<LeagueScoringSnapshot> {
  const supabase = createServiceRoleSupabaseClient();

  const [profilesRes, racesRes, picksRes, resultsRes, driversRes] = await Promise.all([
    supabase
      .from("profiles")
      .select("id,team_name,role,full_name")
      .in("role", ["participant", "admin"])
      .order("team_name", { ascending: true }),
    supabase
      .from("races")
      .select("id,race_name,race_date,official_winning_average_speed")
      .eq("is_archived", false)
      .order("race_date", { ascending: true }),
    supabase.from("picks").select(
      "user_id,race_id,average_speed,driver_group1_id,driver_group2_id,driver_group3_id,driver_group4_id,driver_group5_id,driver_group6_id"
    ),
    supabase.from("results").select("race_id,driver_id,points"),
    supabase.from("drivers").select("id,group_number")
  ]);

  if (profilesRes.error) {
    throw new Error(`Failed to load profiles: ${profilesRes.error.message}`);
  }
  if (racesRes.error) {
    throw new Error(`Failed to load races: ${withOfficialSpeedMigrationHint(racesRes.error.message)}`);
  }
  if (picksRes.error) {
    throw new Error(`Failed to load picks: ${picksRes.error.message}`);
  }
  if (resultsRes.error) {
    throw new Error(`Failed to load race results: ${resultsRes.error.message}`);
  }
  if (driversRes.error) {
    throw new Error(`Failed to load drivers: ${driversRes.error.message}`);
  }

  const participants: Participant[] = ((profilesRes.data ?? []) as ProfileRow[])
    .filter((profile) => typeof profile.team_name === "string" && profile.team_name.trim().length > 0)
    .map((profile) => ({
      id: profile.id,
      teamName: profile.team_name.trim()
    }));

  const races = (racesRes.data ?? []) as RaceRow[];
  const picks = (picksRes.data ?? []) as PickRow[];
  const results = (resultsRes.data ?? []) as ResultRow[];
  const drivers = (driversRes.data ?? []) as DriverRow[];

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
  const raceColumns: RaceBreakdownColumn[] = completedRaces.map((race) => ({
    raceDate: race.race_date,
    raceId: race.id,
    raceName: race.race_name
  }));

  if (completedRaces.length === 0) {
    return {
      leaderboardRows: [],
      latestRaceScoreboard: null,
      raceColumns
    };
  }

  const pickScoreByRaceUser = new Map<string, { averageSpeed: number; racePoints: number }>();
  picks.forEach((pick) => {
    if (!completedRaceIds.has(pick.race_id)) {
      return;
    }

    pickScoreByRaceUser.set(keyForRaceUser(pick.race_id, pick.user_id), scorePick(pick, resultPointsByRaceDriver));
  });

  const driverGroupById = new Map<number, number>();
  drivers.forEach((driver) => {
    driverGroupById.set(driver.id, driver.group_number);
  });
  const lowestFallbackByRaceId = computeLowestFallbackByRace(resultsByRace, driverGroupById);

  const latestRace = completedRaces[completedRaces.length - 1];
  const latestRaceMissingPickFallback = lowestFallbackByRaceId.get(latestRace.id) ?? 0;
  const latestRaceRows: RaceScoreboardRow[] = buildOrderedWeeklyRows(
    participants.map((participant) => {
      const weekly = pickScoreByRaceUser.get(keyForRaceUser(latestRace.id, participant.id));
      return {
        averageSpeed: weekly?.averageSpeed ?? null,
        points: weekly?.racePoints ?? latestRaceMissingPickFallback,
        rowType: "participant" as const,
        teamName: participant.teamName
      };
    }),
    latestRace.official_winning_average_speed === null
      ? null
      : asNumber(latestRace.official_winning_average_speed)
  );

  const latestRaceExtremes = computeRaceExtremes(
    latestRace.id,
    resultsByRace.get(latestRace.id) ?? [],
    driverGroupById
  );

  const latestRaceScoreboard: RaceScoreboard = {
    raceDate: latestRace.race_date,
    raceId: latestRace.id,
    raceName: latestRace.race_name,
    rows: [
      ...latestRaceRows,
      {
        averageSpeed: null,
        points: latestRaceExtremes.highest,
        rowType: "benchmark_high",
        teamName: "Highest Possible Score"
      },
      {
        averageSpeed: null,
        points: latestRaceExtremes.lowest,
        rowType: "benchmark_low",
        teamName: "Lowest Possible Score"
      }
    ]
  };

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
      const trend: LeaderboardRow["trend"] =
        change > 0 ? "up" : change < 0 ? "down" : "flat";

      return {
        change,
        currentStanding,
        previousStanding,
        raceBreakdown: raceBreakdownByUser.get(participant.id) ?? new Map<number, number>(),
        teamName: participant.teamName,
        totalPoints: cumulativeByUser.get(participant.id) ?? 0,
        trend,
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
    latestRaceScoreboard,
    raceColumns
  };
}

export async function buildPicksByRaceSnapshot(
  selectedRaceIdInput?: number
): Promise<PicksByRaceSnapshot> {
  const supabase = createServiceRoleSupabaseClient();
  const nowIso = new Date().toISOString();
  const seasonRange = getLeagueSeasonDateRange();

  const [profilesRes, seasonRacesRes, driversRes] = await Promise.all([
    supabase
      .from("profiles")
      .select("id,team_name,role,full_name")
      .in("role", ["participant", "admin"])
      .order("team_name", { ascending: true }),
    supabase
      .from("races")
      .select("id,race_name,race_date,qualifying_start_at,official_winning_average_speed")
      .eq("is_archived", false)
      .gte("race_date", seasonRange.seasonStartIso)
      .lt("race_date", seasonRange.seasonEndExclusiveIso)
      .lte("qualifying_start_at", nowIso)
      .order("qualifying_start_at", { ascending: false }),
    supabase.from("drivers").select("id,driver_name,group_number")
  ]);

  if (profilesRes.error) {
    throw new Error(`Failed to load profiles: ${profilesRes.error.message}`);
  }
  if (seasonRacesRes.error) {
    throw new Error(`Failed to load races: ${withOfficialSpeedMigrationHint(seasonRacesRes.error.message)}`);
  }
  if (driversRes.error) {
    throw new Error(`Failed to load drivers: ${driversRes.error.message}`);
  }

  let raceRows = (seasonRacesRes.data ?? []) as Array<RaceRow & { qualifying_start_at: string }>;
  if (raceRows.length === 0) {
    const { data: fallbackRaces, error: fallbackRacesError } = await supabase
      .from("races")
      .select("id,race_name,race_date,qualifying_start_at,official_winning_average_speed")
      .eq("is_archived", false)
      .lte("qualifying_start_at", nowIso)
      .order("qualifying_start_at", { ascending: false });

    if (fallbackRacesError) {
      throw new Error(
        `Failed to load fallback races: ${withOfficialSpeedMigrationHint(fallbackRacesError.message)}`
      );
    }

    raceRows = (fallbackRaces ?? []) as Array<RaceRow & { qualifying_start_at: string }>;
  }

  const participants: Participant[] = ((profilesRes.data ?? []) as ProfileRow[])
    .filter((profile) => typeof profile.team_name === "string" && profile.team_name.trim().length > 0)
    .map((profile) => ({
      id: profile.id,
      teamName: profile.team_name.trim()
    }));

  const availableRaces: PicksByRaceOption[] = raceRows.map((race) => ({
    officialWinningAverageSpeed:
      race.official_winning_average_speed === null
        ? null
        : asNumber(race.official_winning_average_speed),
    raceDate: race.race_date,
    raceId: race.id,
    raceName: race.race_name,
    qualifyingStartAt: race.qualifying_start_at
  }));

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

  const [picksRes, resultsRes] = await Promise.all([
    supabase.from("picks").select(
      "user_id,race_id,average_speed,driver_group1_id,driver_group2_id,driver_group3_id,driver_group4_id,driver_group5_id,driver_group6_id"
    ).eq("race_id", selectedRace.raceId),
    supabase.from("results").select("race_id,driver_id,points").eq("race_id", selectedRace.raceId)
  ]);

  if (picksRes.error) {
    throw new Error(`Failed to load picks: ${picksRes.error.message}`);
  }
  if (resultsRes.error) {
    throw new Error(`Failed to load race results: ${resultsRes.error.message}`);
  }

  const picksByUser = new Map<string, PickRow>();
  ((picksRes.data ?? []) as PickRow[]).forEach((pick) => {
    picksByUser.set(pick.user_id, pick);
  });

  const driverNameById = new Map<number, string>();
  const driverGroupById = new Map<number, number>();
  ((driversRes.data ?? []) as DriverNameRow[]).forEach((driver) => {
    driverNameById.set(driver.id, driver.driver_name);
    driverGroupById.set(driver.id, driver.group_number);
  });

  const resultPointsByDriverId = new Map<number, number>();
  const minimumPointsByGroup = new Map<number, number>();
  const resultRows = (resultsRes.data ?? []) as ResultRow[];
  resultRows.forEach((result) => {
    const points = asNumber(result.points);
    resultPointsByDriverId.set(result.driver_id, points);
    const group = driverGroupById.get(result.driver_id);
    if (!group || group < 1 || group > 6) {
      return;
    }
    const currentMin = minimumPointsByGroup.get(group);
    if (currentMin === undefined || points < currentMin) {
      minimumPointsByGroup.set(group, points);
    }
  });
  const resultsPosted = resultRows.length > 0;

  const baseRows = participants.map((participant) => {
    const pick = picksByUser.get(participant.id) ?? null;

    const driverCells: PicksByRaceDriverCell[] = pickDriverIds(pick).map((driverId, index) => ({
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

export async function buildParticipantAnalyticsSnapshot(
  userId: string
): Promise<ParticipantAnalyticsSnapshot> {
  const supabase = createServiceRoleSupabaseClient();

  const [profilesRes, racesRes, picksRes, resultsRes, driversRes] = await Promise.all([
    supabase
      .from("profiles")
      .select("id,team_name,role,full_name")
      .in("role", ["participant", "admin"])
      .order("team_name", { ascending: true }),
    supabase
      .from("races")
      .select("id,race_name,race_date,official_winning_average_speed")
      .eq("is_archived", false)
      .order("race_date", { ascending: true }),
    supabase.from("picks").select(
      "user_id,race_id,average_speed,driver_group1_id,driver_group2_id,driver_group3_id,driver_group4_id,driver_group5_id,driver_group6_id"
    ),
    supabase.from("results").select("race_id,driver_id,points"),
    supabase.from("drivers").select("id,group_number")
  ]);

  if (profilesRes.error) {
    throw new Error(`Failed to load profiles: ${profilesRes.error.message}`);
  }
  if (racesRes.error) {
    throw new Error(`Failed to load races: ${withOfficialSpeedMigrationHint(racesRes.error.message)}`);
  }
  if (picksRes.error) {
    throw new Error(`Failed to load picks: ${picksRes.error.message}`);
  }
  if (resultsRes.error) {
    throw new Error(`Failed to load race results: ${resultsRes.error.message}`);
  }
  if (driversRes.error) {
    throw new Error(`Failed to load drivers: ${driversRes.error.message}`);
  }

  const participants: Participant[] = ((profilesRes.data ?? []) as ProfileRow[])
    .filter((profile) => typeof profile.team_name === "string" && profile.team_name.trim().length > 0)
    .map((profile) => ({
      id: profile.id,
      teamName: profile.team_name.trim()
    }));
  const participant = participants.find((row) => row.id === userId);
  if (!participant) {
    throw new Error("Participant profile not found for analytics.");
  }

  const races = (racesRes.data ?? []) as RaceRow[];
  const picks = (picksRes.data ?? []) as PickRow[];
  const results = (resultsRes.data ?? []) as ResultRow[];
  const drivers = (driversRes.data ?? []) as DriverRow[];
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
  const driverGroupById = new Map<number, number>();
  drivers.forEach((driver) => {
    driverGroupById.set(driver.id, driver.group_number);
  });
  const lowestFallbackByRaceId = computeLowestFallbackByRace(resultsByRace, driverGroupById);

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
        pickSubmissionRate: 0,
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
    pickScoreByRaceUser.set(keyForRaceUser(pick.race_id, pick.user_id), scorePick(pick, resultPointsByRaceDriver));
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
    const weeklyRanks = assignWeeklyRaceRanks(weeklyRows, officialRaceAverageSpeed);
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
    const participantAverageSpeed = participantWeekly?.averageSpeed ?? null;

    raceRows.push({
      averageSpeedGuess: participantAverageSpeed,
      cumulativePoints: cumulativeByUser.get(participant.id) ?? 0,
      fieldSize,
      officialRaceAverageSpeed,
      pointsVsRaceAverage: (participantWeekly?.racePoints ?? 0) - raceAveragePoints,
      raceAveragePoints,
      raceDate: race.race_date,
      raceId: race.id,
      raceName: race.race_name,
      submittedPick: participantAverageSpeed !== null,
      tiebreakDelta: calculateOfficialSpeedDelta(participantAverageSpeed, officialRaceAverageSpeed),
      weeklyFinish: weeklyRankByUser.get(participant.id) ?? null,
      weeklyPoints: participantWeekly?.racePoints ?? 0
    });
  });

  const weeklyPoints = raceRows.map((row) => row.weeklyPoints);
  const weeklyFinishes = raceRows
    .map((row) => row.weeklyFinish)
    .filter((value): value is number => value !== null);
  const tiebreakDeltas = raceRows
    .map((row) => row.tiebreakDelta)
    .filter((value): value is number => value !== null);
  const submittedCount = raceRows.filter((row) => row.submittedPick).length;
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
      pickSubmissionRate: raceRows.length === 0 ? 0 : submittedCount / raceRows.length,
      topThreeFinishes: weeklyFinishes.filter((finish) => finish <= 3).length,
      totalPoints: raceRows[raceRows.length - 1]?.cumulativePoints ?? 0,
      weeklyWins: weeklyFinishes.filter((finish) => finish === 1).length,
      worstWeek
    },
    teamName: participant.teamName,
    userId: participant.id
  };
}
