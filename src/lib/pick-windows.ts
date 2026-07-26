export type PickWindowRace = {
  id: number;
  pick_window_key: string;
  race_date: string;
  round_number: number;
};

const byRound = <T extends PickWindowRace>(left: T, right: T): number =>
  left.round_number - right.round_number || left.id - right.id;

export const racesInPickWindow = <T extends PickWindowRace>(
  races: readonly T[],
  anchor: T
): T[] =>
  races
    .filter((race) => race.pick_window_key === anchor.pick_window_key)
    .sort(byRound);

export const nextPickWindow = <T extends PickWindowRace>(
  races: readonly T[],
  now: Date
): T[] => {
  const nextRace =
    [...races]
      .sort(byRound)
      .find((race) => Date.parse(race.race_date) > now.getTime()) ?? null;

  return nextRace ? racesInPickWindow(races, nextRace) : [];
};

export const pickWindowRoundLabel = (races: readonly PickWindowRace[]): string => {
  const rounds = races.map((race) => race.round_number).sort((left, right) => left - right);
  if (rounds.length === 0) {
    return "";
  }
  if (rounds.length === 1) {
    return `R${rounds[0]}`;
  }
  return `R${rounds[0]}-R${rounds[rounds.length - 1]}`;
};

export const pickWindowDisplayName = (
  races: readonly PickWindowRace[],
  fallbackRaceName: string
): string => (races.length > 1 ? "Doubleheader weekend" : fallbackRaceName);
