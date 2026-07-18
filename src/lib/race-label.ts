export type RaceIdentity = {
  raceName: string;
  roundNumber: number;
  seasonYear?: number;
};

export const compactRoundLabel = (roundNumber: number): string => `R${roundNumber}`;

export const roundLabel = (roundNumber: number): string => `Round ${roundNumber}`;

export const raceOptionLabel = ({ raceName, roundNumber }: RaceIdentity): string =>
  `${compactRoundLabel(roundNumber)} · ${raceName}`;

export const raceContextLabel = ({
  roundNumber,
  seasonYear
}: Pick<RaceIdentity, "roundNumber" | "seasonYear">): string =>
  seasonYear ? `${roundLabel(roundNumber)} · ${seasonYear}` : roundLabel(roundNumber);
