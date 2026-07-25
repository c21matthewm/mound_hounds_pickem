export type RacePickFormat = "standard" | "indy_500";

export type PickFieldDriverOrder = {
  currentStanding: number;
  driverName: string;
  qualifyingPosition?: number | null;
};

export const STANDARD_PICK_GROUP_COUNT = 6;
export const INDY_500_PICK_GROUP_COUNT = 8;
export const INDY_500_QUALIFYING_FIELD_SIZE = 33;
export const MAX_AVERAGE_SPEED_MPH = 300;

export const isRacePickFormat = (value: string): value is RacePickFormat =>
  value === "standard" || value === "indy_500";

export const normalizeRacePickFormat = (value: string | null | undefined): RacePickFormat =>
  value === "indy_500" ? "indy_500" : "standard";

export const pickGroupCountForFormat = (format: RacePickFormat): number =>
  format === "indy_500" ? INDY_500_PICK_GROUP_COUNT : STANDARD_PICK_GROUP_COUNT;

export const groupNumbersForCount = (count: number): number[] =>
  Array.from({ length: count }, (_, index) => index + 1);

export const groupNumbersForPickFormat = (format: RacePickFormat): number[] =>
  groupNumbersForCount(pickGroupCountForFormat(format));

export const isValidAverageSpeedMph = (value: number): boolean =>
  Number.isFinite(value) && value > 0 && value <= MAX_AVERAGE_SPEED_MPH;

export const comparePickFieldDriverOrder = (
  format: RacePickFormat,
  left: PickFieldDriverOrder,
  right: PickFieldDriverOrder
): number => {
  if (format === "indy_500") {
    const qualifyingDifference =
      (left.qualifyingPosition ?? Number.MAX_SAFE_INTEGER) -
      (right.qualifyingPosition ?? Number.MAX_SAFE_INTEGER);
    if (qualifyingDifference !== 0) {
      return qualifyingDifference;
    }
  }

  const standingDifference = left.currentStanding - right.currentStanding;
  return standingDifference !== 0
    ? standingDifference
    : left.driverName.localeCompare(right.driverName);
};

export const pickLockAtForRace = (race: {
  pick_format?: string | null;
  qualifying_start_at: string;
  race_date: string;
}): string =>
  normalizeRacePickFormat(race.pick_format) === "indy_500"
    ? race.race_date
    : race.qualifying_start_at;

export const indy500GroupForQualifyingPosition = (position: number): number | null => {
  if (!Number.isInteger(position) || position < 1 || position > INDY_500_QUALIFYING_FIELD_SIZE) {
    return null;
  }

  return Math.min(INDY_500_PICK_GROUP_COUNT, Math.floor((position - 1) / 4) + 1);
};
