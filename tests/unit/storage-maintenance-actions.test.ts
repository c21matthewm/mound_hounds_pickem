import { beforeEach, describe, expect, it, vi } from "vitest";
import { auditStorageImagesAction } from "@/app/admin/storage-maintenance-actions";

const mocks = vi.hoisted(() => ({ requireAdmin: vi.fn(), service: vi.fn(), audit: vi.fn(), report: vi.fn() }));
vi.mock("@/lib/admin", () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleSupabaseClient: mocks.service }));
vi.mock("@/lib/supabase/env", () => ({ getSupabaseEnv: () => ({ url: "https://example.supabase.co" }) }));
vi.mock("@/lib/storage-maintenance", () => ({ auditOrphanedStorageImages: mocks.audit }));
vi.mock("@/lib/app-error-reporter", () => ({ reportAppError: mocks.report, errorReference: () => " Reference: TEST." }));

beforeEach(() => {
  vi.resetAllMocks();
  mocks.requireAdmin.mockResolvedValue({ profile: { is_active: true }, user: { id: "admin" } });
  mocks.service.mockReturnValue({ name: "privileged-client" });
  mocks.report.mockResolvedValue({ recorded: true });
});

describe("storage media audit authorization", () => {
  it("authorizes before constructing the service client and returns only the audit projection", async () => {
    const audit = { completedAt: "2027-01-01T00:00:00Z", buckets: [], restorePointCount: 0 };
    mocks.audit.mockResolvedValue(audit);
    expect(await auditStorageImagesAction()).toEqual({ audit, error: null });
    expect(mocks.requireAdmin.mock.invocationCallOrder[0]).toBeLessThan(mocks.service.mock.invocationCallOrder[0]);
    expect(mocks.audit).toHaveBeenCalledWith({ name: "privileged-client" }, "https://example.supabase.co");
  });

  it("does not access storage for a participant or unauthenticated request", async () => {
    mocks.requireAdmin.mockRejectedValue(new Error("redirect"));
    await expect(auditStorageImagesAction()).rejects.toThrow("redirect");
    expect(mocks.service).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("allows an administrator who is not participating in the league", async () => {
    mocks.requireAdmin.mockResolvedValue({ profile: { is_active: false }, user: { id: "admin" } });
    mocks.audit.mockResolvedValue({ buckets: [], restorePointCount: 0 });
    expect((await auditStorageImagesAction()).error).toBeNull();
    expect(mocks.service).toHaveBeenCalledOnce();
  });

  it("clears the report on a failed scan and keeps technical details out of the response", async () => {
    mocks.audit.mockRejectedValue(new Error("internal implementation detail"));
    const result = await auditStorageImagesAction();
    expect(result.audit).toBeNull();
    expect(result.error).toContain("could not finish");
    expect(result.error).not.toContain("internal implementation detail");
    expect(mocks.report).toHaveBeenCalledWith(expect.objectContaining({ actorProfileId: "admin", code: "storage-media-audit-failed" }));
  });
});
