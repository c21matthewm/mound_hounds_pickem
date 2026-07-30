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
});
