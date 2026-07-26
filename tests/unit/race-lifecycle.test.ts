import { describe, expect, it } from "vitest";
import {
  comparePickFieldDriverOrder,
  groupNumbersForPickFormat,
  indy500GroupForQualifyingPosition,
  isValidAverageSpeedMph,
  pickLockAtForRace
} from "../../src/lib/race-format";
import {
  nextPickWindow,
  pickWindowDisplayName,
  pickWindowRoundLabel,
  racesInPickWindow
} from "../../src/lib/pick-windows";
import { isRegisteredForSeason } from "../../src/lib/season-participation";

describe("race lifecycle contracts", () => {
  const qualifyingStartAt = "2027-05-22T15:00:00.000Z";
  const raceDate = "2027-05-30T16:00:00.000Z";

  it("locks standard picks at qualifying and Indy 500 picks at race start", () => {
    expect(
      pickLockAtForRace({
        pick_format: "standard",
        qualifying_start_at: qualifyingStartAt,
        race_date: raceDate
      })
    ).toBe(qualifyingStartAt);
    expect(
      pickLockAtForRace({
        pick_format: "indy_500",
        qualifying_start_at: qualifyingStartAt,
        race_date: raceDate
      })
    ).toBe(raceDate);
  });

  it("keeps the correct group contracts for standard and Indy fields", () => {
    expect(groupNumbersForPickFormat("standard")).toEqual([1, 2, 3, 4, 5, 6]);
    expect(groupNumbersForPickFormat("indy_500")).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(indy500GroupForQualifyingPosition(1)).toBe(1);
    expect(indy500GroupForQualifyingPosition(32)).toBe(8);
    expect(indy500GroupForQualifyingPosition(33)).toBe(8);
    expect(indy500GroupForQualifyingPosition(34)).toBeNull();
  });

  it("rejects impossible average speed submissions", () => {
    expect(isValidAverageSpeedMph(135.501)).toBe(true);
    expect(isValidAverageSpeedMph(0)).toBe(false);
    expect(isValidAverageSpeedMph(300.001)).toBe(false);
    expect(isValidAverageSpeedMph(Number.NaN)).toBe(false);
  });

  it("orders standard fields by standing and Indy fields by qualifying position", () => {
    const field = [
      {
        currentStanding: 1,
        driverName: "Championship Leader",
        qualifyingPosition: 4
      },
      {
        currentStanding: 4,
        driverName: "Fourth in Points",
        qualifyingPosition: 1
      }
    ];

    expect(
      [...field].sort((left, right) =>
        comparePickFieldDriverOrder("standard", left, right)
      ).map((driver) => driver.driverName)
    ).toEqual(["Championship Leader", "Fourth in Points"]);
    expect(
      [...field].sort((left, right) =>
        comparePickFieldDriverOrder("indy_500", left, right)
      ).map((driver) => driver.driverName)
    ).toEqual(["Fourth in Points", "Championship Leader"]);
  });

  it("treats only the registered state as active season participation", () => {
    expect(
      isRegisteredForSeason({
        decidedAt: "2027-01-01T00:00:00.000Z",
        profileId: "profile-1",
        registeredAt: "2027-01-01T00:00:00.000Z",
        seasonId: 2027,
        status: "registered"
      })
    ).toBe(true);
    expect(
      isRegisteredForSeason({
        decidedAt: "2027-01-01T00:00:00.000Z",
        profileId: "profile-1",
        registeredAt: null,
        seasonId: 2027,
        status: "declined"
      })
    ).toBe(false);
    expect(isRegisteredForSeason(null)).toBe(false);
  });

  it("keeps adjacent doubleheader races in one pick window", () => {
    const races = [
      {
        id: 14,
        pick_window_key: "doubleheader",
        race_date: "2027-07-24T20:00:00.000Z",
        round_number: 14
      },
      {
        id: 15,
        pick_window_key: "doubleheader",
        race_date: "2027-07-25T20:00:00.000Z",
        round_number: 15
      },
      {
        id: 16,
        pick_window_key: "next-race",
        race_date: "2027-08-01T20:00:00.000Z",
        round_number: 16
      }
    ];

    expect(racesInPickWindow(races, races[1]).map((race) => race.id)).toEqual([14, 15]);
    expect(nextPickWindow(races, new Date("2027-07-20T00:00:00.000Z")).map((race) => race.id))
      .toEqual([14, 15]);
    expect(nextPickWindow(races, new Date("2027-07-24T21:00:00.000Z")).map((race) => race.id))
      .toEqual([14, 15]);
    expect(nextPickWindow(races, new Date("2027-07-25T21:00:00.000Z")).map((race) => race.id))
      .toEqual([16]);
    expect(pickWindowRoundLabel(races.slice(0, 2))).toBe("R14-R15");
    expect(pickWindowDisplayName(races.slice(0, 2), "Saturday race")).toBe(
      "Doubleheader weekend"
    );
    expect(pickWindowDisplayName(races.slice(2), "Next race")).toBe("Next race");
  });
});
