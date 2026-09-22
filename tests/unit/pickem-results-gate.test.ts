import { describe, expect, it, vi } from "vitest";
import {
  getPreviousRaceResultsGate,
  previousPickWindowRaces,
  type PickemSeasonRaceForResultsGate
} from "@/lib/pickem-results-gate";
import type { AppSupabaseClient } from "@/lib/supabase/types";

const race = (
  id: number,
  overrides: Partial<PickemSeasonRaceForResultsGate> = {}
): PickemSeasonRaceForResultsGate => ({
  id,
  is_archived: false,
  pick_format: "standard",
  pick_window_key: `window-${id}`,
  race_date: `2027-06-${String(id).padStart(2, "0")}T16:00:00.000Z`,
  race_name: `Race ${id}`,
  results_status: "published",
  round_number: id,
  season_id: 27,
  ...overrides
});

type FixtureOptions = {
  races?: PickemSeasonRaceForResultsGate[];
  results?: Array<{ race_id: number }>;
  snapshots?: Array<{ race_id: number }>;
  activeDrivers?: number;
  errorTable?: string;
};

// Exercise query filters and bounds, not just a queue of canned responses.
const client = ({
  races = [],
  results = [],
  snapshots = [],
  activeDrivers = 27,
  errorTable
}: FixtureOptions = {}) => {
  const from = vi.fn((table: string) => {
    const source = {
      races,
      results,
      race_driver_groups: snapshots,
      drivers: Array.from({ length: activeDrivers }, (_, id) => ({
        id,
        is_active: true,
        group_number: id % 6 + 1
      }))
    }[table];
    if (!source) throw new Error(`Unexpected query: ${table}`);
    let rows: Record<string, unknown>[] = [...source];
    let head = false;
    let countRequested = false;
    const response = () => ({
      count: countRequested ? rows.length : null,
      data: head ? null : rows,
      error: table === errorTable ? { message: "fixture query failed" } : null
    });
    const query = {
      select: (_fields: string, options?: { count?: string; head?: boolean }) => {
        head = options?.head ?? false;
        countRequested = Boolean(options?.count);
        return query;
      },
      eq: (column: string, value: unknown) => {
        rows = rows.filter((row) => row[column] === value);
        return query;
      },
      in: (column: string, values: unknown[]) => {
        rows = rows.filter((row) => values.includes(row[column]));
        return query;
      },
      gte: (column: string, value: number) => {
        rows = rows.filter((row) => Number(row[column]) >= value);
        return query;
      },
      lte: (column: string, value: number) => {
        rows = rows.filter((row) => Number(row[column]) <= value);
        return query;
      },
      order: (column: string, options: { ascending: boolean }) => {
        rows.sort((left, right) => (
          Number(left[column]) - Number(right[column])
        ) * (options.ascending ? 1 : -1));
        return query;
      },
      limit: (limit: number) => {
        rows = rows.slice(0, limit);
        return query;
      },
      returns: async () => response(),
      then: (resolve: (value: ReturnType<typeof response>) => unknown) =>
        Promise.resolve(response()).then(resolve)
    };
    return query;
  });
  return { from, supabase: { from } as unknown as AppSupabaseClient };
};

const rowsFor = (raceId: number, count: number) =>
  Array.from({ length: count }, () => ({ race_id: raceId }));

