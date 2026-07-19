import { describe, expect, it } from "vitest";
import { assignWeeklyRanks, buildOrderedWeeklyRows } from "@/lib/weekly-ranking";

describe("weekly ranking", () => {
  it("uses official average-speed distance to order a top-points tie", () => {
    const rows = buildOrderedWeeklyRows(
      [
        { averageSpeed: 100, points: 150, teamName: "Alpha" },
        { averageSpeed: 102.2, points: 150, teamName: "Beta" },
        { averageSpeed: 101, points: 140, teamName: "Gamma" }
      ],
      102
    );

    expect(rows.map((row) => row.teamName)).toEqual(["Beta", "Alpha", "Gamma"]);
  });

  it("assigns distinct places to the tiebreaked top teams and competition ranks below", () => {
    const rows = assignWeeklyRanks(
      [
        { averageSpeed: 100, points: 150, teamName: "Alpha" },
        { averageSpeed: 101, points: 150, teamName: "Beta" },
        { averageSpeed: null, points: 120, teamName: "Delta" },
        { averageSpeed: null, points: 120, teamName: "Gamma" }
      ],
      101
    );

    expect(rows.map((row) => [row.teamName, row.rank])).toEqual([
      ["Beta", 1],
      ["Alpha", 2],
      ["Delta", 3],
      ["Gamma", 3]
    ]);
  });
});
