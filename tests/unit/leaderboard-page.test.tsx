import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import LeaderboardPage from "@/app/leaderboard/page";

const mocks = vi.hoisted(() => ({
  user: vi.fn(), standings: vi.fn(), picks: vi.fn(), analytics: vi.fn(), hall: vi.fn()
}));
vi.mock("@/lib/authenticated-user", () => ({ requireAppUser: mocks.user }));
vi.mock("@/lib/scoring", () => ({
  buildLeagueScoringSnapshot: mocks.standings,
  buildPicksByRaceSnapshot: mocks.picks,
  buildParticipantAnalyticsSnapshot: mocks.analytics
}));
vi.mock("@/lib/hall-of-fame", () => ({ loadHallOfFameSnapshot: mocks.hall }));
vi.mock("next/navigation", () => ({ usePathname: () => "/leaderboard" }));

beforeEach(() => {
  vi.resetAllMocks();
  mocks.user.mockResolvedValue({
    activeSeason: { id: 27, seasonYear: 2027 },
    participation: { status: "registered" },
    supabase: {}, user: { id: "fixture" }
  });
  mocks.standings.mockResolvedValue({ leaderboardRows: [], raceColumns: [] });
  mocks.picks.mockResolvedValue({ availableRaces: [], resultsPosted: false, rows: [], selectedRace: null });
  mocks.analytics.mockResolvedValue(null);
  mocks.hall.mockResolvedValue({ seasons: [] });
});

describe("leaderboard load recovery", () => {
  it.each(["standings", "picks", "analytics", "hall"] as const)(
    "passes %s failures to the shared error boundary and renders after recovery", async (tab) => {
      const error = new Error("Database technical detail that should not appear in the page");
      mocks[tab].mockRejectedValueOnce(error);
      const props = { searchParams: Promise.resolve({ tab }) };
      await expect(LeaderboardPage(props)).rejects.toBe(error);

      const html = renderToStaticMarkup(await LeaderboardPage(props));
      expect(html).toMatch(/<h1[^>]*>Leaderboard<\/h1>/);
      expect(html).toContain('aria-label="Leaderboard views"');
      expect(html).toContain("Standings");
      expect(html).toContain("Picks by Race");
      expect(html).toContain("Analytics");
      expect(html).toContain("Hall of Fame");
      expect(html).not.toContain(error.message);
      expect(mocks[tab]).toHaveBeenCalledTimes(2);
      for (const other of ["standings", "picks", "analytics", "hall"] as const) {
        if (other !== tab) expect(mocks[other]).not.toHaveBeenCalled();
      }
    }
  );
});
