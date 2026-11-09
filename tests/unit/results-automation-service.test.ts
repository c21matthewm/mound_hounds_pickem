import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), revalidatePath: vi.fn(), revalidateTag: vi.fn(), finalize: vi.fn(), checkpoint: vi.fn(), after: vi.fn(), notify: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/server",()=>({after:mocks.after}));
vi.mock("@/lib/admin-results-push",()=>({notifyAdminsOfStagedResults:mocks.notify}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath, revalidateTag: mocks.revalidateTag }));
vi.mock("@/lib/results-automation-store", () => ({ automationRpc: mocks.rpc }));
vi.mock("@/app/admin/action-runtime", () => ({ finalizePublishedRaceWinner: mocks.finalize, createPublishedRaceCheckpoint: mocks.checkpoint }));
import { buildAutomationPreview, approveAndPublishStagedResults, stageOfficialResults } from "@/lib/results-automation";
import { parseSourcePayload } from "@/lib/results-automation-contract";
import type { AppSupabaseClient } from "@/lib/supabase/types";
const client = {} as AppSupabaseClient;
const payload = () => parseSourcePayload({ official_evidence:{kind:"html_header",header:"OFFICIAL RESULTS",sha256:"a".repeat(64),source_url:"https://www.indycar.com/results/2027/fixture/race-1"},race_id: 1, season: 2027, event_id: "fixture-event", session_id: "race-1", source_url: "https://www.indycar.com/results/2027/fixture/race-1", source_status: "official", race_average_speed: 170,
  rows: Array.from({ length: 6 }, (_, i) => ({ position: i + 1, driver_name: `Driver ${i + 1}`, car_number: String(i + 1), laps: 100, status: "Running", points: 50 - i, average_speed: i === 0 ? 170 : 169 })) });
const context = (): Parameters<typeof buildAutomationPreview>[1] => ({ race: { id: 1, race_name: "Fictional race", season_id: 1, season: 2027, season_status: "active", race_date: "2020-06-01T16:00:00Z", results_status: "draft", is_archived: false, pick_format: "standard", field_frozen_at: "2020-05-28T16:00:00Z", round_number: 1 },
  source: { event_id: "fixture-event", session_id: "race-1", source_url: payload().source_url, monitor_enabled: true, poll_after: "2020-06-01T19:00:00Z" },
  drivers: Array.from({ length: 6 }, (_, i) => ({ id: i + 1, driverName: `Driver ${i + 1}`, groupNumber: i + 1, isActive: true })),
  raceDriverGroups: Array.from({ length: 6 }, (_, i) => ({ race_id: 1, driver_id: i + 1, group_number: i + 1, qualifying_position: null })) });
