export type RacePickFormat = "standard" | "indy_500";

export const STANDARD_PICK_GROUP_COUNT = 6;
export const INDY_500_PICK_GROUP_COUNT = 8;
export const INDY_500_QUALIFYING_FIELD_SIZE = 33;

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