describe("previous pick window", () => {
  it("sorts a copy, skips gaps, and excludes archived races and other seasons", () => {
    const selected = race(8);
    const previous = race(3);
    const schedule = [
      selected,
      race(7, { is_archived: true }),
      race(6, { season_id: 26 }),
      previous,
      race(1)
    ];
    expect(previousPickWindowRaces(schedule, selected)).toEqual([previous]);
    expect(schedule.map((row) => row.id)).toEqual([8, 7, 6, 3, 1]);
  });

  it("returns no predecessor for either race of an opening doubleheader", () => {
    const first = race(1, { pick_window_key: "opening" });
    const second = race(2, { pick_window_key: "opening" });
    expect(previousPickWindowRaces([second, first], first)).toEqual([]);
    expect(previousPickWindowRaces([second, first], second)).toEqual([]);
  });

  it("resolves the whole preceding doubleheader from either current race", () => {
    const previousFirst = race(1, { pick_window_key: "previous" });
    const previousSecond = race(2, { pick_window_key: "previous" });
    const currentFirst = race(3, { pick_window_key: "current" });
    const currentSecond = race(4, { pick_window_key: "current" });
    const schedule = [currentSecond, previousSecond, currentFirst, previousFirst];
    for (const selected of [currentFirst, currentSecond]) {
      expect(previousPickWindowRaces(schedule, selected)).toEqual([
        previousFirst,
        previousSecond
      ]);
    }
  });

  it("rejects a missing or mismatched anchor instead of assuming an opening window", () => {
    const selected = race(3);
    for (const schedule of [
      [],
      [race(1)],
      [race(3, { pick_window_key: "different" })],
      [race(3, { round_number: 4 })],
      [race(3, { is_archived: true })]
    ]) {
      expect(() => previousPickWindowRaces(schedule, selected)).toThrow(
        "valid complete season schedule"
      );
    }
  });

  it("rejects duplicate or invalid schedule rounds", () => {
    const selected = race(3);
    for (const invalid of [
      race(1, { round_number: 3 }),
      race(3, { round_number: 1 }),
      race(1, { round_number: 0 }),
      race(1, { round_number: 100 }),
      race(1, { round_number: 1.5 }),
      race(1, { pick_window_key: "" })
    ]) {
      expect(() => previousPickWindowRaces([selected, invalid], selected)).toThrow(
        "valid complete season schedule"
      );
    }
  });
});

