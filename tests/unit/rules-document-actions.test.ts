import { beforeEach, describe, expect, it, vi } from "vitest";
import { uploadSeasonRulesDocumentAction } from "@/app/admin/rules-document-actions";
import { setLeagueSeasonRulesDocumentAction } from "@/app/admin/season-actions";
import { MAX_RULES_PDF_BYTES } from "@/lib/season-rules";

const mocks = vi.hoisted(() => ({ requireAdmin: vi.fn(), season: vi.fn(), service: vi.fn(), rpc: vi.fn(), upload: vi.fn(), remove: vi.fn(), publicUrl: vi.fn(), from: vi.fn(), revalidate: vi.fn(), report: vi.fn(), redirect: vi.fn(), failure: vi.fn() }));
vi.mock("@/lib/admin", () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleSupabaseClient: mocks.service }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("@/lib/app-error-reporter", () => ({ reportAppError: mocks.report }));
vi.mock("@/lib/scoring-cache", () => ({ invalidateScoringCache: vi.fn() }));
vi.mock("@/app/admin/action-runtime", () => ({ asText: (value: unknown) => typeof value === "string" ? value.trim() : "", parsePositiveInteger: (value: string) => /^\d+$/.test(value) && Number(value) > 0 ? Number(value) : null,
  adminRedirect: mocks.redirect, reportAdminActionFailure: mocks.failure, createSeasonSafetySnapshot: vi.fn(), isUuid: vi.fn(),
  LEAGUE_SEASONS_MIGRATION_FILE: "old.sql", MAX_PROFILE_NAME_LENGTH: 100, OPERATIONS_HARDENING_MIGRATION_FILE: "old.sql" }));
const initial = { status: "idle" as const, message: "" };
const contents = "%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF\n";
const form = (file: File = new File([contents], "rules.pdf", { type: "application/pdf" })) => {
  const data = new FormData(); data.set("season_id", "2"); data.set("expected_rules_document_url", "/docs/old.pdf"); data.set("rules_pdf", file); return data;
};
const urlForm = (url: string) => { const data = new FormData(); data.set("season_id", "2"); data.set("expected_rules_document_url", "/docs/old.pdf"); data.set("rules_document_url", url); return data; };
beforeEach(() => {
  vi.resetAllMocks();
  mocks.requireAdmin.mockResolvedValue({ profile: { is_active: false, role: "admin" }, user: { id: "admin" }, supabase: { rpc: mocks.rpc, from: () => ({ select: () => ({ eq: () => ({ maybeSingle: mocks.season }) }) }) } });
  mocks.season.mockResolvedValue({ data: { id: 2, status: "active", rules_document_url: "/docs/old.pdf" }, error: null });
  mocks.rpc.mockResolvedValue({ data: { changed: true }, error: null });
  mocks.publicUrl.mockImplementation((path: string) => ({ data: { publicUrl: `https://example.supabase.co/storage/v1/object/public/season-rules/${path}` } }));
  mocks.from.mockReturnValue({ upload: mocks.upload, remove: mocks.remove, getPublicUrl: mocks.publicUrl });
  mocks.service.mockReturnValue({ storage: { from: mocks.from } });
  mocks.upload.mockResolvedValue({ error: null }); mocks.remove.mockResolvedValue({ error: null });
  mocks.report.mockResolvedValue({ recorded: true });
  mocks.redirect.mockImplementation((kind: string, message: string) => { throw new Error(`${kind}: ${message}`); });
  mocks.failure.mockImplementation(async () => { throw new Error("reported failure"); });
});

