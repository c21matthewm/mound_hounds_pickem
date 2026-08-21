import { describe, expect, it } from "vitest";
import {
  buildRaceScoringProjection,
  type RaceScoringPick
} from "@/lib/race-scoring-model";

const participants = [
  { id: "alpha", teamName: "Alpha" },
  { id: "beta", teamName: "Beta" },
  { id: "missing", teamName: "Missing" }
];

const standardPick = (
  userId: string,
  averageSpeed: number,
  driverIds: number[]
): RaceScoringPick => ({
  average_speed: averageSpeed,
  driver_group1_id: driverIds[0],
  driver_group2_id: driverIds[1],
  driver_group3_id: driverIds[2],
  driver_group4_id: driverIds[3],
  driver_group5_id: driverIds[4],
  driver_group6_id: driverIds[5],
  driver_group7_id: driverIds[6] ?? null,
  driver_group8_id: driverIds[7] ?? null,
  user_id: userId
});

describe("canonical race scoring projection", () => {
  it("uses one historical field snapshot for points, fallback scoring, ranks, and winner", () => {
    const highDrivers = [1, 3, 5, 7, 9, 11];
    const lowDrivers = [2, 4, 6, 8, 10, 12];
    const raceDriverGroups = Array.from({ length: 6 }, (_, index) => [
      { driver_id: highDrivers[index], group_number: index + 1 },
      { driver_id: lowDrivers[index], group_number: index + 1 }
    ]).flat();
    const results = highDrivers
      .map((driverId, index) => ({ driver_id: driverId, points: 60 - index * 5 }))
      .concat(
        lowDrivers.map((driverId, index) => ({ driver_id: driverId, points: 6 - index }))
      );

    const projection = buildRaceScoringProjection({
      // Current groups are intentionally wrong; the race snapshot must remain authoritative.
      currentDrivers: [...highDrivers, ...lowDrivers].map((id) => ({
        group_number: 6,
        id
      })),
      officialWinningAverageSpeed: 101,
      participants,
      pickFormat: "standard",
      picks: [
        standardPick("alpha", 100, highDrivers),
        standardPick("beta", 105, highDrivers)
      ],
      raceDriverGroups,
      results
    });

    expect(projection.highestPossibleScore).toBe(285);
    expect(projection.lowestPossibleScore).toBe(21);
    expect(projection.rows.map((row) => [row.userId, row.points, row.rank])).toEqual([
      ["alpha", 285, 1],
      ["beta", 285, 2],
      ["missing", 21, 3]
    ]);
    expect(projection.rows[2].driverPoints).toEqual([6, 5, 4, 3, 2, 1]);
    expect(projection.rows[2].submittedPick).toBe(false);
    expect(projection.winnerUserId).toBe("alpha");
  });

  it("recalculates every consumer-facing value from corrected results", () => {
    const picks = [
      standardPick("alpha", 100, [1, 3, 5, 7, 9, 11]),
      standardPick("beta", 100, [2, 4, 6, 8, 10, 12])
    ];
    const currentDrivers = Array.from({ length: 12 }, (_, index) => ({
      group_number: Math.floor(index / 2) + 1,
      id: index + 1
    }));
    const baseResults = currentDrivers.map((driver) => ({
      driver_id: driver.id,
      points: driver.id % 2 === 1 ? 10 : 5
    }));
    const input = {
      currentDrivers,
      officialWinningAverageSpeed: 100,
      participants: participants.slice(0, 2),
      pickFormat: "standard" as const,
      picks,
      raceDriverGroups: []
    };

    const original = buildRaceScoringProjection({ ...input, results: baseResults });
    const corrected = buildRaceScoringProjection({
      ...input,
      results: baseResults.map((result) =>
        result.driver_id === 2 ? { ...result, points: 50 } : result
      )
    });

    expect(original.winnerUserId).toBe("alpha");
    expect(corrected.winnerUserId).toBe("beta");
    expect(corrected.rows[0]).toMatchObject({ points: 75, rank: 1, userId: "beta" });
    expect(corrected.pointsByDriverId.get(2)).toBe(50);
  });

  it("includes all eight Indianapolis 500 groups", () => {
    const driverIds = Array.from({ length: 8 }, (_, index) => index + 1);
    const projection = buildRaceScoringProjection({
      currentDrivers: driverIds.map((id) => ({ group_number: id, id })),
      officialWinningAverageSpeed: null,
      participants: participants.slice(0, 1),
      pickFormat: "indy_500",
      picks: [standardPick("alpha", 160, driverIds)],
      raceDriverGroups: [],
      results: driverIds.map((driverId) => ({ driver_id: driverId, points: driverId }))
    });

    expect(projection.groupCount).toBe(8);
    expect(projection.rows[0].driverIds).toEqual(driverIds);
    expect(projection.rows[0].points).toBe(36);
  });

  it("excludes results that cannot be assigned to a valid race group from fallback ranges", () => {
    const projection = buildRaceScoringProjection({
      currentDrivers: [
        { group_number: 1, id: 1 },
        { group_number: 7, id: 3 }
      ],
      officialWinningAverageSpeed: null,
      participants: participants.slice(2),
      pickFormat: "standard",
      picks: [],
      raceDriverGroups: [],
      results: [
        { driver_id: 1, points: 25 },
        { driver_id: 2, points: 99 },
        { driver_id: 3, points: 88 }
      ]
    });

    expect(projection.highestPossibleScore).toBe(25);
    expect(projection.lowestPossibleScore).toBe(25);
    expect(projection.rows[0].points).toBe(25);
  });
});
