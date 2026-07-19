export type PickSelection = {
  average_speed: number | string;
  driver_group1_id: number;
  driver_group2_id: number;
  driver_group3_id: number;
  driver_group4_id: number;
  driver_group5_id: number;
  driver_group6_id: number;
  driver_group7_id: number | null;
  driver_group8_id: number | null;
};

export const scoringNumber = (value: number | string | null | undefined): number => {
  if (typeof value === "number") {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isNaN(parsed) ? 0 : parsed;
  }

  return 0;
};

export const pickDriverEntries = (pick: PickSelection): Array<[number, number]> =>
  [
    [pick.driver_group1_id, 1],
    [pick.driver_group2_id, 2],
    [pick.driver_group3_id, 3],
    [pick.driver_group4_id, 4],
    [pick.driver_group5_id, 5],
    [pick.driver_group6_id, 6],
    [pick.driver_group7_id, 7],
    [pick.driver_group8_id, 8]
  ].filter((entry): entry is [number, number] => entry[0] !== null);

export const pickDriverIds = (pick: PickSelection, groupCount: number): number[] =>
  pickDriverEntries(pick)
    .filter(([, groupNumber]) => groupNumber <= groupCount)
    .map(([driverId]) => driverId);

export const pickDriverIdsForGroupCount = (
  pick: PickSelection | null,
  groupCount: number
): Array<number | null> => {
  if (!pick) {
    return Array.from({ length: groupCount }, () => null);
  }

  return [
    pick.driver_group1_id,
    pick.driver_group2_id,
    pick.driver_group3_id,
    pick.driver_group4_id,
    pick.driver_group5_id,
    pick.driver_group6_id,
    pick.driver_group7_id,
    pick.driver_group8_id
  ].slice(0, groupCount);
};

export const scorePickSelection = (
  pick: PickSelection,
  groupCount: number,
  pointsForDriver: (driverId: number) => number | undefined
): number =>
  pickDriverIds(pick, groupCount).reduce(
    (total, driverId) => total + scoringNumber(pointsForDriver(driverId)),
    0
  );

export const computeGroupScoreExtremes = <T>(
  groupCount: number,
  results: T[],
  groupForResult: (result: T) => number | undefined,
  pointsForResult: (result: T) => number | string
): { highest: number; lowest: number } => {
  const pointsByGroup = new Map<number, number[]>();
  for (let groupNumber = 1; groupNumber <= groupCount; groupNumber += 1) {
    pointsByGroup.set(groupNumber, []);
  }

  results.forEach((result) => {
    const groupNumber = groupForResult(result);
    if (!groupNumber || groupNumber < 1 || groupNumber > groupCount) {
      return;
    }

    pointsByGroup.get(groupNumber)?.push(scoringNumber(pointsForResult(result)));
  });

  let highest = 0;
  let lowest = 0;
  for (let groupNumber = 1; groupNumber <= groupCount; groupNumber += 1) {
    const groupPoints = pointsByGroup.get(groupNumber) ?? [];
    if (groupPoints.length > 0) {
      highest += Math.max(...groupPoints);
      lowest += Math.min(...groupPoints);
    }
  }

  return { highest, lowest };
};