describe("rules upload", () => {
  it("authorizes first, validates before storage, publishes a unique immutable PDF, and preserves older files", async () => {
    const file = new File([contents], "private local filename.pdf", { type: "application/pdf" });
    const read = vi.spyOn(file, "arrayBuffer");
    expect((await uploadSeasonRulesDocumentAction(initial, form(file))).status).toBe("success");
    expect(mocks.requireAdmin.mock.invocationCallOrder[0]).toBeLessThan(read.mock.invocationCallOrder[0]);
    expect(read.mock.invocationCallOrder[0]).toBeLessThan(mocks.service.mock.invocationCallOrder[0]);
    expect(mocks.from).toHaveBeenCalledWith("season-rules");
    const path = mocks.upload.mock.calls[0][0];
    expect(path).toMatch(/^seasons\/2\/[0-9a-f-]{36}\.pdf$/);
    expect(mocks.upload).toHaveBeenCalledWith(path, expect.any(Uint8Array), { contentType: "application/pdf", upsert: false, cacheControl: "31536000" });
    expect(mocks.rpc).toHaveBeenCalledWith("set_league_season_rules_document", { p_season_id: 2, p_rules_document_url: expect.stringContaining(path), p_expected_rules_document_url: "/docs/old.pdf" });
    expect(mocks.remove).not.toHaveBeenCalled();
    expect(mocks.revalidate.mock.calls.flat()).toEqual(["/admin", "/rules"]);
  });
  it("does not read a file or create a service client for a non-admin", async () => {
    mocks.requireAdmin.mockRejectedValue(new Error("denied"));
    const file = new File([contents], "rules.pdf", { type: "application/pdf" }); const read = vi.spyOn(file, "arrayBuffer");
    await expect(uploadSeasonRulesDocumentAction(initial, form(file))).rejects.toThrow("denied");
    expect(read).not.toHaveBeenCalled(); expect(mocks.service).not.toHaveBeenCalled();
  });
  it.each([{ size: 0, type: "application/pdf" }, { size: MAX_RULES_PDF_BYTES + 1, type: "application/pdf" }, { size: 20, type: "text/html" }])("rejects invalid metadata without reading bytes or calling Storage", async ({ size, type }) => {
    const file = new File([new Uint8Array(size)], "rules.pdf", { type }); const read = vi.spyOn(file, "arrayBuffer");
    expect((await uploadSeasonRulesDocumentAction(initial, form(file))).status).toBe("error");
    expect(read).not.toHaveBeenCalled(); expect(mocks.service).not.toHaveBeenCalled();
  });
  it.each(["<html>fake PDF</html>", "%PDF-1.7\ntruncated"])("rejects a bad envelope before service access", async text => {
    expect((await uploadSeasonRulesDocumentAction(initial, form(new File([text], "rules.pdf", { type: "application/pdf" })))).message).toContain("not a complete PDF");
    expect(mocks.service).not.toHaveBeenCalled();
  });
  it("requires a saved expected URL even when it is empty", async () => {
    const data = form(); data.delete("expected_rules_document_url");
    expect((await uploadSeasonRulesDocumentAction(initial, data)).message).toContain("Refresh"); expect(mocks.service).not.toHaveBeenCalled();
  });
  it.each([null, { id: 2, status: "completed", rules_document_url: "/docs/old.pdf" }, { id: 2, status: "active", rules_document_url: "/docs/new.pdf" }])("rejects absent, closed, or changed seasons before reading the PDF", async season => {
    mocks.season.mockResolvedValue({ data: season, error: null });
    const file = new File([contents], "rules.pdf", { type: "application/pdf" }); const read = vi.spyOn(file, "arrayBuffer");
    expect((await uploadSeasonRulesDocumentAction(initial, form(file))).status).toBe("error");
    expect(read).not.toHaveBeenCalled(); expect(mocks.service).not.toHaveBeenCalled(); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("does not create storage objects if the season lookup fails", async () => {
    mocks.season.mockResolvedValue({ data: null, error: { message: "database failure" } });
    expect((await uploadSeasonRulesDocumentAction(initial, form())).message).toContain("could not be checked");
    expect(mocks.service).not.toHaveBeenCalled();
  });
  it("does not upload if configured public delivery is insecure", async () => {
    mocks.publicUrl.mockReturnValue({ data: { publicUrl: "http://example.test/rules.pdf" } });
    expect((await uploadSeasonRulesDocumentAction(initial, form())).status).toBe("error"); expect(mocks.upload).not.toHaveBeenCalled();
  });
  it.each(["P0001", "40001", "22023", "55P03", "PGRST202"])("removes only its new object after confirmed DB rejection %s", async code => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code, message: "internal detail" } });
    const result = await uploadSeasonRulesDocumentAction(initial, form());
    expect(result.status).toBe("error"); expect(result.message).not.toContain("internal detail");
    expect(mocks.remove).toHaveBeenCalledWith([mocks.upload.mock.calls[0][0]]);
    expect(mocks.remove).not.toHaveBeenCalledWith(["/docs/old.pdf"]);
  });
  it.each([{ code: "", message: "fetch failed" }, { code: "PGRST003", message: "gateway timeout" }])("retains a new PDF on ambiguous transport failure", async error => {
    mocks.rpc.mockResolvedValue({ data: null, error });
    expect((await uploadSeasonRulesDocumentAction(initial, form())).message).toContain("retained"); expect(mocks.remove).not.toHaveBeenCalled();
  });
  it("retains a new PDF when the database response throws or is empty", async () => {
    mocks.rpc.mockRejectedValueOnce(new Error("connection lost"));
    expect((await uploadSeasonRulesDocumentAction(initial, form())).message).toContain("retained");
    mocks.rpc.mockResolvedValueOnce({ data: null, error: null });
    expect((await uploadSeasonRulesDocumentAction(initial, form())).message).toContain("retained"); expect(mocks.remove).not.toHaveBeenCalled();
  });
  it("does not save a URL or remove files after upload failure", async () => {
    mocks.upload.mockResolvedValue({ error: { message: "network failure" } });
    expect((await uploadSeasonRulesDocumentAction(initial, form())).status).toBe("error"); expect(mocks.rpc).not.toHaveBeenCalled(); expect(mocks.remove).not.toHaveBeenCalled();
  });
  it("reports failed cleanup without hiding the failed save", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "40001", message: "stale" } }); mocks.remove.mockRejectedValue(new Error("storage unavailable"));
    expect((await uploadSeasonRulesDocumentAction(initial, form())).message).toContain("not changed");
    expect(mocks.report).toHaveBeenCalledWith(expect.objectContaining({ code: "rules-pdf-cleanup-failed" }));
  });
});

