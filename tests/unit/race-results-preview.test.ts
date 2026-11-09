import { describe, expect, it } from "vitest";
import { buildRaceResultsPreview } from "@/lib/race-results-preview";
import type { ParsedIndycarResults } from "@/lib/indycar-results";
import type { RacePickFormat } from "@/lib/race-format";

function fixture(format: RacePickFormat = "standard") {
  const count = format === "indy_500" ? 33 : 12;
  const drivers = Array.from({ length: count }, (_, index) => ({
    driverName: `Driver ${index + 1}`, groupNumber: format === "indy_500" ? 6 : Math.floor(index / 2) + 1, id: index + 1, isActive: true
  }));
  const parsed: ParsedIndycarResults = {
    ignoredLineCount: 0, winningAverageSpeed: 150.123,
    rows: drivers.map((driver, index) => ({ averageSpeed: index === 0 ? 150.123 : 149, carNumber: String(driver.id),
      driverName: driver.driverName, lineNumber: index + 1, points: 60 - index, position: index + 1 }))
  };
  return { drivers, fieldFrozen: true, parsed, pickFormat: format, raceId: 7,
    raceDriverGroups: drivers.map((driver, index) => ({ driver_id: driver.id,
      group_number: format === "indy_500" ? Math.min(8, Math.floor(index / 4) + 1) : driver.groupNumber, race_id: 7 })) };
}

