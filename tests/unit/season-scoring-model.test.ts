import { describe, expect, it } from "vitest";
import {
  buildSeasonScoringModel,
  type SeasonScoringParticipant,
  type SeasonScoringPick,
  type SeasonScoringRace,
  type SeasonScoringResult
} from "@/lib/season-scoring-model";

const participants: SeasonScoringParticipant[] = Array.from(
  { length: 90 },
  (_, index) => ({
    displayName: `Player ${index + 1} - Team ${index + 1}`,
    id: `user-${String(index + 1).padStart(3, "0")}`,
    teamName: `Team ${String(index + 1).padStart(3, "0")}`
  })
);

const drivers = Array.from({ length: 32 }, (_, index) => ({
  group_number: Math.floor(index / 4) + 1,
  id: index + 1
}));

const races: SeasonScoringRace[] = Array.from({ length: 18 }, (_, index) => ({
  id: index + 1,
  official_winning_average_speed: 120 + index / 10,
  pick_format: index === 7 ? "indy_500" : "standard",
  race_date: `2027-${String(Math.floor(index / 2) + 3).padStart(2, "0")}-${String(
    (index % 2) * 10 + 5
  ).padStart(2, "0")}T18:00:00.000Z`,
  race_name: index === 7 ? "Indianapolis 500" : `Grand Prix ${index + 1}`,
  round_number: index + 1
}));

const results: SeasonScoringResult[] = races.flatMap((race) => {
  const driverCount = race.pick_format === "indy_500" ? 32 : 24;
  return Array.from({ length: driverCount }, (_, index) => ({
    driver_id: index + 1,
    points: 100 - index + race.round_number,
    race_id: race.id
  }));
});

const pickFor = (
  participantIndex: number,
  race: SeasonScoringRace
): SeasonScoringPick => {
  const offset = participantIndex % 4;
  const selectedDriver = (groupNumber: number): number =>
    (groupNumber - 1) * 4 + offset + 1;

  return {
    average_speed: 120 + race.round_number / 10 + participantIndex / 1000,
    driver_group1_id: selectedDriver(1),
    driver_group2_id: selectedDriver(2),
    driver_group3_id: selectedDriver(3),
    driver_group4_id: selectedDriver(4),
    driver_group5_id: selectedDriver(5),
    driver_group6_id: selectedDriver(6),
    driver_group7_id:
      race.pick_format === "indy_500" ? selectedDriver(7) : null,
    driver_group8_id:
      race.pick_format === "indy_500" ? selectedDriver(8) : null,
    race_id: race.id,
    user_id: participants[participantIndex].id
  };
};

const picks = participants.flatMap((_, participantIndex) =>
  races
    .filter(
      (race) =>
        !(participantIndex === 0 && race.id === 5)
    )
    .map((race) => pickFor(participantIndex, race))
);

const raceDriverGroups = races.flatMap((race) =>
  drivers
    .filter((driver) => race.pick_format === "indy_500" || driver.group_number <= 6)
    .map((driver) => ({
      driver_id: driver.id,
      group_number: driver.group_number,
      race_id: race.id
    }))
);

// Each team's score comes from its group-one driver; the other groups score zero.
// This isolates cumulative ranks while exercising the actual race projection.
const modelForRaceScores = (
  pointsByRace: number[][],
  schedule: SeasonScoringRace[] = races.slice(0, pointsByRace.length)
) => {
  const selectedRaces = races.slice(0, pointsByRace.length);
  const selectedParticipants = participants.slice(0, pointsByRace[0]?.length ?? 2);
  return buildSeasonScoringModel({
    drivers,
    participants: selectedParticipants,
    picks: selectedParticipants.flatMap((_, index) =>
      selectedRaces.map((race) => pickFor(index, race))
    ),
    raceDriverGroups: raceDriverGroups.filter((row) => row.race_id <= selectedRaces.length),
    races: schedule,
    results: selectedRaces.flatMap((race, index) =>
      drivers.filter((driver) => driver.group_number <= 6).map((driver) => ({
        driver_id: driver.id,
        points: driver.group_number === 1 ? (pointsByRace[index][driver.id - 1] ?? 0) : 0,
        race_id: race.id
      }))
    )
  });
};

