import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { HallOfFame } from "@/components/hall-of-fame";
import type { HallOfFameSeason } from "@/lib/hall-of-fame";

vi.mock("@/components/hall-of-fame-year-select", () => ({
  HallOfFameYearSelect: () => <div>Season selector</div>
}));

const season: HallOfFameSeason = {
  championTeamName: "Zulu Team",
  championTotalPoints: 2500,
  entries: [
    { finalRank: 1, teamName: "Zulu Team", totalPoints: 2500, raceBreakdown: [] },
    { finalRank: 2, teamName: "Alpha Team", totalPoints: 2500, raceBreakdown: [] },
    { finalRank: 3, teamName: "Third Team", totalPoints: 2400, raceBreakdown: [] }
  ],
  finalizedAt: "2027-09-12T12:34:56.000Z",
  participantCount: 3,
  raceCount: 17,
  seasonId: 2,
  seasonYear: 2027
};

describe("Hall of Fame single champion", () => {
  it("shows only the recorded winner in the overview and comparison despite equal totals", () => {
    const historicalSeason = { ...season, seasonId: 1, seasonYear: 2025 };
    const html = renderToStaticMarkup(<HallOfFame seasons={[season, historicalSeason]} />);

    expect(html).toContain("2027 Champion");
    expect(html).toContain("2025 Champion");
    expect(html).toContain("Zulu Team");
    expect(html).not.toContain("Alpha Team");
    expect(html).toContain("Won on tiebreak");
    expect(html).not.toContain("Co-champions");
    expect(html).not.toContain("Shared championship");
    expect(html).not.toContain("Total Points Each");
    expect(html).toContain("147.06");
    expect(html).not.toContain("Won by 0");
    expect(html).not.toContain(season.finalizedAt);
  });

  it("retains the single champion and complete official finishing order in the season detail", () => {
    const html = renderToStaticMarkup(<HallOfFame seasons={[season]} selectedYear={2027} />);

    expect(html).toContain("2027 Champion");
    expect(html).toContain("Won on tiebreak");
    expect(html.match(/aria-label="Final rank 1"/g)).toHaveLength(1);
    expect(html).toContain('aria-label="Final rank 2"');
    expect(html).toContain("Alpha Team");
    expect(html).toContain("Third Team");
    expect(html).toContain("2,400");
    expect(html).toContain("All champions");
    expect(html.indexOf("Zulu Team")).toBeLessThan(html.indexOf("Alpha Team"));
  });

  it("still displays a recorded champion when the complete standings are not available", () => {
    const html = renderToStaticMarkup(<HallOfFame seasons={[{ ...season, entries: [] }]} selectedYear={2027} />);
    expect(html).toContain("Zulu Team");
    expect(html).toContain("Full standings are not available yet");
    expect(html).not.toContain("Won on tiebreak");
  });
});