describe("shared race results preview", () => {
  it("maps the complete field without mutating its source", () => {
    const input = fixture(), before = structuredClone(input);
    const preview = buildRaceResultsPreview(input);
    expect(preview).toMatchObject({ canPublishManually: true, isClean: true, expectedResultCount: 12, readyCount: 12, flags: [] });
    expect(preview.publishRows[0]).toEqual({ driver_id: 1, points: 60, position: 1 });
    expect(input).toEqual(before);
  });
  it("uses frozen groups for the unchanged scoring ranges", () => {
    const input = fixture(); input.drivers.forEach(driver => { driver.groupNumber = 6; });
    const preview = buildRaceResultsPreview(input);
    expect(preview.isClean).toBe(true); expect(preview.highestPossibleScore).toBe(330); expect(preview.lowestPossibleScore).toBe(324);
    expect(preview.rows[0].groupNumber).toBe(1);
  });
  it("preserves manual nonstarter zero-filling while requiring automation review", () => {
    const input = fixture(); input.parsed.rows.pop();
    const preview = buildRaceResultsPreview(input);
    expect(preview.canPublishManually).toBe(true); expect(preview.isClean).toBe(false);
    expect(preview.zeroPointDriverNames).toEqual(["Driver 12"]); expect(preview.lowestPossibleScore).toBe(275);
    expect(preview.flags).toContainEqual(expect.objectContaining({ code: "missing_field_drivers", blocksManualPublish: false }));
  });
  it("blocks more than five missing standard drivers", () => {
    const input = fixture(); input.parsed.rows = input.parsed.rows.slice(0, 6);
    expect(buildRaceResultsPreview(input).flags).toContainEqual(expect.objectContaining({ code: "missing_field_drivers", blocksManualPublish: true }));
  });
  it("requires an official participant in every group even with zero-filled minima", () => {
    const input = fixture(); input.parsed.rows = input.parsed.rows.slice(0, 10);
    const preview = buildRaceResultsPreview(input);
    expect(preview.missingScoreGroups).toEqual([]); expect(preview.missingOfficialGroups).toEqual([6]); expect(preview.canPublishManually).toBe(false);
  });
  it.each(["missing", "another_race", "unfrozen"])("keeps %s snapshot conditions out of automated readiness", state => {
    const input = fixture();
    if (state === "missing") input.raceDriverGroups = [];
    if (state === "another_race") input.raceDriverGroups.forEach(group => { group.race_id = 8; });
    if (state === "unfrozen") input.fieldFrozen = false;
    const preview = buildRaceResultsPreview(input);
    expect(preview.canPublishManually).toBe(true); expect(preview.isClean).toBe(false);
  });
  it("uses explicit normalized aliases without fuzzy matching", () => {
    const input = fixture(); input.drivers[0].driverName = "Álex Palou";
    input.parsed.rows[0].driverName = "10 A. Palou";
    const drivers = input.drivers.map(driver => driver.id === 1 ? { ...driver, aliases: ["A. Palou", "Álex Palou"] } : driver);
    const preview = buildRaceResultsPreview({ ...input, drivers });
    expect(preview.isClean).toBe(true); expect(preview.rows[0].mappedDriverId).toBe(1);
  });
  it.each(["collision", "abbreviation", "outside", "duplicate"])("flags %s mapping instead of guessing", kind => {
    const input = fixture();
    if (kind === "collision") input.drivers[1].driverName = "Driver-1";
    if (kind === "abbreviation") input.parsed.rows[0].driverName = "D. 1";
    if (kind === "outside") input.raceDriverGroups = input.raceDriverGroups.filter(group => group.driver_id !== 12);
    if (kind === "duplicate") input.parsed.rows.push({ ...input.parsed.rows[1], lineNumber: 13 });
    const codes: Record<string, string> = { collision: "ambiguous_driver_name", abbreviation: "unmapped_driver", outside: "driver_outside_field", duplicate: "duplicate_driver" };
    const preview = buildRaceResultsPreview(input);
    expect(preview.canPublishManually).toBe(false); expect(preview.flags).toContainEqual(expect.objectContaining({ code: codes[kind] }));
  });
  it.each([2, 999, null])("rejects duplicate/gapped/missing position %j", position => {
    const input = fixture(); input.parsed.rows[2].position = position;
    expect(buildRaceResultsPreview(input).positionsValid).toBe(false);
  });
  it.each([null, 0, 300.001])("requires a valid official winning speed: %j", speed => {
    const input = fixture(); input.parsed.winningAverageSpeed = speed;
    expect(buildRaceResultsPreview(input).flags).toContainEqual(expect.objectContaining({ code: "missing_winning_speed" }));
  });
  it.each([-1, 1.5, Number.NaN])("rejects invalid result points %j", points => {
    const input = fixture(); input.parsed.rows[2].points = points;
    expect(buildRaceResultsPreview(input).flags).toContainEqual(expect.objectContaining({ code: "invalid_points" }));
  });
  it("accepts explicit zero points", () => {
    const input = fixture(); input.parsed.rows[2].points = 0;
    expect(buildRaceResultsPreview(input).isClean).toBe(true);
  });
  it("retains manual paste headers while requiring automated review of ignored lines", () => {
    const input = fixture(); input.parsed.ignoredLineCount = 1;
    const preview = buildRaceResultsPreview(input);
    expect(preview.canPublishManually).toBe(true); expect(preview.isClean).toBe(false);
  });
  it("accepts the complete 33-car Indianapolis500 field across eight frozen groups", () => {
    expect(buildRaceResultsPreview(fixture("indy_500"))).toMatchObject({ groupCount: 8, expectedResultCount: 33, readyCount: 33, canPublishManually: true, isClean: true });
  });
  it.each(["missing_result", "missing_qualifier"])("keeps the complete Indy500 requirement for %s", state => {
    const input = fixture("indy_500"); input.parsed.rows.pop();
    if (state === "missing_qualifier") input.raceDriverGroups.pop();
    expect(buildRaceResultsPreview(input).canPublishManually).toBe(false);
  });
  it.each(["invalid", "conflicting"])("rejects %s frozen group assignments", problem => {
    const input = fixture();
    if (problem === "invalid") input.raceDriverGroups[0].group_number = 9;
    else input.raceDriverGroups.push({ ...input.raceDriverGroups[0], group_number: 2 });
    expect(buildRaceResultsPreview(input).canPublishManually).toBe(false);
  });
});
