type WeeklyRankingRow = {
  averageSpeed: number | null;
  points: number;
  teamName: string;
};

const speedDeltaForSort = (guess: number | null, officialRaceAverageSpeed: number | null): number => {
  if (guess === null || officialRaceAverageSpeed === null) {
    return Number.POSITIVE_INFINITY;
  }

  return Math.abs(guess - officialRaceAverageSpeed);
};

const compareByPointsThenTeamName = <T extends WeeklyRankingRow>(a: T, b: T): number => {
  if (b.points !== a.points) {
    return b.points - a.points;
  }

  return a.teamName.localeCompare(b.teamName);
};

const compareTopTieByOfficialSpeedThenTeamName = <T extends WeeklyRankingRow>(
  a: T,
  b: T,
  officialRaceAverageSpeed: number | null
): number => {
  const aDelta = speedDeltaForSort(a.averageSpeed, officialRaceAverageSpeed);
  const bDelta = speedDeltaForSort(b.averageSpeed, officialRaceAverageSpeed);
  if (aDelta !== bDelta) {
    return aDelta - bDelta;
  }

  return a.teamName.localeCompare(b.teamName);
};

export const buildOrderedWeeklyRows = <T extends WeeklyRankingRow>(
  rows: T[],
  officialRaceAverageSpeed: number | null
): T[] => {
  if (rows.length === 0) {
    return [];
  }

  const topPoints = rows.reduce((max, row) => Math.max(max, row.points), Number.NEGATIVE_INFINITY);
  const topRows = rows.filter((row) => row.points === topPoints);
  const remainingRows = rows.filter((row) => row.points !== topPoints);

  const orderedTopRows =
    topRows.length > 1
      ? [...topRows].sort((a, b) =>
          compareTopTieByOfficialSpeedThenTeamName(a, b, officialRaceAverageSpeed)
        )
      : [...topRows];

  const orderedRemainingRows = [...remainingRows].sort(compareByPointsThenTeamName);

  return [...orderedTopRows, ...orderedRemainingRows];
};

export const assignWeeklyRanks = <T extends WeeklyRankingRow>(
  rows: T[],
  officialRaceAverageSpeed: number | null
): Array<T & { rank: number }> => {
  const sorted = buildOrderedWeeklyRows(rows, officialRaceAverageSpeed);
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

    ranked.push({ ...row, rank });
    previousPoints = row.points;
    previousRank = rank;
  });

  return ranked;
};

export const calculateOfficialSpeedDelta = (
  guess: number | null,
  officialRaceAverageSpeed: number | null
): number | null => {
  if (guess === null || officialRaceAverageSpeed === null) {
    return null;
  }

  return Math.abs(guess - officialRaceAverageSpeed);
};

export const isTopPointsTie = (
  rows: Array<{ points: number }>,
  selectedPoints: number | null
): boolean => {
  if (rows.length === 0 || selectedPoints === null) {
    return false;
  }

  const topPoints = rows.reduce((max, row) => Math.max(max, row.points), Number.NEGATIVE_INFINITY);
  if (selectedPoints !== topPoints) {
    return false;
  }

  const topTieCount = rows.filter((row) => row.points === topPoints).length;
  return topTieCount > 1;
};
