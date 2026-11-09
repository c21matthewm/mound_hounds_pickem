import { describe, expect, it } from "vitest";
import { officialRacePageIdentity, officialResultsUrl, parseSourcePayload, sourcePayloadHash } from "@/lib/results-automation-contract";

const raw = { race_id: 1, season: 2027, event_id: "fixture-event", session_id: "race-1", source_url: "https://www.indycar.com/results/2027/fixture/race-1", source_status: "official", race_average_speed: 170,
  rows: [{ position: 1, driver_name: "Fictional Driver", car_number: "06", laps: 100, status: "Running", points: 50, average_speed: 170 },
    { position: 2, driver_name: "Another Driver", car_number: "2", laps: 100, status: "Running", points: 40, average_speed: 169 }] };
describe("canonical official result contract", () => {
  it("deduplicates reordering/fetch timestamps while retaining meaningful score changes", () => {
    const original = parseSourcePayload(raw);
    const reordered = parseSourcePayload({ ...raw, fetched_at: "irrelevant", rows: [...raw.rows].reverse() });
    expect(sourcePayloadHash(original)).toBe(sourcePayloadHash(reordered));
    expect(original.rows[0].car_number).toBe("06");
    expect(sourcePayloadHash(parseSourcePayload({ ...raw, rows: [{ ...raw.rows[0], points: 51 }, raw.rows[1]] }))).not.toBe(sourcePayloadHash(original));
    expect(sourcePayloadHash(parseSourcePayload({ ...raw, source_status: "provisional" }))).not.toBe(sourcePayloadHash(original));
  });
  it.each(["http://www.indycar.com/results/x", "https://indycar.com.evil.invalid/results/x", "https://www.indycar.com@evil.invalid/results/x", "https://www.indycar.com:443/results/x", "https://www.indycar.com/", "https://www.indycar.com/results/x#race"])("rejects unbound or unsafe source URL %s", url => {
    expect(officialResultsUrl(url)).toBe(false);
    expect(() => parseSourcePayload({ ...raw, source_url: url })).toThrow();
  });
  it.each([[], Array.from({ length: 101 }, () => raw.rows[0])])("bounds the result field", rows => expect(() => parseSourcePayload({ ...raw, rows })).toThrow());
  it("retains missing required values for review instead of inventing points or speed", () => {
    const result = parseSourcePayload({ ...raw, rows: [{ ...raw.rows[0], points: null, average_speed: null, laps: null }] });
    expect(result.rows[0]).toMatchObject({ points: null, average_speed: null, laps: null });
  });
  it.each([Number.NaN, Number.POSITIVE_INFINITY, "50", 1.5])("rejects invalid integer points %s", points => expect(() => parseSourcePayload({ ...raw, rows: [{ ...raw.rows[0], points }] })).toThrow());
});
describe("official page setup", () => {
  it.each([
    ["https://www.indycar.com/results/ntt-indycar-series/2026/mission-foods-grand-prix-of-monterey/race", { season: 2026, eventId: "mission-foods-grand-prix-of-monterey", sessionId: "race" }],
    ["https://www.indycar.com/results/ntt-indycar-series/2027/fixture/race-2", { season: 2027, eventId: "fixture", sessionId: "race-2" }],
    ["https://www.indycar.com/results/ntt-indycar-series/2027/fixture/qualifying", null],
    ["https://www.indycar.com/results/ntt-indycar-series/2027/fixture/race?other=1", null],
    ["https://evil.invalid/results/ntt-indycar-series/2027/fixture/race", null]
  ])("extracts only an exact official race page: %s", (url, identity) => {
    expect(officialRacePageIdentity(url)).toEqual(identity);
  });
});