describe("season scoring model", () => {
  it("builds one consistent 90-team, 18-race model for standings and analytics", () => {
    const model = buildSeasonScoringModel({
      drivers,
      participants,
      picks,
      raceDriverGroups,
      races,
      results
    });

    expect(model.leaderboardSnapshot.raceColumns).toHaveLength(18);
    expect(model.leaderboardSnapshot.leaderboardRows).toHaveLength(90);
    expect(Object.keys(model.analyticsByUserId)).toHaveLength(90);

    model.leaderboardSnapshot.leaderboardRows.forEach((standing) => {
      const analytics = model.analyticsByUserId[standing.userId];
      expect(analytics.raceRows).toHaveLength(18);
      expect(analytics.summary.totalPoints).toBe(standing.totalPoints);
      expect(analytics.summary.currentStanding).toBe(standing.currentStanding);
    });
  });

  it("applies the per-group minimum when a participant misses a race", () => {
    const model = buildSeasonScoringModel({
      drivers,
      participants,
      picks,
      raceDriverGroups,
      races,
      results
    });
    const missingRace = model.analyticsByUserId[participants[0].id].raceRows.find(
      (race) => race.raceId === 5
    );
    const expectedFallback = Array.from(
      { length: 6 },
      (_, index) => 100 - ((index + 1) * 4 - 1) + 5
    ).reduce((sum, points) => sum + points, 0);

    expect(missingRace?.submittedPick).toBe(false);
    expect(missingRace?.weeklyPoints).toBe(expectedFallback);
  });

  it("awards every prior-race fallback to a participant who joins without historical picks", () => {
    const lateParticipant = participants[0];
    const model = buildSeasonScoringModel({
      drivers,
      participants: [lateParticipant],
      picks: [],
      raceDriverGroups,
      races,
      results
    });
    const analytics = model.analyticsByUserId[lateParticipant.id];

    expect(analytics.raceRows).toHaveLength(races.length);
    expect(analytics.raceRows.every((race) => race.submittedPick === false)).toBe(true);
    expect(analytics.summary.totalPoints).toBeGreaterThan(0);
    expect(model.leaderboardSnapshot.leaderboardRows[0].totalPoints).toBe(
      analytics.summary.totalPoints
    );
  });

  it("includes all eight Indy groups and recalculates cleanly after a correction", () => {
    const initial = buildSeasonScoringModel({
      drivers,
      participants,
      picks,
      raceDriverGroups,
      races,
      results
    });
    const participant = participants[1];
    const indyRace = initial.analyticsByUserId[participant.id].raceRows.find(
      (race) => race.raceId === 8
    );
    const standardRace = initial.analyticsByUserId[participant.id].raceRows.find(
      (race) => race.raceId === 7
    );
    expect(indyRace!.weeklyPoints).toBeGreaterThan(standardRace!.weeklyPoints);

    const correctedResults = results.map((result) =>
      result.race_id === 18 && result.driver_id === 2
        ? { ...result, points: Number(result.points) + 100 }
        : result
    );
    const corrected = buildSeasonScoringModel({
      drivers,
      participants,
      picks,
      raceDriverGroups,
      races,
      results: correctedResults
    });

    expect(
      corrected.analyticsByUserId[participant.id].summary.totalPoints
    ).toBe(initial.analyticsByUserId[participant.id].summary.totalPoints + 100);
    expect(
      corrected.leaderboardSnapshot.leaderboardRows.find(
        (row) => row.userId === participant.id
      )?.totalPoints
    ).toBe(corrected.analyticsByUserId[participant.id].summary.totalPoints);
  });

  it("uses average speed only to order the top weekly tie, not cumulative points", () => {
    const tiedParticipants = participants.slice(0, 2);
    const tiedRace = races[0];
    const tiedPicks = tiedParticipants.map((participant, index) => ({
      ...pickFor(0, tiedRace),
      average_speed: index === 0 ? 120.1 : 130,
      user_id: participant.id
    }));
    const model = buildSeasonScoringModel({
      drivers,
      participants: tiedParticipants,
      picks: tiedPicks,
      raceDriverGroups: raceDriverGroups.filter((row) => row.race_id === tiedRace.id),
      races: [tiedRace],
      results: results.filter((result) => result.race_id === tiedRace.id)
    });

    expect(model.analyticsByUserId[tiedParticipants[0].id].summary.averageFinish).toBe(1);
    expect(model.analyticsByUserId[tiedParticipants[1].id].summary.averageFinish).toBe(2);
    expect(model.leaderboardSnapshot.leaderboardRows.map((row) => row.currentStanding)).toEqual([
      1,
      1
    ]);
  });

  it("breaks equal season totals with the latest race and keeps analytics and movement consistent", () => {
    const model = modelForRaceScores([[60, 40, 30, 10], [40, 60, 20, 0]]);
    const rows = model.leaderboardSnapshot.leaderboardRows;

    expect(rows.map((row) => [row.teamName, row.totalPoints, row.currentStanding, row.change])).toEqual([
      [participants[1].teamName, 100, 1, 1],
      [participants[0].teamName, 100, 2, -1],
      [participants[2].teamName, 50, 3, 0],
      [participants[3].teamName, 10, 4, 0]
    ]);
    rows.forEach((row) => {
      expect(model.analyticsByUserId[row.userId].summary.currentStanding).toBe(row.currentStanding);
      expect(model.analyticsByUserId[row.userId].summary.totalPoints).toBe(row.totalPoints);
    });
    expect(model.analyticsByUserId[participants[0].id].raceRows.map((row) => row.weeklyFinish)).toEqual([1, 2]);
    expect(model.analyticsByUserId[participants[1].id].raceRows.map((row) => row.weeklyFinish)).toEqual([2, 1]);
  });

  it("uses the second-to-last race when totals and the latest race match", () => {
    const model = modelForRaceScores([[60, 40, 30, 10], [40, 60, 20, 0], [20, 20, 10, 0]]);
    const leaders = model.leaderboardSnapshot.leaderboardRows.slice(0, 2);

    expect(leaders.map((row) => [row.teamName, row.totalPoints, row.currentStanding, row.change])).toEqual([
      [participants[1].teamName, 120, 1, 0],
      [participants[0].teamName, 120, 2, 0]
    ]);
    leaders.forEach((row) => {
      expect(model.analyticsByUserId[row.userId].summary.currentStanding).toBe(row.currentStanding);
    });
  });

  it("prioritizes total points over the latest race and the latest race over the previous one", () => {
    const model = modelForRaceScores([[130, 40, 30, 50], [0, 60, 40, 30], [0, 20, 50, 30]]);

    expect(model.leaderboardSnapshot.leaderboardRows.map((row) => [row.teamName, row.totalPoints])).toEqual([
      [participants[0].teamName, 130],
      [participants[2].teamName, 120],
      [participants[1].teamName, 120],
      [participants[3].teamName, 110]
    ]);
  });

  it("resolves a three-way points tie using both race comparisons", () => {
    const model = modelForRaceScores([[40, 50, 60], [40, 50, 40], [40, 20, 20]]);

    expect(model.leaderboardSnapshot.leaderboardRows.map((row) => [row.teamName, row.currentStanding])).toEqual([
      [participants[0].teamName, 1],
      [participants[1].teamName, 2],
      [participants[2].teamName, 3]
    ]);
  });

  it("applies the same tiebreak below first place", () => {
    const model = modelForRaceScores([[100, 60, 40, 10], [100, 40, 60, 0]]);

    expect(model.leaderboardSnapshot.leaderboardRows.map((row) => [row.teamName, row.currentStanding])).toEqual([
      [participants[0].teamName, 1],
      [participants[2].teamName, 2],
      [participants[1].teamName, 3],
      [participants[3].teamName, 4]
    ]);
  });

  it("stops after the last two races even when an earlier race would break the tie", () => {
    const model = modelForRaceScores([[60, 40, 10], [40, 60, 0], [20, 20, 0], [10, 10, 0]]);

    expect(model.leaderboardSnapshot.leaderboardRows.map((row) => [row.teamName, row.currentStanding])).toEqual([
      [participants[0].teamName, 1],
      [participants[1].teamName, 1],
      [participants[2].teamName, 3]
    ]);
  });

  it("retains competition ranks for unresolved ties below the champion", () => {
    const model = modelForRaceScores([[100, 60, 40, 0], [100, 40, 60, 0], [100, 20, 20, 0], [100, 10, 10, 0]]);
    expect(model.leaderboardSnapshot.leaderboardRows.map((row) => row.currentStanding)).toEqual([1, 2, 2, 4]);
  });

  it("treats a zero-point final race as a score and still uses the previous race", () => {
    const model = modelForRaceScores([[60, 40], [40, 60], [0, 0]]);
    expect(model.leaderboardSnapshot.leaderboardRows.map((row) => row.teamName)).toEqual([
      participants[1].teamName, participants[0].teamName
    ]);
  });

  it("uses completed season rounds from an unsorted schedule without including future races", () => {
    const schedule = [races[4], races[2], races[0], races[3], races[1]];
    const original = structuredClone(schedule);
    const model = modelForRaceScores([[60, 40], [40, 60], [20, 20]], schedule);
    expect(model.leaderboardSnapshot.raceColumns.map((race) => race.raceId)).toEqual([1, 2, 3]);
    expect(model.leaderboardSnapshot.leaderboardRows.map((row) => row.teamName)).toEqual([
      participants[1].teamName, participants[0].teamName
    ]);
    expect(schedule).toEqual(original);
  });

  it("has no standings before any race has results", () => {
    const model = modelForRaceScores([], races);
    expect(model.leaderboardSnapshot.leaderboardRows).toEqual([]);
    expect(model.analyticsByUserId[participants[0].id].summary.currentStanding).toBeNull();
  });

  it("recalculates the second-to-last-race tiebreak after a correction without changing old snapshots", () => {
    const original = modelForRaceScores([[70, 30], [20, 60], [10, 10]]);
    const corrected = modelForRaceScores([[30, 70], [60, 20], [10, 10]]);

    expect(corrected.leaderboardSnapshot.leaderboardRows.map((row) => [row.teamName, row.currentStanding])).toEqual([
      [participants[0].teamName, 1], [participants[1].teamName, 2]
    ]);
    expect(original.leaderboardSnapshot.leaderboardRows.map((row) => [row.teamName, row.currentStanding])).toEqual([
      [participants[1].teamName, 1], [participants[0].teamName, 2]
    ]);
    expect(original.leaderboardSnapshot.leaderboardRows.every((row) => row.totalPoints === 100)).toBe(true);
    expect(corrected.leaderboardSnapshot.leaderboardRows.every((row) => row.totalPoints === 100)).toBe(true);
  });
});
