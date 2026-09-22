import { beforeEach, describe, expect, it, vi } from "vitest";
import { importHistoricalHallOfFameAction } from "@/app/admin/historical-hall-of-fame-actions";

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), requireAdmin: vi.fn(), revalidate: vi.fn(), report: vi.fn() }));
vi.mock("@/lib/admin", () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("@/lib/app-error-reporter", () => ({ reportAppError: mocks.report, errorReference: () => " Reference: TEST1234." }));
const idle = { status: "idle" as const, message: "" };
const form = (paste = "1\tWinner\t40\t25\t15\n2\tOther\t35\t20\t15") => {
  const data = new FormData();
  data.set("season_year", "2024");
  data.set("race_count", "2");
  data.set("spreadsheet_paste", paste);
  data.set("confirm_historical_import", "yes");
  return data;
};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.requireAdmin.mockResolvedValue({ profile: { is_active: true }, user: { id: "keeper-admin" }, supabase: { rpc: mocks.rpc } });
  mocks.rpc.mockResolvedValue({ data: 7, error: null });
  mocks.report.mockResolvedValue({ correlationId: "test1234", recorded: true });
});

describe("historical archive action", () => {
  it("reparses on the server and calls only the create-only RPC", async () => {
    expect(await importHistoricalHallOfFameAction(idle, form())).toMatchObject({ status: "success", seasonYear: 2024 });
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("import_historical_hall_of_fame_season", {
      p_season_year: 2024,
      p_race_count: 2,
      p_entries: [
        { final_rank: 1, team_name: "Winner", total_points: 40, race_breakdown: [] },
        { final_rank: 2, team_name: "Other", total_points: 35, race_breakdown: [] }
      ]
    });
    expect(mocks.revalidate.mock.calls).toEqual([["/admin"], ["/leaderboard"]]);
  });

  it("requires administrator authentication before any work", async () => {
    mocks.requireAdmin.mockRejectedValue(new Error("redirect to login"));
    await expect(importHistoricalHallOfFameAction(idle, form())).rejects.toThrow("redirect to login");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("allows an administrator who is not participating in the league", async () => {
    mocks.requireAdmin.mockResolvedValue({ profile: { is_active: false }, user: { id: "keeper-admin" }, supabase: { rpc: mocks.rpc } });
    expect(await importHistoricalHallOfFameAction(idle, form())).toMatchObject({ status: "success" });
    expect(mocks.rpc).toHaveBeenCalledOnce();
  });

  it("requires explicit confirmation and rejects forged invalid standings", async () => {
    const data = form();
    data.delete("confirm_historical_import");
    expect((await importHistoricalHallOfFameAction(idle, data)).message).toContain("Confirm");
    expect((await importHistoricalHallOfFameAction(idle, form("1\tA\t40\n1\tB\t40"))).message).toContain("exactly one rank-1");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("preserves an existing archive when uniqueness rejects a duplicate or concurrent import", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "23505", message: "duplicate key" } });
    expect((await importHistoricalHallOfFameAction(idle, form())).message).toContain("cannot replace");
    expect(mocks.revalidate).not.toHaveBeenCalled();
    expect(mocks.report).not.toHaveBeenCalled();
  });

  it("gives actionable migration guidance when the create-only RPC is not installed", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "PGRST202", message: "missing function" } });
    expect((await importHistoricalHallOfFameAction(idle, form())).message).toContain("20260913_add_historical_hall_of_fame_import.sql");
  });

  it("reports unexpected failures without putting spreadsheet data into error context", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "57014", message: "timeout" } });
    const result = await importHistoricalHallOfFameAction(idle, form());
    expect(result.status).toBe("error");
    expect(result.message).toContain("Check Hall of Fame");
    expect(mocks.report).toHaveBeenCalledOnce();
    expect(mocks.report.mock.calls[0][0].context).toEqual({ entityId: 2024, entityType: "hall_of_fame_season", operation: "import" });
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });
});
