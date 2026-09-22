import type { HallOfFameSeason } from "@/lib/hall-of-fame";

export function getHallOfFameSeasonStats(season: HallOfFameSeason): {
  pointsPerRace: number | null;
  winningMargin: number | null;
} {
  const hasChampionPoints =
    Number.isFinite(season.championTotalPoints) && season.championTotalPoints >= 0;
  const pointsPerRace =
    hasChampionPoints && Number.isInteger(season.raceCount) && season.raceCount > 0
      ? season.championTotalPoints / season.raceCount
      : null;
  const champions = season.entries.filter((entry) => entry.finalRank === 1);
  const runnersUp = season.entries.filter((entry) => entry.finalRank === 2);
  const champion = champions[0];
  const runnerUp = runnersUp[0];

  // Use the archived placements, never array order or a newly calculated tiebreak.
  // Omit the margin when the archive cannot establish a consistent top two.
  const hasConsistentPlacements =
    hasChampionPoints &&
    season.participantCount >= 2 &&
    champions.length === 1 &&
    champion.teamName === season.championTeamName &&
    champion.totalPoints === season.championTotalPoints &&
    runnerUp !== undefined &&
    runnersUp.every((entry) => entry.totalPoints === runnerUp.totalPoints) &&
    season.entries.every(
      (entry) =>
        Number.isInteger(entry.finalRank) &&
        entry.finalRank > 0 &&
        Number.isFinite(entry.totalPoints) &&
        entry.totalPoints >= 0 &&
        entry.totalPoints <= season.championTotalPoints &&
        (entry.finalRank === 1 || entry.totalPoints <= runnerUp.totalPoints)
    );

  return {
    pointsPerRace,
    winningMargin: hasConsistentPlacements
      ? season.championTotalPoints - runnerUp.totalPoints
      : null
  };
}
