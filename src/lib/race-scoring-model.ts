import {
  normalizeRacePickFormat,
  pickGroupCountForFormat,
  type RacePickFormat
} from "@/lib/race-format";
import {
  pickDriverEntries,
  pickDriverIdsForGroupCount,
  scorePickSelection,
  scoringNumber,
  type PickSelection
} from "@/lib/scoring-engine";
import { assignWeeklyRanks } from "@/lib/weekly-ranking";

export type RaceScoringDriver = {
  group_number: number;
  id: number;
};

export type RaceScoringParticipant = {
  id: string;
  teamName: string;
};

export type RaceScoringPick = PickSelection & {
  user_id: string;
};

export type RaceScoringResult = {
  driver_id: number;
  points: number | string;
};

export type RaceScoringDriverGroup = {
  driver_id: number;
  group_number: number;
};

export type RaceScoringRow = {
  averageSpeed: number | null;
  driverIds: Array<number | null>;
  driverPoints: Array<number | null>;
  points: number;
  rank: number;
  submittedPick: boolean;
  teamName: string;
  userId: string;
};

export type RaceScoringProjection = {
  groupCount: number;
  highestPossibleScore: number;
  lowestPossibleScore: number;
  maximumPointsByGroup: ReadonlyMap<number, number>;
  minimumPointsByGroup: ReadonlyMap<number, number>;
  pointsByDriverId: ReadonlyMap<number, number>;
  rows: RaceScoringRow[];
  winnerUserId: string | null;
};

type BuildRaceScoringProjectionInput = {
  currentDrivers: RaceScoringDriver[];
  officialWinningAverageSpeed: number | string | null;
  participants: RaceScoringParticipant[];
  pickFormat: RacePickFormat;
  picks: RaceScoringPick[];
  raceDriverGroups: RaceScoringDriverGroup[];
  results: RaceScoringResult[];
};

const buildPickByUserId = (picks: RaceScoringPick[]): Map<string, RaceScoringPick> => {
  const pickByUserId = new Map<string, RaceScoringPick>();
  picks.forEach((pick) => {
    pickByUserId.set(pick.user_id, pick);
  });
  return pickByUserId;
};

const buildPickedDriverGroupById = (picks: RaceScoringPick[]): Map<number, number> => {
  const groupByDriverId = new Map<number, number>();
  picks.forEach((pick) => {
    pickDriverEntries(pick).forEach(([driverId, groupNumber]) => {
      if (!groupByDriverId.has(driverId)) {
        groupByDriverId.set(driverId, groupNumber);
      }
    });
  });
  return groupByDriverId;
};

export const buildRaceScoringProjection = ({
  currentDrivers,
  officialWinningAverageSpeed,
  participants,
  pickFormat,
  picks,
  raceDriverGroups,
  results
}: BuildRaceScoringProjectionInput): RaceScoringProjection => {
  const groupCount = pickGroupCountForFormat(normalizeRacePickFormat(pickFormat));
  const currentDriverGroupById = new Map(
    currentDrivers.map((driver) => [driver.id, driver.group_number])
  );
  const raceDriverGroupById = new Map(
    raceDriverGroups.map((row) => [row.driver_id, row.group_number])
  );
  const pickedDriverGroupById = buildPickedDriverGroupById(picks);
  const pointsByDriverId = new Map<number, number>();
  const maximumPointsByGroup = new Map<number, number>();
  const minimumPointsByGroup = new Map<number, number>();

  results.forEach((result) => {
    const points = scoringNumber(result.points);
    pointsByDriverId.set(result.driver_id, points);

    // Preserve the race-week field first; pick data and current groups only repair older gaps.
    const groupNumber =
      raceDriverGroupById.get(result.driver_id) ??
      pickedDriverGroupById.get(result.driver_id) ??
      currentDriverGroupById.get(result.driver_id);
    if (!groupNumber || groupNumber < 1 || groupNumber > groupCount) {
      return;
    }

    const currentMinimum = minimumPointsByGroup.get(groupNumber);
    if (currentMinimum === undefined || points < currentMinimum) {
      minimumPointsByGroup.set(groupNumber, points);
    }
    const currentMaximum = maximumPointsByGroup.get(groupNumber);
    if (currentMaximum === undefined || points > currentMaximum) {
      maximumPointsByGroup.set(groupNumber, points);
    }
  });

  const highestPossibleScore = Array.from(
    { length: groupCount },
    (_, index) => maximumPointsByGroup.get(index + 1) ?? 0
  ).reduce((total, points) => total + points, 0);
  const lowestPossibleScore = Array.from(
    { length: groupCount },
    (_, index) => minimumPointsByGroup.get(index + 1) ?? 0
  ).reduce((total, points) => total + points, 0);
  const pickByUserId = buildPickByUserId(picks);
  const officialSpeed =
    officialWinningAverageSpeed === null
      ? null
      : scoringNumber(officialWinningAverageSpeed);

  const rankedRows = assignWeeklyRanks(
    participants.map((participant) => {
      const pick = pickByUserId.get(participant.id) ?? null;
      const driverIds = pickDriverIdsForGroupCount(pick, groupCount);
      const driverPoints = driverIds.map((driverId, index) => {
        if (driverId !== null) {
          return pointsByDriverId.get(driverId) ?? 0;
        }
        return pick ? null : (minimumPointsByGroup.get(index + 1) ?? null);
      });

      return {
        averageSpeed: pick ? scoringNumber(pick.average_speed) : null,
        driverIds,
        driverPoints,
        points: pick
          ? scorePickSelection(pick, groupCount, (driverId) => pointsByDriverId.get(driverId))
          : lowestPossibleScore,
        submittedPick: pick !== null,
        teamName: participant.teamName,
        userId: participant.id
      };
    }),
    officialSpeed
  );

  return {
    groupCount,
    highestPossibleScore,
    lowestPossibleScore,
    maximumPointsByGroup,
    minimumPointsByGroup,
    pointsByDriverId,
    rows: rankedRows,
    winnerUserId: rankedRows[0]?.userId ?? null
  };
};
