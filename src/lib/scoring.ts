import "server-only";

import { createServiceRoleSupabaseClient } from "@/lib/supabase/service-role";
import { getLeagueSeasonDateRange } from "@/lib/timezone";

type DriverRow = {
  group_number: number;
  id: number;
};

type DriverNameRow = {
  driver_name: string;
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

const compareRaceScoreboardRows = (
  a: { averageSpeed: number | null; points: number; teamName: string },
  b: { averageSpeed: number | null; points: number; teamName: string }
): number => {
  if (b.points !== a.points) {
    return b.points - a.points;
  }

  if (a.averageSpeed !== null && b.averageSpeed !== null && a.averageSpeed !== b.averageSpeed) {
    return a.averageSpeed - b.averageSpeed;
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
      .select("id,race_name,race_date")
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
    throw new Error(`Failed to load races: ${racesRes.error.message}`);
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

  const latestRace = completedRaces[completedRaces.length - 1];
  const latestRaceRows: RaceScoreboardRow[] = participants.map((participant) => {
    const weekly = pickScoreByRaceUser.get(keyForRaceUser(latestRace.id, participant.id));
    return {
      averageSpeed: weekly?.averageSpeed ?? null,
      points: weekly?.racePoints ?? 0,
      rowType: "participant",
      teamName: participant.teamName
    };
  });
  latestRaceRows.sort(compareRaceScoreboardRows);

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
    const rankingInput = participants.map((participant) => {
      const weekly = pickScoreByRaceUser.get(keyForRaceUser(race.id, participant.id));
      const weeklyPoints = weekly?.racePoints ?? 0;
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
      .select("id,race_name,race_date,qualifying_start_at")
      .eq("is_archived", false)
      .gte("race_date", seasonRange.seasonStartIso)
      .lt("race_date", seasonRange.seasonEndExclusiveIso)
      .lte("qualifying_start_at", nowIso)
      .order("qualifying_start_at", { ascending: false }),
    supabase.from("drivers").select("id,driver_name")
  ]);

  if (profilesRes.error) {
    throw new Error(`Failed to load profiles: ${profilesRes.error.message}`);
  }
  if (seasonRacesRes.error) {
    throw new Error(`Failed to load races: ${seasonRacesRes.error.message}`);
  }
  if (driversRes.error) {
    throw new Error(`Failed to load drivers: ${driversRes.error.message}`);
  }

  let raceRows = (seasonRacesRes.data ?? []) as Array<RaceRow & { qualifying_start_at: string }>;
  if (raceRows.length === 0) {
    const { data: fallbackRaces, error: fallbackRacesError } = await supabase
      .from("races")
      .select("id,race_name,race_date,qualifying_start_at")
      .eq("is_archived", false)
      .lte("qualifying_start_at", nowIso)
      .order("qualifying_start_at", { ascending: false });

    if (fallbackRacesError) {
      throw new Error(`Failed to load fallback races: ${fallbackRacesError.message}`);
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
  ((driversRes.data ?? []) as DriverNameRow[]).forEach((driver) => {
    driverNameById.set(driver.id, driver.driver_name);
  });

  const resultPointsByDriverId = new Map<number, number>();
  const resultRows = (resultsRes.data ?? []) as ResultRow[];
  resultRows.forEach((result) => {
    resultPointsByDriverId.set(result.driver_id, asNumber(result.points));
  });
  const resultsPosted = resultRows.length > 0;

  const rows: PicksByRaceParticipantRow[] = participants.map((participant) => {
    const pick = picksByUser.get(participant.id) ?? null;

    const driverCells: PicksByRaceDriverCell[] = pickDriverIds(pick).map((driverId, index) => ({
      driverName: driverId === null ? null : (driverNameById.get(driverId) ?? `Unknown #${driverId}`),
      groupNumber: index + 1,
      points: resultsPosted && driverId !== null ? (resultPointsByDriverId.get(driverId) ?? 0) : null
    }));

    const totalPoints = resultsPosted
      ? driverCells.reduce((sum, driverCell) => sum + (driverCell.points ?? 0), 0)
      : null;

    return {
      averageSpeed: pick ? asNumber(pick.average_speed) : null,
      driverCells,
      teamName: participant.teamName,
      totalPoints,
      userId: participant.id
    };
  });

  if (resultsPosted) {
    rows.sort((a, b) => {
      const totalCompare = (b.totalPoints ?? 0) - (a.totalPoints ?? 0);
      if (totalCompare !== 0) {
        return totalCompare;
      }

      if (a.averageSpeed !== null && b.averageSpeed !== null && a.averageSpeed !== b.averageSpeed) {
        return a.averageSpeed - b.averageSpeed;
      }

      if (a.averageSpeed === null && b.averageSpeed !== null) {
        return 1;
      }
      if (a.averageSpeed !== null && b.averageSpeed === null) {
        return -1;
      }

      return a.teamName.localeCompare(b.teamName);
    });
  } else {
    rows.sort((a, b) => a.teamName.localeCompare(b.teamName));
  }

  return {
    availableRaces,
    resultsPosted,
    rows,
    selectedRace
  };
}
