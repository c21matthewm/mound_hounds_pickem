import { describe, expect, it } from "vitest";
import type { HallOfFameEntry, HallOfFameSeason } from "@/lib/hall-of-fame";
import { getHallOfFameSeasonStats } from "@/lib/hall-of-fame-stats";

const entry = (finalRank: number, teamName: string, totalPoints: number): HallOfFameEntry => ({
  finalRank,
  teamName,
  totalPoints,
  raceBreakdown: []
});

const season = (overrides: Partial<HallOfFameSeason> = {}): HallOfFameSeason => ({
  championTeamName: "Nicholas - Pickle",
  championTotalPoints: 2548,
  entries: [
    entry(1, "Nicholas - Pickle", 2548),
    entry(2, "Matthew - Matty B", 2543),
    entry(3, "Third place", 2500)
  ],
  finalizedAt: "2026-09-11T12:00:00.000Z",
  participantCount: 3,
  raceCount: 17,
  seasonId: 1,
  seasonYear: 2025,
  ...overrides
});

describe("Hall of Fame season statistics", () => {
  it("calculates the 2025 champion's average and five-point margin without reordering standings", () => {
    const archive = season();
    archive.entries.reverse();
    const original = structuredClone(archive);

    const stats = getHallOfFameSeasonStats(archive);

    expect(stats.pointsPerRace?.toFixed(2)).toBe("149.88");
    expect(stats.winningMargin).toBe(5);
    expect(archive).toEqual(original);
  });

  it("preserves the official champion when the top two finished tied on points", () => {
    const archive = season({
      entries: [entry(2, "Alphabetically first", 2548), entry(1, "Nicholas - Pickle", 2548)],
      participantCount: 2
    });

    expect(getHallOfFameSeasonStats(archive).winningMargin).toBe(0);
    expect(archive.championTeamName).toBe("Nicholas - Pickle");
  });

  it("allows tied runners-up only when their official scores agree", () => {
    const archive = season({
      entries: [
        entry(1, "Nicholas - Pickle", 2548),
        entry(2, "Runner-up A", 2543),
        entry(2, "Runner-up B", 2543)
      ]
    });

    expect(getHallOfFameSeasonStats(archive).winningMargin).toBe(5);
    archive.entries[2].totalPoints = 2540;
    expect(getHallOfFameSeasonStats(archive).winningMargin).toBeNull();
  });

  it("keeps the champion average but omits a margin for absent or incomplete top placements", () => {
    for (const entries of [
      [],
      [entry(1, "Nicholas - Pickle", 2548)],
      [entry(1, "Nicholas - Pickle", 2548), entry(3, "Third place", 2500)],
      [entry(2, "Matthew - Matty B", 2543)]
    ]) {
      const stats = getHallOfFameSeasonStats(season({ entries }));
      expect(stats.pointsPerRace?.toFixed(2)).toBe("149.88");
      expect(stats.winningMargin).toBeNull();
    }
    expect(
      getHallOfFameSeasonStats(
        season({ entries: [entry(1, "Nicholas - Pickle", 2548)], participantCount: 1 })
      ).winningMargin
    ).toBeNull();
  });

  it("omits a margin when champion metadata or archived ranking contradicts the scores", () => {
    const inconsistentArchives = [
      season({ championTeamName: "A different champion" }),
      season({ championTotalPoints: 2549 }),
      season({
        entries: [entry(1, "Nicholas - Pickle", 2548), entry(2, "Runner-up", 2550)]
      }),
      season({
        entries: [
          entry(1, "Nicholas - Pickle", 2548),
          entry(1, "Another first place", 2548),
          entry(2, "Runner-up", 2543)
        ]
      }),
      season({
        entries: [
          entry(1, "Nicholas - Pickle", 2548),
          entry(2, "Runner-up", 2543),
          entry(3, "Higher-scoring third place", 2547)
        ]
      })
    ];

    for (const archive of inconsistentArchives) {
      expect(getHallOfFameSeasonStats(archive).winningMargin).toBeNull();
    }
  });

  it("does not generate averages from unknown or invalid race counts", () => {
    for (const raceCount of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, 1.5]) {
      const stats = getHallOfFameSeasonStats(season({ raceCount }));
      expect(stats.pointsPerRace).toBeNull();
      expect(stats.winningMargin).toBe(5);
    }
  });

  it("rejects invalid points while retaining a genuine zero-point average", () => {
    for (const championTotalPoints of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(getHallOfFameSeasonStats(season({ championTotalPoints }))).toEqual({
        pointsPerRace: null,
        winningMargin: null
      });
    }
    for (const totalPoints of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(
        getHallOfFameSeasonStats(
          season({ entries: [entry(1, "Nicholas - Pickle", 2548), entry(2, "Runner-up", totalPoints)] })
        ).winningMargin
      ).toBeNull();
    }
    expect(
      getHallOfFameSeasonStats(
        season({ championTotalPoints: 0, entries: [], participantCount: 0 })
      ).pointsPerRace
    ).toBe(0);
  });
});
