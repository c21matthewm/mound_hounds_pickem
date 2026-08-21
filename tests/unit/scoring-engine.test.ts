import { describe, expect, it } from "vitest";
import {
  pickDriverIds,
  scorePickSelection,
  type PickSelection
} from "@/lib/scoring-engine";

const pick: PickSelection = {
  average_speed: 135.501,
  driver_group1_id: 1,
  driver_group2_id: 2,
  driver_group3_id: 3,
  driver_group4_id: 4,
  driver_group5_id: 5,
  driver_group6_id: 6,
  driver_group7_id: 7,
  driver_group8_id: 8
};

describe("scoring engine", () => {
  it("scores only six groups for a standard race", () => {
    expect(pickDriverIds(pick, 6)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(scorePickSelection(pick, 6, (driverId) => driverId * 10)).toBe(210);
  });

  it("includes all eight groups for the Indianapolis 500", () => {
    expect(pickDriverIds(pick, 8)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(scorePickSelection(pick, 8, () => 5)).toBe(40);
  });
});
