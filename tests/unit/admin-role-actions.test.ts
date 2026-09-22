import { beforeEach, describe, expect, it, vi } from "vitest";
import { updateParticipantRoleAction } from "@/app/admin/role-actions";

const ADMIN = "6badc049-4960-45ee-92e9-5b21dba0d4f1";
const PARTICIPANT = "90000000-0000-4000-8000-000000000002";
const mocks = vi.hoisted(() => ({ requireAdmin: vi.fn(), rpc: vi.fn(), revalidate: vi.fn(), invalidate: vi.fn(), redirect: vi.fn(), report: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("@/lib/admin", () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock("@/lib/scoring-cache", () => ({ invalidateScoringCache: mocks.invalidate }));
vi.mock("@/app/admin/action-runtime", () => ({
  adminRedirect: mocks.redirect,
  asText: (value: unknown) => typeof value === "string" ? value.trim() : "",
  isUuid: (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value),
  reportAdminActionFailure: mocks.report
}));

const form = (values: Record<string, string | undefined> = {}) => {
  const data = new FormData();
  for (const [key, value] of Object.entries({ profile_id: PARTICIPANT, role: "admin", expected_role: "participant", ...values })) if (value !== undefined) data.set(key, value);
  return data;
};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.requireAdmin.mockResolvedValue({ user: { id: ADMIN }, supabase: { rpc: mocks.rpc } });
  mocks.rpc.mockResolvedValue({ data: { role: "admin" }, error: null });
  mocks.redirect.mockImplementation((key, message) => { throw new Error(`${key}: ${message}`); });
  mocks.report.mockImplementation(async ({ error }) => { throw new Error(error.message); });
});

describe("participant role delegation", () => {
  it("requires an administrator before validating or writing", async () => {
    mocks.requireAdmin.mockRejectedValue(new Error("Admin access required"));
    await expect(updateParticipantRoleAction(form())).rejects.toThrow("Admin access required");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each([
    { profile_id: "not-a-uuid" }, { role: "owner" }, { expected_role: "owner" }, { role: "participant" }
  ])("rejects malformed or unchanged role requests: %j", async (fields) => {
    await expect(updateParticipantRoleAction(form(fields))).rejects.toThrow("Select a valid participant and role change");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("rejects self-demotion, including a differently cased UUID", async () => {
    await expect(updateParticipantRoleAction(form({ profile_id: ADMIN.toUpperCase(), role: "participant", expected_role: "admin" }))).rejects.toThrow("cannot remove your own admin access");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("dispatches promotion with an expected previous role to the atomic audited RPC", async () => {
    await expect(updateParticipantRoleAction(form())).rejects.toThrow("message: Admin access granted");
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("admin_update_participant_role", {
      p_profile_id: PARTICIPANT, p_role: "admin", p_expected_role: "participant"
    });
    expect(mocks.invalidate).toHaveBeenCalledOnce();
    expect(mocks.revalidate.mock.calls.map(([path]) => path)).toEqual(["/admin", "/dashboard", "/picks", "/leaderboard"]);
    expect(mocks.report).not.toHaveBeenCalled();
  });
  it("dispatches co-admin demotion without changing registration or account eligibility", async () => {
    await expect(updateParticipantRoleAction(form({ role: "participant", expected_role: "admin" }))).rejects.toThrow("message: Admin access removed");
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("admin_update_participant_role", {
      p_profile_id: PARTICIPANT, p_role: "participant", p_expected_role: "admin"
    });
  });
  it.each([
    "Another admin with participation enabled is required before removing this admin.",
    "This participant’s role has changed. Refresh Participants before trying again.",
    "Participant was not found.",
    "Save this participant’s name and team before granting admin access.",
    "Audit write failed."
  ])("does not claim success on a transactional failure: %s", async (message) => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "P0001", message } });
    await expect(updateParticipantRoleAction(form())).rejects.toThrow(message);
    expect(mocks.report).toHaveBeenCalledWith(expect.objectContaining({ actorProfileId: ADMIN, tab: "participants" }));
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });
  it.each(["55P03", "40P01", "40001"])("makes concurrent-write errors retryable: %s", async (code) => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code, message: "database detail" } });
    await expect(updateParticipantRoleAction(form())).rejects.toThrow("Another account change is in progress");
    expect(mocks.report).not.toHaveBeenCalled();
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });
  it.each(["PGRST202", "42883"])("fails closed if the migration is missing: %s", async (code) => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code, message: "database detail" } });
    await expect(updateParticipantRoleAction(form())).rejects.toThrow("not configured in this database yet");
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });
});
