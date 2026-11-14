import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PicksPage from "@/app/picks/page";

const mocks = vi.hoisted(() => ({
  user: vi.fn(),
  resultsGate: vi.fn(),
  from: vi.fn(),
  select: vi.fn(),
  in: vi.fn()
}));
vi.mock("@/lib/authenticated-user", () => ({ requireAppUser: mocks.user }));
vi.mock("@/lib/pickem-results-gate", () => ({ getPreviousRaceResultsGate: mocks.resultsGate }));
vi.mock("@/app/picks/actions", () => ({ saveWeeklyPickAction: vi.fn() }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/picks",
  useRouter: () => ({ refresh: vi.fn() })
}));

const races = [1, 2].map((id) => ({
  id,
  race_name: `Weekend race ${id}`,
  qualifying_start_at: "2027-06-01T12:00:00Z",
  race_date: `2027-06-0${id + 1}T12:00:00Z`,
  pick_window_key: "weekend",
  pick_format: "standard",
  season_id: 27,
  results_status: "draft",
  round_number: id,
  field_frozen_at: null,
  payout: 10
}));
const drivers = Array.from({ length: 6 }, (_, i) => ({
  id: i + 1, driver_name: `Driver ${i + 1}`, group_number: i + 1,
  current_standing: i + 1, championship_points: 0, is_active: true, image_url: null
}));
const picks = races.map((race) => ({
  id: race.id,
  race_id: race.id,
  updated_at: "2027-05-30T12:00:00Z",
  average_speed: 140,
  ...Object.fromEntries(drivers.map((driver) => [`driver_group${driver.group_number}_id`, driver.id]))
}));

function withSavedPicks(count: number) {
  const tables = { races, picks: picks.slice(0, count), drivers, race_driver_groups: [] };
  mocks.from.mockImplementation((table: keyof typeof tables) => {
    const response = { data: tables[table], error: null };
    const result = Promise.resolve(response);
    const query = {
      select: (fields: string) => {
        mocks.select(table, fields);
        return query;
      },
      eq: () => query,
      in: (field: string, values: number[]) => {
        mocks.in(table, field, values);
        return query;
      },
      order: () => query,
      returns: async () => response,
      then: result.then.bind(result)
    };
    return query;
  });
  mocks.user.mockResolvedValue({
    activeSeason: { id: 27, seasonYear: 2027 },
    profile: { role: "user", team_name: "Fixture team" },
    supabase: { from: mocks.from },
    user: { id: "fixture" }
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  mocks.resultsGate.mockResolvedValue({ status: "ready" });
});
afterEach(() => vi.useRealTimers());

const renderPicks = async (raceId?: string) =>
  renderToStaticMarkup(await PicksPage({ searchParams: Promise.resolve({ race_id: raceId }) }));

describe("pick form doubleheader badges", () => {
  it.each([
    ["2027-05-31T12:00:00Z", 0, false, ["Needs picks", "Needs picks"]],
    ["2027-05-31T12:00:00Z", 1, false, ["Saved", "Needs picks"]],
    ["2027-05-31T12:00:00Z", 0, true, ["Results Needed", "Results Needed"]],
    ["2027-06-01T12:00:00Z", 0, false, ["Locked", "Locked"]],
    ["2027-06-01T12:00:00Z", 1, false, ["Saved &amp; locked", "Locked"]],
    ["2027-06-01T12:00:00Z", 2, false, ["Saved &amp; locked", "Saved &amp; locked"]]
  ] as const)("shows the race states at %s with %i saved entries and results blocked=%s", async (time, savedCount, blocked, labels) => {
    withSavedPicks(savedCount);
    vi.setSystemTime(new Date(time));
    if (blocked) {
      mocks.resultsGate.mockResolvedValue({ status: "blocked", message: "Results are still pending." });
    }
    const html = await renderPicks();
    const selector = html.match(/<nav aria-label="Doubleheader race forms"[^>]*>(.*?)<\/nav>/)?.[1] ?? "";
    expect([...selector.matchAll(/<span[^>]*class="[^"]*shrink-0[^"]*"[^>]*>(.*?)<\/span>/g)].map((match) => match[1])).toEqual(labels);
    expect(selector).toContain('href="/picks?race_id=1"');
    expect(selector).toContain('href="/picks?race_id=2"');
  });

  it("shows the scheduled opening before the selector can invite picks", async () => {
    withSavedPicks(0);
    vi.setSystemTime(new Date("2027-05-24T12:00:00Z"));
    const html = await renderPicks();
    expect(html).toContain("Opening-round picks are scheduled");
    expect(html).not.toContain("Needs picks");
  });
});

describe("locked pick receipt", () => {
  it("shows the saved drivers without loading the editable field or previous-results gate", async () => {
    withSavedPicks(1);
    vi.setSystemTime(new Date("2027-06-01T12:00:00Z"));
    const html = await renderPicks("1");
    expect(html).toContain("Picks saved and locked");
    expect(html).toContain("140 MPH");
    expect(html).toMatch(/<ul[^>]*aria-label="Saved drivers"[^>]*>.*Driver 6.*<\/ul>/);
    expect(html).toContain('href="/leaderboard?tab=picks&amp;race_id=1"');
    expect(html).not.toContain('name="average_speed"');
    expect(html).not.toContain("View saved drivers");
    expect(mocks.resultsGate).not.toHaveBeenCalled();
    expect(mocks.from.mock.calls).toEqual([["races"], ["picks"], ["drivers"]]);
    expect(mocks.select).toHaveBeenCalledWith("drivers", "id,driver_name");
    expect(mocks.in).toHaveBeenCalledWith("drivers", "id", [1, 2, 3, 4, 5, 6]);
  });

  it("defaults to the unsubmitted race in a doubleheader without querying drivers", async () => {
    withSavedPicks(1);
    vi.setSystemTime(new Date("2027-06-01T12:00:00Z"));
    const html = await renderPicks();
    expect(html).toContain("No picks were submitted before the deadline.");
    expect(html).toContain('href="/leaderboard?tab=picks&amp;race_id=2"');
    expect(html).not.toContain("after you press Save");
    expect(html).not.toContain('name="average_speed"');
    expect(mocks.from.mock.calls).toEqual([["races"], ["picks"]]);
  });

  it("keeps a direct receipt link available after the race window ends", async () => {
    withSavedPicks(1);
    vi.setSystemTime(new Date("2027-06-04T12:00:00Z"));
    expect(await renderPicks()).toContain("No future race is scheduled");
    expect(await renderPicks("1")).toContain("Picks saved and locked");
  });
});