describe("previous results gate", () => {
  it("performs no queries for the first window or published results, including admins", async () => {
    const db = client({ errorTable: "results" });
    const first = race(1);
    const second = race(2);
    for (const selected of [first, second]) {
      const gate = await getPreviousRaceResultsGate(db.supabase, selected, {
        includeDiagnostics: true,
        seasonRaces: [first, second]
      });
      expect(gate.status).toBe("ready");
      expect(gate.diagnostics).toBeNull();
      expect(gate.previousRace?.id ?? null).toBe(selected.id === 1 ? null : 1);
    }
    expect(db.from).not.toHaveBeenCalled();
  });

  it("blocks an unpublished race with truthful participant copy and zero queries", async () => {
    const db = client();
    const selected = race(2);
    const gate = await getPreviousRaceResultsGate(db.supabase, selected, {
      seasonRaces: [race(1, { results_status: "draft" }), selected]
    });
    expect(gate.status).toBe("blocked");
    if (gate.status !== "blocked") throw new Error("Expected blocked gate");
    expect(gate.shortMessage).toBe("Waiting for Race 1 results to be published.");
    expect(gate.message).toContain("results for Race 1 are published");
    expect(gate.message).not.toContain("rows saved");
    expect(gate.diagnostics).toBeNull();
    expect(db.from).not.toHaveBeenCalled();
  });

  it.each([1, 2])("requires both preceding doubleheader results (draft race %s)", async (draftId) => {
    const db = client();
    const selected = race(3);
    const gate = await getPreviousRaceResultsGate(db.supabase, selected, {
      seasonRaces: [
        selected,
        race(2, { pick_window_key: "doubleheader", results_status: draftId === 2 ? "draft" : "published" }),
        race(1, { pick_window_key: "doubleheader", results_status: draftId === 1 ? "draft" : "published" })
      ]
    });
    expect(gate.status).toBe("blocked");
    if (gate.status !== "blocked") throw new Error("Expected blocked gate");
    expect(gate.shortMessage).toContain(`Race ${draftId} results`);
    expect(gate.message).toContain("both doubleheader races");
    expect(gate.previousRaces.map((row) => row.id)).toEqual([1, 2]);
    expect(db.from).not.toHaveBeenCalled();
  });

  it("counts saved rows for admins but keeps a complete draft blocked", async () => {
    const db = client({
      results: [...rowsFor(1, 4), ...rowsFor(99, 8)],
      snapshots: [...rowsFor(1, 4), ...rowsFor(99, 8)]
    });
    const selected = race(2);
    const gate = await getPreviousRaceResultsGate(db.supabase, selected, {
      includeDiagnostics: true,
      seasonRaces: [race(1, { results_status: "draft" }), selected]
    });
    expect(gate.status).toBe("blocked");
    expect(gate.diagnostics).toEqual({
      expectedResultCount: 4,
      missingResultCount: 0,
      resultCount: 4
    });
    if (gate.status !== "blocked") throw new Error("Expected blocked gate");
    expect(gate.shortMessage).toContain("4/4 result rows saved");
    expect(db.from.mock.calls.map(([table]) => table)).toEqual([
      "results", "race_driver_groups", "drivers"
    ]);
  });

  it("preserves per-race field sizes and Indianapolis fallback in admin diagnostics", async () => {
    const db = client({ results: rowsFor(1, 20), activeDrivers: 27 });
    const selected = race(2);
    const gate = await getPreviousRaceResultsGate(db.supabase, selected, {
      includeDiagnostics: true,
      seasonRaces: [race(1, { pick_format: "indy_500", results_status: "draft" }), selected]
    });
    expect(gate.diagnostics).toEqual({
      expectedResultCount: 33,
      missingResultCount: 13,
      resultCount: 20
    });
  });

  it.each([null, undefined, "unexpected"])("fails closed on unknown publication status %s", async (status) => {
    const db = client();
    const selected = race(2);
    const previous = { ...race(1), results_status: status } as PickemSeasonRaceForResultsGate;
    const gate = await getPreviousRaceResultsGate(db.supabase, selected, {
      seasonRaces: [previous, selected]
    });
    expect(gate.status).toBe("blocked");
    expect(db.from).not.toHaveBeenCalled();
  });

  it("loads one complete schedule for reminder callers, retaining past unpublished races", async () => {
    const selected = race(3, { race_date: "2027-09-01T16:00:00.000Z" });
    const db = client({ races: [
      selected,
      race(2, { race_date: "2027-06-01T16:00:00.000Z", results_status: "draft" }),
      race(1),
      race(4, { season_id: 26, results_status: "draft" }),
      race(5, { is_archived: true, results_status: "draft" })
    ] });
    const gate = await getPreviousRaceResultsGate(db.supabase, selected);
    expect(gate.status).toBe("blocked");
    expect(gate.previousRace?.id).toBe(2);
    expect(db.from.mock.calls).toEqual([["races"]]);
  });

  it("supports the last valid season round without truncating the fallback query", async () => {
    const schedule = Array.from({ length: 99 }, (_, index) => race(index + 1));
    const db = client({ races: schedule });
    const gate = await getPreviousRaceResultsGate(db.supabase, schedule[98]);
    expect(gate.status).toBe("ready");
    expect(gate.previousRace?.id).toBe(98);
    expect(db.from.mock.calls).toEqual([["races"]]);
  });

  it("rejects a fallback response that has lost the selected race", async () => {
    const db = client({ races: [race(1)] });
    await expect(getPreviousRaceResultsGate(db.supabase, race(2))).rejects.toThrow(
      "valid complete season schedule"
    );
  });

  it("does not interpret a failed schedule query as a ready gate", async () => {
    const db = client({ errorTable: "races" });
    await expect(getPreviousRaceResultsGate(db.supabase, race(2))).rejects.toThrow(
      "Failed to load the season schedule for previous results"
    );
  });

  it.each(["results", "race_driver_groups", "drivers"])(
    "propagates requested admin diagnostic errors from %s",
    async (errorTable) => {
      const db = client({ errorTable });
      const selected = race(2);
      await expect(getPreviousRaceResultsGate(db.supabase, selected, {
        includeDiagnostics: true,
        seasonRaces: [race(1, { results_status: "draft" }), selected]
      })).rejects.toThrow("fixture query failed");
    }
  );
});
