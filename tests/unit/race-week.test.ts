import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadRaceWeekState, type RaceWeekRace } from "@/lib/race-week";
import type { LeagueSeason } from "@/lib/seasons";
import type { SeasonParticipation } from "@/lib/season-participation";
import type { AppSupabaseClient } from "@/lib/supabase/types";

const mocks = vi.hoisted(() => ({ previousResultsGate: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/pickem-results-gate", () => ({
  getPreviousRaceResultsGate: mocks.previousResultsGate
}));

const now = new Date("2027-09-06T18:00:00.000Z");
const season: LeagueSeason = {
  activatedAt: "2027-01-01T00:00:00.000Z",
  completedAt: null,
  displayName: "2027 Season",
  id: 27,
  registrationCodeConfiguredAt: "2027-01-01T00:00:00.000Z",
  rosterConfiguredAt: "2027-01-01T00:00:00.000Z",
  rulesDocumentUrl: null,
  seasonYear: 2027,
  status: "active"
};
const registered: SeasonParticipation = {
  decidedAt: "2027-01-02T00:00:00.000Z",
  profileId: "fixture-participant",
  registeredAt: "2027-01-02T00:00:00.000Z",
  seasonId: season.id,
  status: "registered"
};
const declined: SeasonParticipation = {
  ...registered,
  registeredAt: null,
  status: "declined"
};

type FixtureRace = RaceWeekRace & { is_archived: boolean };

const race = (overrides: Partial<FixtureRace> = {}): FixtureRace => ({
  field_frozen_at: null,
  id: 17,
  is_archived: false,
  pick_format: "standard",
  pick_window_key: "final-round",
  qualifying_start_at: "2027-09-04T18:00:00.000Z",
  race_date: "2027-09-05T18:00:00.000Z",
  race_name: "Final race",
  results_status: "draft",
  round_number: 17,
  season_id: season.id,
  ...overrides
});

const fixtureClient = (races: FixtureRace[], raceError: string | null = null) => {
  const from = vi.fn((table: string) => {
    if (table !== "races" && table !== "picks") {
      throw new Error(`Unexpected fixture query: ${table}`);
    }
    let rows: Record<string, unknown>[] = table === "races" ? [...races] : [];
    const query = {
      select: () => query,
      eq: (column: string, value: unknown) => {
        rows = rows.filter((row) => row[column] === value);
        return query;
      },
      in: (column: string, values: unknown[]) => {
        rows = rows.filter((row) => values.includes(row[column]));
        return query;
      },
      order: (column: string) => {
        rows.sort((left, right) => Number(left[column]) - Number(right[column]));
        return query;
      },
      returns: async () => ({
        data: table === "races" && raceError ? null : rows,
        error: table === "races" && raceError ? { message: raceError } : null
      })
    };
    return query;
  });
  return { from, supabase: { from } as unknown as AppSupabaseClient };
};

const load = (
  races: FixtureRace[],
  options: { isAdmin?: boolean; participation?: SeasonParticipation | null } = {}
) => loadRaceWeekState({
  activeSeason: season,
  isAdmin: options.isAdmin ?? false,
  now,
  participation: options.participation === undefined ? registered : options.participation,
  supabase: fixtureClient(races).supabase,
  userId: registered.profileId
});

beforeEach(() => {
  mocks.previousResultsGate.mockReset();
  mocks.previousResultsGate.mockResolvedValue({
    expectedResultCount: null,
    previousRace: null,
    previousRaces: [],
    resultCount: 0,
    status: "ready"
  });
});

