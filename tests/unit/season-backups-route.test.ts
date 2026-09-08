import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { GET, POST } from "@/app/api/admin/season-backups/route";
import { createAdminRequestToken } from "@/lib/admin-request-token";
import { SCORING_CACHE_TAG } from "@/lib/scoring-cache";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  profile: vi.fn(),
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  rpc: vi.fn(),
  updateTag: vi.fn()
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({
  revalidatePath: mocks.revalidatePath,
  revalidateTag: mocks.revalidateTag,
  updateTag: mocks.updateTag
}));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: async () => ({
    auth: { getUser: mocks.getUser },
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: mocks.profile }) })
    }),
    rpc: mocks.rpc
  })
}));

const ADMIN_ID = "55210341-f76a-4a70-9123-0d8c2d7847aa";
const RESTORE_POINT_ID = "85881374-89f9-494c-b30d-81eb716260f5";
const restored = {
  restoredAt: "2026-09-04T12:00:00Z",
  safetyPointId: "d74958b5-118c-4999-8983-284063257f32",
  seasonYear: 2026
};

const restoreRequest = (body: Record<string, unknown> = {}, origin = "http://localhost:3000") =>
  new Request("http://localhost:3000/api/admin/season-backups", {
    body: JSON.stringify({
      action: "restore",
      confirmationYear: 2026,
      requestToken: createAdminRequestToken(ADMIN_ID, "season-recovery"),
      restorePointId: RESTORE_POINT_ID,
      ...body
    }),
    headers: {
      "Content-Type": "application/json",
      Origin: origin,
      "Sec-Fetch-Site": "same-origin",
      "X-Mound-Hounds-Request": "season-recovery"
    },
    method: "POST"
  });

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "unit-test-admin-request-signing-key");
  mocks.getUser.mockResolvedValue({ data: { user: { id: ADMIN_ID } }, error: null });
  mocks.profile.mockResolvedValue({ data: { role: "admin" }, error: null });
  mocks.rpc.mockResolvedValue({ data: restored, error: null });
  mocks.updateTag.mockImplementation(() => {
    throw new Error("updateTag can only be called from within a Server Action");
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("season restore endpoint", () => {
  it("returns the committed restore and immediately expires scoring data from the route", async () => {
    const response = await POST(restoreRequest());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: restored });
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("restore_season_from_restore_point_v2", {
      p_confirmation_year: 2026,
      p_restore_point_id: RESTORE_POINT_ID
    });
    expect(mocks.revalidateTag).toHaveBeenCalledExactlyOnceWith(SCORING_CACHE_TAG, { expire: 0 });
    expect(mocks.updateTag).not.toHaveBeenCalled();
    expect(mocks.revalidatePath.mock.calls).toEqual([
      ["/admin"],
      ["/dashboard"],
      ["/picks"],
      ["/leaderboard"]
    ]);
    expect(mocks.rpc.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.revalidateTag.mock.invocationCallOrder[0]
    );
  });

  it.each(["tag", "path"])(
    "keeps a committed restore successful when %s refresh fails and returns a safe warning",
    async (failure) => {
      const cacheError = new Error("Cache failed: api_key=private-value person@example.com");
      const invalidation = failure === "tag" ? mocks.revalidateTag : mocks.revalidatePath;
      invalidation.mockImplementationOnce(() => {
        throw cacheError;
      });

      const response = await POST(restoreRequest());
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data).toEqual(restored);
      expect(body.error).toBeUndefined();
      expect(body.warning).toContain("Season data was restored");
      expect(body.warning).toContain("Do not repeat the restore");
      expect(JSON.stringify(body)).not.toContain("private-value");
      expect(JSON.stringify(body)).not.toContain("person@example.com");
      expect(mocks.rpc).toHaveBeenCalledTimes(1);
      expect(console.error).toHaveBeenCalledExactlyOnceWith(
        "[season-recovery] Restore committed, but cache refresh failed:",
        "Cache failed: api_key=[redacted] [email]"
      );
    }
  );

  it("reports a database rejection as a failure without invalidating caches", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: "Confirmation year does not match the restore point." }
    });

    const response = await POST(restoreRequest());

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Confirmation year does not match the restore point."
    });
    expect(mocks.revalidateTag).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("rejects requests from another origin before authorizing or restoring", async () => {
    const response = await POST(restoreRequest({}, "https://other.example"));

    expect(response.status).toBe(403);
    expect(mocks.getUser).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("rejects an invalid admin request token before restoring", async () => {
    const response = await POST(restoreRequest({ requestToken: "invalid" }));

    expect(response.status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("rejects participants before restoring", async () => {
    mocks.profile.mockResolvedValueOnce({ data: { role: "participant" }, error: null });

    const response = await POST(restoreRequest());

    expect(response.status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

describe("portable season backup endpoints", () => {
  const snapshotText = '{"picks": [{"average_speed": 190.000}], "races": [{"id": 9007199254740993, "payout": 0.00, "race_name": "Indianapolis — \\"500\\""}], "season": {"season_year": 2026}}';
  const exported = {
    backupId: RESTORE_POINT_ID,
    checksum: createHash("sha256").update(snapshotText, "utf8").digest("hex"),
    createdAt: "2026-09-04T12:00:00Z",
    format: "mound-hounds-season-backup",
    formatVersion: 2,
    label: "Before correction",
    rowCounts: { picks: 1, races: 1 },
    schemaVersion: "20260904_portable_season_backups_v2",
    seasonYear: 2026,
    snapshotText,
    source: "manual"
  };
  const downloadRequest = () => new Request(
    `http://localhost:3000/api/admin/season-backups?id=${RESTORE_POINT_ID}`
  );

  it("preserves snapshot bytes and checksum across download, browser parsing, and upload", async () => {
    expect(() => JSON.parse(snapshotText)).not.toThrow();
    mocks.rpc.mockResolvedValueOnce({ data: exported, error: null });

    const download = await GET(downloadRequest());
    const document = JSON.parse(await download.text());

    expect(download.status).toBe(200);
    expect(download.headers.get("cache-control")).toBe("private, no-store");
    expect(download.headers.get("content-disposition")).toContain("attachment;");
    expect(document.snapshotText).toBe(snapshotText);
    expect(createHash("sha256").update(document.snapshotText, "utf8").digest("hex"))
      .toBe(document.checksum);
    expect(mocks.rpc).toHaveBeenNthCalledWith(1, "export_season_restore_point", {
      p_restore_point_id: RESTORE_POINT_ID
    });

    const imported = { id: RESTORE_POINT_ID, seasonYear: 2026 };
    mocks.rpc.mockResolvedValueOnce({ data: imported, error: null });
    const upload = await POST(restoreRequest({ action: "import", document }));

    expect(upload.status).toBe(200);
    expect(await upload.json()).toEqual({ data: imported });
    expect(mocks.rpc).toHaveBeenNthCalledWith(2, "import_season_restore_point_v2", {
      p_document: exported
    });
  });

  it("refuses an object snapshot export instead of silently serializing its numbers", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: { ...exported, snapshotText: undefined, snapshot: { payout: 0 } },
      error: null
    });

    const response = await GET(downloadRequest());

    expect(response.status).toBe(500);
    expect(response.headers.get("content-disposition")).toBeNull();
    expect((await response.json()).error).toContain("backup export could not be verified");
  });

  it("retains database rejection of an invalid legacy checksum without claiming import success", async () => {
    const message = "Legacy backup checksum validation failed. Download a new copy from the original stored restore point; this file cannot be imported safely.";
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message } });
    const response = await POST(restoreRequest({
      action: "import",
      document: { format: exported.format, formatVersion: 1, snapshot: { payout: 0 }, checksum: exported.checksum }
    }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: message });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("requires admin authorization before exporting snapshot contents", async () => {
    mocks.profile.mockResolvedValueOnce({ data: { role: "participant" }, error: null });

    const response = await GET(downloadRequest());

    expect(response.status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("returns not found for a deleted or unknown restore point", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: "P0002", message: "Selected restore point was not found." }
    });

    const response = await GET(downloadRequest());

    expect(response.status).toBe(404);
    expect(response.headers.get("content-disposition")).toBeNull();
  });
});
