import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import DashboardPage from "@/app/dashboard/page";
import type { RaceWeekRace, RaceWeekState, RaceWeekStatus } from "@/lib/race-week";

const mocks = vi.hoisted(() => ({ user: vi.fn(), raceWeek: vi.fn() }));
vi.mock("@/lib/authenticated-user", () => ({ requireAppUser: mocks.user }));
vi.mock("@/lib/race-week", () => ({ loadRaceWeekState: mocks.raceWeek }));
vi.mock("next/navigation", () => ({ usePathname: () => "/dashboard" }));

const races: RaceWeekRace[] = [1, 2].map((id) => ({
  field_frozen_at: null,
  id,
  pick_format: "standard",
  pick_window_key: "weekend",
  qualifying_start_at: "2027-06-01T12:00:00Z",
  race_date: `2027-06-0${id + 1}T12:00:00Z`,
  race_name: `Weekend race ${id}`,
  results_status: "draft",
  round_number: id,
  season_id: 27
}));

const state = (status: RaceWeekStatus, statusLabel: string, savedCount: number): RaceWeekState => ({
  action: { status, statusLabel, title: "Race weekend", body: "Weekend status", href: "/picks", label: "View race" },
  adminReadiness: null,
  currentRace: races[0],
  isDoubleheader: true,
  pickByRaceId: new Map(races.slice(0, savedCount).map((race) => [race.id, {
    id: race.id, race_id: race.id, updated_at: "2027-05-31T12:00:00Z"
  }])),
  pickLockAt: races[0].qualifying_start_at,
  pickOpenAt: "2027-05-26T12:00:00Z",
  previousResultsBlocked: status === "waiting_results",
  races,
  savedRaceCount: savedCount,
  windowComplete: savedCount === races.length
});

beforeEach(() => {
  vi.resetAllMocks();
  mocks.user.mockResolvedValue({
    activeSeason: { id: 27, seasonYear: 2027 },
    participation: { status: "registered" },
    profile: { role: "user", team_name: "Fixture team" },
    supabase: {},
    user: { id: "fixture" }
  });
});

describe("dashboard doubleheader form badges", () => {
  it.each([
    ["form_pending", "Scheduled", 0, ["Scheduled", "Scheduled"]],
    ["waiting_results", "Results Needed", 0, ["Results Needed", "Results Needed"]],
    ["registration_required", "Registration Needed", 0, ["Registration Needed", "Registration Needed"]],
    ["form_open", "0/2 Saved", 0, ["Open", "Open"]],
    ["form_open", "1/2 Saved", 1, ["Saved", "Open"]],
    ["picks_saved", "Picks Saved", 2, ["Saved", "Saved"]],
    ["locked", "Locked", 0, ["Locked", "Locked"]],
    ["locked", "Locked", 1, ["Saved &amp; locked", "Locked"]],
    ["locked", "Locked", 2, ["Saved &amp; locked", "Saved &amp; locked"]]
  ] as const)("shows %s accurately with %i saved forms", async (status, statusLabel, savedCount, expected) => {
    mocks.raceWeek.mockResolvedValue(state(status, statusLabel, savedCount));
    const html = renderToStaticMarkup(await DashboardPage({ searchParams: Promise.resolve({}) }));
    const forms = html.split("Weekend forms")[1];
    const badges = [...forms.matchAll(/<span[^>]*class="[^"]*shrink-0[^"]*"[^>]*>(.*?)<\/span>/g)];
    expect(badges.map((match) => match[1])).toEqual(expected);
    expect(forms).toContain('href="/picks?race_id=1"');
    expect(forms).toContain('href="/picks?race_id=2"');
  });
});