describe("dashboard race-week lifecycle", () => {
  it.each([now.toISOString(), "2027-09-05T18:00:00.000Z"])(
    "awaits unpublished results once the final race starts at %s",
    async (raceDate) => {
      const state = await load([race({ race_date: raceDate })]);

      expect(state.action).toMatchObject({
        href: "/leaderboard",
        label: "View current standings",
        status: "season_results_pending",
        statusLabel: "Results Pending",
        title: "Awaiting final results"
      });
      expect(state.currentRace).toBeNull();
      expect(mocks.previousResultsGate).not.toHaveBeenCalled();
    }
  );

  it("directs the administrator to the first unpublished race even when the last race is published", async () => {
    const state = await load([
      race({ results_status: "published" }),
      race({ id: 12, round_number: 12, race_name: "Earlier unfinished round" }),
      race({ id: 14, round_number: 14 })
    ], { isAdmin: true });

    expect(state.action).toMatchObject({
      href: "/admin?tab=results&result_race_id=12",
      label: "Post race results",
      status: "season_results_pending"
    });
  });

  it.each([false, true])("offers final standings after every race is published (admin=%s)", async (isAdmin) => {
    const state = await load([
      race({ id: 16, round_number: 16, results_status: "published" }),
      race({ results_status: "published" })
    ], { isAdmin });

    expect(state.action).toMatchObject({
      href: "/leaderboard",
      label: "View final standings",
      status: "season_complete",
      statusLabel: "Season Complete",
      title: "Final standings are ready"
    });
  });

  it("excludes archived races and other seasons when determining completion", async () => {
    const state = await load([
      race({ results_status: "published" }),
      race({ id: 18, is_archived: true }),
      race({ id: 19, season_id: season.id + 1, race_date: "2027-09-12T18:00:00.000Z" })
    ]);

    expect(state.action.status).toBe("season_complete");
  });

  it("keeps an empty schedule distinct from a completed season", async () => {
    const state = await load([]);

    expect(state.action).toMatchObject({
      href: "/leaderboard?tab=hall",
      status: "no_race",
      statusLabel: "Schedule Pending",
      title: "First race coming soon"
    });
  });

  it("keeps registration available for a declined participant before the schedule exists", async () => {
    const state = await load([], { participation: declined });

    expect(state.action).toMatchObject({
      href: "/season-registration",
      status: "registration_required"
    });
  });

  it("continues to offer picks for a future open race", async () => {
    const state = await load([race({
      qualifying_start_at: "2027-09-09T18:00:00.000Z",
      race_date: "2027-09-10T18:00:00.000Z"
    })]);

    expect(state.action).toMatchObject({
      href: "/picks?race_id=17",
      label: "Make picks",
      status: "form_open"
    });
    expect(state.currentRace?.id).toBe(17);
  });

  it("preserves the previous-results gate when another race is still ahead", async () => {
    mocks.previousResultsGate.mockResolvedValue({
      shortMessage: "The previous race results are not published.",
      status: "blocked"
    });
    const state = await load([
      race({ id: 16, round_number: 16, pick_window_key: "previous-round" }),
      race({
        qualifying_start_at: "2027-09-09T18:00:00.000Z",
        race_date: "2027-09-10T18:00:00.000Z"
      })
    ]);

    expect(state.action.status).toBe("waiting_results");
    expect(state.previousResultsBlocked).toBe(true);
    expect(state.currentRace?.id).toBe(17);
  });

  it("awaits both final doubleheader results after the second race starts", async () => {
    const state = await load([
      race({ id: 16, round_number: 16, pick_window_key: "doubleheader" }),
      race({ pick_window_key: "doubleheader", race_date: now.toISOString() })
    ], { isAdmin: true });

    expect(state.action).toMatchObject({
      href: "/admin?tab=results&result_race_id=16",
      status: "season_results_pending"
    });
  });

  it("keeps the shared locked window while the second doubleheader race is still ahead", async () => {
    const state = await load([
      race({ id: 16, round_number: 16, pick_window_key: "doubleheader" }),
      race({ pick_window_key: "doubleheader", race_date: "2027-09-07T18:00:00.000Z" })
    ]);

    expect(state.action.status).toBe("locked");
    expect(state.isDoubleheader).toBe(true);
    expect(state.races.map((entry) => entry.id)).toEqual([16, 17]);
  });

  it.each([
    ["draft", "season_results_pending", "View current standings"],
    ["published", "season_complete", "View final standings"]
  ] as const)("shows the terminal %s state to a declined participant", async (resultsStatus, status, label) => {
    const state = await load([race({ results_status: resultsStatus })], { participation: declined });

    expect(state.action).toMatchObject({ href: "/leaderboard", label, status });
  });

  it("fails on a schedule query error instead of claiming the season is complete", async () => {
    const { supabase } = fixtureClient([], "Schedule unavailable");

    await expect(loadRaceWeekState({
      activeSeason: season,
      isAdmin: false,
      now,
      participation: registered,
      supabase,
      userId: registered.profileId
    })).rejects.toThrow("Failed loading race-week schedule: Schedule unavailable");
  });
});
