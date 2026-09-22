import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { HISTORICAL_IMPORT_LIMITS, parseHistoricalHallOfFameImport } from "@/lib/hall-of-fame-import";

const parse = (spreadsheet: string, raceCount = "2", seasonYear = "2024") =>
  parseHistoricalHallOfFameImport({ spreadsheet, raceCount, seasonYear });

describe("historical Hall of Fame spreadsheet import", () => {
  it("reads a Google Sheets header and verifies every race total", () => {
    const result = parse("Rank\tTeam Name\tTotal Points\tRace 1\tRace 2\n1\tWinner\t40\t25\t15\n2\tRunner-up\t35\t20\t15");
    expect(result.errors).toEqual([]);
    expect(result.verifiedRaceScores).toBe(true);
    expect(result.entries).toEqual([
      { final_rank: 1, team_name: "Winner", total_points: 40, race_breakdown: [] },
      { final_rank: 2, team_name: "Runner-up", total_points: 35, race_breakdown: [] }
    ]);
  });

  it("supports CSV escaped names, thousands separators, a BOM, and CRLF", () => {
    const result = parse('\uFEFFRank,Team Name,Total Points\r\n1,"Matt, the ""champ""","2,684"\r\n2,Team Two,"2,666"\r\n', "18");
    expect(result.errors).toEqual([]);
    expect(result.entries[0].team_name).toBe('Matt, the "champ"');
    expect(result.entries[0].total_points).toBe(2684);
    expect(result.verifiedRaceScores).toBe(false);
  });

  it("preserves original explicit places and Unicode names in a movement-column paste", () => {
    const result = parse("1\t▲ 0\tAdelle - KACHOW🏎️\t40\t25\t15\n2\t▼ 1\tBob - Lysdexia's aDd\t40\t20\t20");
    expect(result.errors).toEqual([]);
    expect(result.entries[0].team_name).toBe("Adelle - KACHOW🏎️");
    expect(result.entries[1].team_name).toBe("Bob - Lysdexia's aDd");
    expect(result.entries.map((entry) => entry.final_rank)).toEqual([1, 2]);
    expect(result.warnings).toHaveLength(2);
    expect(result.warnings[1]).toContain("different order");
  });

  it("allows declared competition ranks below a single champion", () => {
    const result = parse("1\tA\t30\n2\tB\t20\n2\tC\t20\n4\tD\t10");
    expect(result.errors).toEqual([]);
    expect(result.entries.map((entry) => entry.final_rank)).toEqual([1, 2, 2, 4]);
  });

  it("does not misidentify a team named Team as a header", () => {
    expect(parse("1\tTeam\t0").errors).toEqual([]);
  });

  it("supports rearranged labeled columns", () => {
    const result = parse("Team Name,Total Points,Rank\nWinner,40,1\nOther,30,2");
    expect(result.errors).toEqual([]);
    expect(result.entries[0].team_name).toBe("Winner");
  });

  it.each([
    ["1\tA\t30\n1\tB\t30", "exactly one rank-1"],
    ["2\tA\t30", "exactly one rank-1"],
    ["1\tA\t30\n3\tB\t20", "Ranks must"],
    ["1\tA\t30\n2\tB\t40", "more total points"],
    ["1\tA\t30\n2\tB\t20\n2\tC\t19", "Ranks must"],
    ["1\tA\t-1", "nonnegative whole"],
    ["1\tA\t1.5", "nonnegative whole"],
    ["1\tA\t1e2", "nonnegative whole"],
    ["1\tA\t2147483648", "nonnegative whole"],
    ["1\tA\t10,00", "nonnegative whole"],
    ["1.2\tA\t30", "positive whole"],
    ["1\tA\t30\n2\ta\t20", "duplicate team"],
    ["1\tＡ\t30\n2\tA\t20", "duplicate team"],
    ["1\tA B\t30\n2\tA  B\t20", "duplicate team"],
    ["1\t\t30", "team name"],
    ["1\tA\t30\t20\t9", "do not add up"],
    ["1\tA\t30\t20\t-10", "every race score"],
    ["1\tA\t30\t30", "exactly one score column per race"],
    ["1\tA\t30\n2\tB\t20\t10", "column count differs"],
    ['Rank,Team Name,Total Points\n1,"unfinished,20', "quoted cell is incomplete"],
    ['1,"A"suffix,20', "closing quote"],
    ['1,"A\nB",20', "one line"],
    ["Rank\tTeam Name\tRank\n1\tA\t20", "exactly one Rank"],
    ["Rank\tTeam Name\tTotal Points", "participant rows"]
  ])("rejects invalid data: %s", (spreadsheet, error) => {
    expect(parse(spreadsheet).errors.join(" ")).toContain(error);
  });

  it.each(["1999", "2101", "", "NaN"])("rejects invalid season year %s", (year) => {
    expect(parse("1\tA\t10", "2", year).errors.join(" ")).toContain("season year");
  });

  it.each(["0", "101", "", "2.5"])("rejects invalid race count %s", (count) => {
    expect(parse("1\tA\t10", count).errors.join(" ")).toContain("race count");
  });

  it("bounds input size, participant count, team length, and returned errors", () => {
    expect(parse("x".repeat(HISTORICAL_IMPORT_LIMITS.characters + 1)).errors[0]).toContain("too large");
    expect(parse(Array.from({ length: 501 }, (_, index) => `${index + 1}\tTeam ${index}\t0`).join("\n")).errors[0]).toContain("500 participants");
    expect(parse(`1\t${"A".repeat(161)}\t0`).errors[0]).toContain("160");
    expect(parse(Array.from({ length: 100 }, (_, index) => `${index + 1}\tTeam ${index}\t-1`).join("\n")).errors).toHaveLength(12);
  });

  it("validates the actual 2026 paste and highlights the three approved corrections without silently changing it", () => {
    const source = readFileSync(new URL("../../supabase/imports/hall-of-fame/2026/2026-original.tsv", import.meta.url), "utf8");
    const result = parse(source, "18", "2026");
    expect(result.errors).toEqual([]);
    expect(result.entries).toHaveLength(78);
    expect(result.verifiedRaceScores).toBe(true);
    expect(result.entries[0]).toMatchObject({ team_name: "Matt - Team Nash", total_points: 2684 });
    expect(result.entries.reduce((total, entry) => total + entry.total_points, 0)).toBe(173961);
    expect(result.warnings[1]).toContain("Jonathan");
    expect(result.warnings[1]).toContain("Vivi");
    expect(result.warnings[1]).toContain("Craig");
    expect(result.entries[25].team_name).toBe("Billy 4 - Dixon for Seven");
  });
});
