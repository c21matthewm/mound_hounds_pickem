import { describe, expect, it } from "vitest";
import { parseChampionshipStandingsPaste } from "@/lib/championship-standings";
import { normalizeDriverName } from "@/lib/indycar-results";

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
});
