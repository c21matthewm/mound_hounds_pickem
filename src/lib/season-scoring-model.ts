import type { RacePickFormat } from "@/lib/race-format";
import { buildRaceScoringProjection } from "@/lib/race-scoring-model";
import { scoringNumber } from "@/lib/scoring-engine";
import { calculateOfficialSpeedDelta } from "@/lib/weekly-ranking";

export type SeasonScoringDriver = {
  group_number: number;
  id: number;
};

export type SeasonScoringParticipant = {
  displayName: string;
  id: string;
  teamName: string;
};

export type SeasonScoringPick = {
  average_speed: number | string;
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

export type SeasonScoringRace = {
  id: number;
  official_winning_average_speed: number | string | null;
  pick_format: RacePickFormat;
  race_date: string;
  race_name: string;
  round_number: number;
};

export type SeasonScoringResult = {
  driver_id: number;
  points: number | string;
  race_id: number;
};

export type SeasonScoringRaceDriverGroup = {
  driver_id: number;
  group_number: number;
  race_id: number;
};

export type LeaderboardRow = {
  change: number;
  currentStanding: number;
  displayName: string;
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

export type SeasonScoringModel = {
  analyticsByUserId: Record<string, ParticipantAnalyticsSnapshot>;
  leaderboardSnapshot: LeagueScoringSnapshot;
};

type BuildSeasonScoringModelInput = {
  drivers: SeasonScoringDriver[];
  participants: SeasonScoringParticipant[];
  picks: SeasonScoringPick[];
  raceDriverGroups: SeasonScoringRaceDriverGroup[];
  races: SeasonScoringRace[];
  results: SeasonScoringResult[];
};

type CumulativeRankingRow = {
  racePoints: number;
  teamName: string;
  totalPoints: number;
  userId: string;
};

const keyForRaceUser = (raceId: number, userId: string): string => `${raceId}:${userId}`;

const compareLeaderboardRows = (
  left: CumulativeRankingRow,
  right: CumulativeRankingRow
): number => {
  if (right.totalPoints !== left.totalPoints) {
    return right.totalPoints - left.totalPoints;
  }
  if (right.racePoints !== left.racePoints) {
    return right.racePoints - left.racePoints;
  }
  return left.teamName.localeCompare(right.teamName);
};

const assignCompetitionRanks = (
  rows: CumulativeRankingRow[]
): Array<CumulativeRankingRow & { rank: number }> => {
  const sorted = [...rows].sort(compareLeaderboardRows);
  let previous: Pick<CumulativeRankingRow, "racePoints" | "totalPoints"> | null = null;
  let previousRank = 0;

  return sorted.map((row, index) => {
    const rank =
      previous !== null &&
      previous.totalPoints === row.totalPoints &&
      previous.racePoints === row.racePoints
        ? previousRank
        : index + 1;

    previous = {
      racePoints: row.racePoints,
      totalPoints: row.totalPoints
    };
    previousRank = rank;
    return { ...row, rank };
  });
};

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

const buildAnalyticsSummary = (
  raceRows: ParticipantAnalyticsRaceRow[],
  currentStanding: number | null,
  fieldSize: number
): ParticipantAnalyticsSummary => {
  const weeklyPoints = raceRows.map((row) => row.weeklyPoints);
  const weeklyFinishes = raceRows
    .map((row) => row.weeklyFinish)
    .filter((value): value is number => value !== null);
  const tiebreakDeltas = raceRows
    .map((row) => row.tiebreakDelta)
    .filter((value): value is number => value !== null);
  const averageWeeklyPoints = average(weeklyPoints) ?? 0;
  const lastThreeRaceAverage = average(raceRows.slice(-3).map((row) => row.weeklyPoints));

  return {
    averageFinish: average(weeklyFinishes),
    averageTiebreakDelta: average(tiebreakDeltas),
    averageWeeklyPoints,
    bestWeek: raceRows.reduce<ParticipantAnalyticsRaceRow | null>(
      (best, row) => pickBetterBestWeek(best, row),
      null
    ),
    closestTiebreakDelta: tiebreakDeltas.length === 0 ? null : Math.min(...tiebreakDeltas),
    completedRaces: raceRows.length,
    currentStanding,
    fieldSize,
    lastThreeRaceAverage,
    momentumDelta:
      lastThreeRaceAverage === null ? null : lastThreeRaceAverage - averageWeeklyPoints,
    topThreeFinishes: weeklyFinishes.filter((finish) => finish <= 3).length,
    totalPoints: raceRows.at(-1)?.cumulativePoints ?? 0,
    weeklyWins: weeklyFinishes.filter((finish) => finish === 1).length,
    worstWeek: raceRows.reduce<ParticipantAnalyticsRaceRow | null>(
      (worst, row) => pickWorseWeek(worst, row),
      null
    )
  };
};

export const buildSeasonScoringModel = ({
  drivers,
  participants,
  picks,
  raceDriverGroups,
  races,
  results
}: BuildSeasonScoringModelInput): SeasonScoringModel => {
  const orderedRaces = [...races].sort(
    (left, right) => left.round_number - right.round_number || left.id - right.id
  );
  const resultsByRace = new Map<number, SeasonScoringResult[]>();
  results.forEach((result) => {
    const raceResults = resultsByRace.get(result.race_id) ?? [];
    raceResults.push(result);
    resultsByRace.set(result.race_id, raceResults);
  });

  const picksByRace = new Map<number, SeasonScoringPick[]>();
  picks.forEach((pick) => {
    const racePicks = picksByRace.get(pick.race_id) ?? [];
    racePicks.push(pick);
    picksByRace.set(pick.race_id, racePicks);
  });

  const driverGroupsByRace = new Map<number, SeasonScoringRaceDriverGroup[]>();
  raceDriverGroups.forEach((row) => {
    const raceGroups = driverGroupsByRace.get(row.race_id) ?? [];
    raceGroups.push(row);
    driverGroupsByRace.set(row.race_id, raceGroups);
  });

  const completedRaceIds = new Set(resultsByRace.keys());
  const completedRaces = orderedRaces.filter((race) => completedRaceIds.has(race.id));
  const raceColumns: RaceBreakdownColumn[] = completedRaces.map((race) => ({
    raceDate: race.race_date,
    raceId: race.id,
    raceName: race.race_name,
    roundNumber: race.round_number
  }));

  const cumulativeByUser = new Map(participants.map((participant) => [participant.id, 0]));
  const standingByRaceUser = new Map<string, number>();
  const raceBreakdownByUser = new Map(
    participants.map((participant) => [participant.id, new Map<number, number>()])
  );
  const analyticsRowsByUser = new Map(
    participants.map((participant) => [
      participant.id,
      [] as ParticipantAnalyticsRaceRow[]
    ])
  );

  completedRaces.forEach((race) => {
    const projection = buildRaceScoringProjection({
      currentDrivers: drivers,
      officialWinningAverageSpeed: race.official_winning_average_speed,
      participants,
      pickFormat: race.pick_format,
      picks: picksByRace.get(race.id) ?? [],
      raceDriverGroups: driverGroupsByRace.get(race.id) ?? [],
      results: resultsByRace.get(race.id) ?? []
    });
    const officialRaceAverageSpeed =
      race.official_winning_average_speed === null
        ? null
        : scoringNumber(race.official_winning_average_speed);
    const weeklyByUser = new Map(projection.rows.map((row) => [row.userId, row]));
    const raceAveragePoints =
      projection.rows.length === 0
        ? 0
        : projection.rows.reduce((sum, row) => sum + row.points, 0) /
          projection.rows.length;

    const cumulativeRankingInput = participants.map((participant) => {
      const weekly = weeklyByUser.get(participant.id);
      const weeklyPoints = weekly?.points ?? projection.lowestPossibleScore;
      const totalPoints = (cumulativeByUser.get(participant.id) ?? 0) + weeklyPoints;
      cumulativeByUser.set(participant.id, totalPoints);
      raceBreakdownByUser.get(participant.id)?.set(race.id, weeklyPoints);
      return {
        racePoints: weeklyPoints,
        teamName: participant.teamName,
        totalPoints,
        userId: participant.id
      };
    });
    const cumulativeRanks = assignCompetitionRanks(cumulativeRankingInput);
    cumulativeRanks.forEach((row) => {
      standingByRaceUser.set(keyForRaceUser(race.id, row.userId), row.rank);
    });

    participants.forEach((participant) => {
      const weekly = weeklyByUser.get(participant.id);
      const weeklyPoints = weekly?.points ?? projection.lowestPossibleScore;
      const averageSpeedGuess = weekly?.averageSpeed ?? null;
      analyticsRowsByUser.get(participant.id)?.push({
        averageSpeedGuess,
        cumulativePoints: cumulativeByUser.get(participant.id) ?? 0,
        fieldSize: participants.length,
        officialRaceAverageSpeed,
        pointsVsRaceAverage: weeklyPoints - raceAveragePoints,
        raceAveragePoints,
        raceDate: race.race_date,
        raceId: race.id,
        raceName: race.race_name,
        roundNumber: race.round_number,
        submittedPick: weekly?.submittedPick ?? false,
        tiebreakDelta: calculateOfficialSpeedDelta(
          averageSpeedGuess,
          officialRaceAverageSpeed
        ),
        weeklyFinish: weekly?.rank ?? null,
        weeklyPoints
      });
    });
  });

  const latestRace = completedRaces.at(-1) ?? null;
  const previousRace =
    completedRaces.length > 1 ? completedRaces[completedRaces.length - 2] : null;
  const leaderboardRows: LeaderboardRow[] =
    latestRace === null
      ? []
      : participants
          .map((participant) => {
            const currentStanding =
              standingByRaceUser.get(keyForRaceUser(latestRace.id, participant.id)) ?? 0;
            const previousStanding = previousRace
              ? (standingByRaceUser.get(
                  keyForRaceUser(previousRace.id, participant.id)
                ) ?? null)
              : null;

            return {
              change: (previousStanding ?? currentStanding) - currentStanding,
              currentStanding,
              displayName: participant.displayName,
              raceBreakdown: Object.fromEntries(
                raceBreakdownByUser.get(participant.id) ?? []
              ),
              teamName: participant.teamName,
              totalPoints: cumulativeByUser.get(participant.id) ?? 0,
              userId: participant.id
            };
          })
          .sort(
            (left, right) =>
              left.currentStanding - right.currentStanding ||
              right.totalPoints - left.totalPoints ||
              left.teamName.localeCompare(right.teamName)
          );

  const analyticsByUserId = Object.fromEntries(
    participants.map((participant) => {
      const raceRows = analyticsRowsByUser.get(participant.id) ?? [];
      const currentStanding =
        latestRace === null
          ? null
          : (standingByRaceUser.get(keyForRaceUser(latestRace.id, participant.id)) ??
            null);
      const snapshot: ParticipantAnalyticsSnapshot = {
        raceRows,
        summary: buildAnalyticsSummary(raceRows, currentStanding, participants.length),
        teamName: participant.teamName,
        userId: participant.id
      };
      return [participant.id, snapshot];
    })
  );

  return {
    analyticsByUserId,
    leaderboardSnapshot: {
      leaderboardRows,
      raceColumns
    }
  };
};