describe("existing rules URL action", () => {
  it("updates through the same atomic RPC and preserves expected-value validation", async () => {
    await expect(setLeagueSeasonRulesDocumentAction(urlForm("https://example.test/rules.pdf"))).rejects.toThrow("message: Season rules document updated");
    expect(mocks.rpc).toHaveBeenCalledWith("set_league_season_rules_document", { p_season_id: 2, p_rules_document_url: "https://example.test/rules.pdf", p_expected_rules_document_url: "/docs/old.pdf" });
  });
  it("can clear an existing document", async () => {
    await expect(setLeagueSeasonRulesDocumentAction(urlForm(""))).rejects.toThrow("message:");
    expect(mocks.rpc).toHaveBeenCalledWith("set_league_season_rules_document", expect.objectContaining({ p_rules_document_url: null }));
  });
  it.each(["//evil.test", "/\\evil.test", "https://user:pass@example.test", "https://example.test/a\nb.pdf"])("rejects unsafe URLs before the RPC", async value => {
    await expect(setLeagueSeasonRulesDocumentAction(urlForm(value))).rejects.toThrow("error: Use"); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("returns a useful migration hint only for a missing RPC", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "PGRST202", message: "function missing" } });
    await expect(setLeagueSeasonRulesDocumentAction(urlForm("/rules.pdf"))).rejects.toThrow("reported failure");
    expect(mocks.failure).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringContaining("20260919_add_season_rules_documents.sql") }));
  });
});
