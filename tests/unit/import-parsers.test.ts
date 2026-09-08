import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseChampionshipStandingsPaste } from "@/lib/championship-standings";
import { normalizeDriverName, parseIndycarResultsPaste } from "@/lib/indycar-results";

const raceResultsSample = readFileSync(
  new URL("../../docs/examples/indycar-race-results-sample.txt", import.meta.url),
  "utf8"
);

const withWinnerSpeed = (speed: string): string =>
  raceResultsSample.replace("\t156.342\t", `\t${speed}\t`);

describe("admin import parsers", () => {
  it("parses tab-separated championship standings", () => {
    const parsed = parseChampionshipStandingsPaste(
      "Rank\tDriver\tTeam\tPoints\n1\tAlex Palou\tChip Ganassi Racing\t525\n2\tPato O'Ward\tArrow McLaren\t490"
    );

    expect(parsed.rows).toEqual([
      { driverName: "Alex Palou", lineNumber: 2, points: 525, rank: 1 },
      { driverName: "Pato O'Ward", lineNumber: 3, points: 490, rank: 2 }
    ]);
  });

  it("normalizes accents, punctuation, and car-number prefixes", () => {
    expect(normalizeDriverName("10 Álex-Palou")).toBe("alex palou");
  });

  it("reads the winning driver's speed from the supplied race results", () => {
    const parsed = parseIndycarResultsPaste(raceResultsSample);

    expect(parsed.rows).toHaveLength(27);
    expect(parsed.rows[0]).toMatchObject({
      averageSpeed: 156.342,
      driverName: "Josef Newgarden",
      points: 51,
      position: 1
    });
    expect(parsed.winningAverageSpeed).toBe(156.342);
  });

  it("uses finishing position rather than pasted row order to find the winning speed", () => {
    const reversedResults = raceResultsSample.trim().split("\n").reverse().join("\n");

    expect(parseIndycarResultsPaste(reversedResults).winningAverageSpeed).toBe(156.342);
  });

  it.each(["--", "", "not available", "NaN", "Infinity", "0", "-1", "300.001"])(
    "does not substitute another driver's speed when the winning speed is %j",
    (speed) => {
      const parsed = parseIndycarResultsPaste(withWinnerSpeed(speed));

      expect(parsed.rows).toHaveLength(27);
      expect(parsed.rows.map((row) => row.position)).toEqual(
        Array.from({ length: 27 }, (_, index) => index + 1)
      );
      expect(parsed.rows[1].averageSpeed).toBe(156.330);
      expect(parsed.winningAverageSpeed).toBeNull();
    }
  );

  it("does not use another driver's speed when the first-place row is missing", () => {
    const withoutWinner = raceResultsSample.trim().split("\n").slice(1).join("\n");

    expect(parseIndycarResultsPaste(withoutWinner).winningAverageSpeed).toBeNull();
  });

  it("rejects an ambiguous winning speed when multiple rows claim first place", () => {
    const duplicateWinner = raceResultsSample.replace("\n2\t", "\n1\t");

    expect(parseIndycarResultsPaste(duplicateWinner).winningAverageSpeed).toBeNull();
  });
});