beforeEach(() => { vi.clearAllMocks(); mocks.finalize.mockResolvedValue({ status: "finalized", winnerProfileId: null, errorMessage: null }); mocks.checkpoint.mockResolvedValue(null); });
describe("automated shared-preview validation", () => {
  it("accepts only a complete mapped frozen field from the exact official source", () => {
    const result = buildAutomationPreview(payload(), context());
    expect(result.flags).toEqual([]); expect(result.preview.isClean).toBe(true); expect(result.preview.publishRows).toHaveLength(6);
  });
  it.each([["points", "missing_points"], ["laps", "missing_laps"], ["status", "missing_status"], ["car_number", "missing_car"]] as const)("retains a missing %s as a review flag", (field, code) => {
    const input = payload(); input.rows[0][field] = null;
    const result = buildAutomationPreview(input, context());
    expect(result.preview.isClean).toBe(false); expect(result.flags).toEqual(expect.arrayContaining([expect.objectContaining({ code })]));
  });
  it.each(["provisional", "unknown"] as const)("does not treat %s data as official", status => {
    const input = payload(); input.source_status = status;
    expect(buildAutomationPreview(input, context()).flags).toEqual(expect.arrayContaining([expect.objectContaining({ code: "not_official" })]));
  });
  it("rejects the wrong doubleheader session and conflicting average speed", () => {
    const input = payload(); input.session_id = "race-2"; input.race_average_speed = 171;
    expect(buildAutomationPreview(input, context()).flags.map(flag => flag.code)).toEqual(expect.arrayContaining(["source_identity", "speed_conflict"]));
  });
  it("blocks readiness when the frozen field is absent", () => {
    const ctx = context(); ctx.race.field_frozen_at = null;
    expect(buildAutomationPreview(payload(), ctx).preview.isClean).toBe(false);
  });
  it("stages the canonical preview without invoking any publication side effect", async () => {
    mocks.rpc.mockResolvedValueOnce({ context: context(), context_hash: "a".repeat(64) }).mockResolvedValueOnce({ status: "staged", run: { id: "fixture-run", race_id: 1, status: "READY_TO_PUBLISH", flags: [], preview: { raceName: "Fictional race" } } });
    expect((await stageOfficialResults(client, payload())).status).toBe("staged");
    expect(mocks.rpc.mock.calls.map(call => call[1])).toEqual(["get_results_automation_context", "stage_race_results"]);
    expect(mocks.after).toHaveBeenCalledOnce();
    expect(mocks.finalize).not.toHaveBeenCalled(); expect(mocks.checkpoint).not.toHaveBeenCalled(); expect(mocks.revalidateTag).not.toHaveBeenCalled();
  });
});
describe("publication hooks", () => {
  it("stops all side effects when approval fails", async () => {
    mocks.rpc.mockRejectedValueOnce(new Error("Unresolved flags"));
    await expect(approveAndPublishStagedResults(client, "run", "message", "admin")).rejects.toThrow("Unresolved flags");
    expect(mocks.rpc).toHaveBeenCalledOnce(); expect(mocks.finalize).not.toHaveBeenCalled(); expect(mocks.revalidateTag).not.toHaveBeenCalled();
  });
  it("retains winner/checkpoint hooks and invalidates the route-safe scoring tag after publication", async () => {
    mocks.rpc.mockResolvedValueOnce({ status: "approved" }).mockResolvedValueOnce({ status: "published", race_id: 1, race_name: "Fictional race", season_id: 1, round_number: 1 });
    expect((await approveAndPublishStagedResults(client, "run", "message", "admin")).status).toBe("published");
    expect(mocks.rpc.mock.calls.map(call => call[1])).toEqual(["approve_staged_race_results", "publish_staged_race_results"]);
    expect(mocks.finalize).toHaveBeenCalledWith(client, 1); expect(mocks.checkpoint).toHaveBeenCalledOnce();
    expect(mocks.revalidateTag).toHaveBeenCalledWith("league-scoring-v3", { expire: 0 });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/leaderboard");
  });
  it("reports committed publication with a warning when cache and follow-up hooks fail", async () => {
    mocks.rpc.mockResolvedValueOnce({ status: "approved" }).mockResolvedValueOnce({ status: "published", race_id: 1, race_name: "Fictional race", season_id: 1, round_number: 1 });
    mocks.revalidateTag.mockImplementation(() => { throw new Error("Cache unavailable"); });
    mocks.finalize.mockRejectedValueOnce(new Error("Winner follow-up unavailable"));
    mocks.checkpoint.mockRejectedValueOnce(new Error("Checkpoint unavailable"));
    const result = await approveAndPublishStagedResults(client, "run", "message", "admin");
    expect(result.status).toBe("published"); expect(result.message).toContain("follow-up");
    mocks.revalidateTag.mockReset();
  });
  it("handles an already-consumed approval without another publication or checkpoint", async () => {
    mocks.rpc.mockResolvedValueOnce({ status: "already_processed" });
    expect((await approveAndPublishStagedResults(client, "run", "message", "admin")).status).toBe("already_processed");
    expect(mocks.rpc).toHaveBeenCalledOnce(); expect(mocks.finalize).not.toHaveBeenCalled(); expect(mocks.checkpoint).not.toHaveBeenCalled();
    expect(mocks.revalidateTag).toHaveBeenCalled();
  });
});


it("duplicate staging schedules no duplicate Admin push",async()=>{
 mocks.rpc.mockResolvedValueOnce({context:context(),context_hash:"a".repeat(64)}).mockResolvedValueOnce({status:"already_processed",run:{id:"fixture-run",race_id:1,status:"READY_TO_PUBLISH",flags:[],preview:{}}});
 await stageOfficialResults(client,payload());expect(mocks.after).not.toHaveBeenCalled();
});
it("push failure cannot undo successful staging",async()=>{
 mocks.rpc.mockResolvedValueOnce({context:context(),context_hash:"a".repeat(64)}).mockResolvedValueOnce({status:"staged",run:{id:"fixture-run",race_id:1,status:"NEEDS_REVIEW",flags:[{}],preview:{}}});
 mocks.after.mockImplementationOnce(()=>{throw new Error("Unavailable");});
 const spy=vi.spyOn(console,"error").mockImplementation(()=>{});
 expect((await stageOfficialResults(client,payload())).status).toBe("staged");spy.mockRestore();
});
