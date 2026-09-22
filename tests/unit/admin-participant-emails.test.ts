import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadAdminParticipantEmails } from "@/lib/admin-participant-emails";

const mocks = vi.hoisted(() => ({ client: vi.fn(), list: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleSupabaseClient: mocks.client }));
const page = (users: Array<{ id: string; email?: string }>) => ({ data: { users, nextPage: null, lastPage: 0, total: 0 }, error: null });
beforeEach(() => {
  vi.resetAllMocks();
  mocks.client.mockReturnValue({ auth: { admin: { listUsers: mocks.list } } });
});

describe("admin participant email lookup", () => {
  it("does not fetch Auth users when no profiles are requested", async () => {
    expect(await loadAdminParticipantEmails([])).toEqual({ emailsByProfileId: new Map(), warning: null });
    expect(mocks.client).not.toHaveBeenCalled();
  });
  it("returns only requested emails and no Auth metadata", async () => {
    mocks.list.mockResolvedValue(page([{ id: "wanted", email: "member@example.test" }, { id: "other", email: "other@example.test" }]));
    expect(await loadAdminParticipantEmails(["wanted", "wanted"])).toEqual({ emailsByProfileId: new Map([["wanted", "member@example.test"]]), warning: null });
    expect(mocks.list).toHaveBeenCalledExactlyOnceWith({ page: 1, perPage: 200 });
  });
  it("paginates until the requested profiles are found and then stops", async () => {
    mocks.list.mockResolvedValueOnce(page(Array.from({ length: 200 }, (_, i) => ({ id: `unrelated-${i}` }))))
      .mockResolvedValueOnce(page([{ id: "wanted", email: "member@example.test" }]));
    expect((await loadAdminParticipantEmails(["wanted"])).emailsByProfileId.get("wanted")).toBe("member@example.test");
    expect(mocks.list.mock.calls).toEqual([[{ page: 1, perPage: 200 }], [{ page: 2, perPage: 200 }]]);
  });
  it("does not treat a phone-only account as a failed Auth lookup", async () => {
    mocks.list.mockResolvedValue(page([{ id: "phone-only" }]));
    expect(await loadAdminParticipantEmails(["phone-only"])).toEqual({ emailsByProfileId: new Map(), warning: null });
  });
  it("discards partial results and warns when a later page fails", async () => {
    mocks.list.mockResolvedValueOnce(page([{ id: "found", email: "member@example.test" }, ...Array.from({ length: 199 }, (_, i) => ({ id: `other-${i}` }))]))
      .mockResolvedValueOnce({ data: null, error: { message: "auth response should not be exposed" } });
    const result = await loadAdminParticipantEmails(["found", "missing"]);
    expect(result.emailsByProfileId.size).toBe(0);
    expect(result.warning).toContain("could not be loaded");
    expect(result.warning).not.toContain("auth response");
  });
  it("warns and returns no partial directory if an account disappears during lookup", async () => {
    mocks.list.mockResolvedValue(page([{ id: "found", email: "member@example.test" }]));
    const result = await loadAdminParticipantEmails(["found", "missing"]);
    expect(result.emailsByProfileId.size).toBe(0);
    expect(result.warning).toContain("refresh");
  });
  it("bounds page requests even when Auth repeats full pages", async () => {
    mocks.list.mockResolvedValue(page(Array.from({ length: 200 }, (_, i) => ({ id: `unrelated-${i}` }))));
    const result = await loadAdminParticipantEmails(["missing"]);
    expect(mocks.list).toHaveBeenCalledTimes(25);
    expect(result.warning).toContain("could not be loaded");
  });
  it("preserves the participant editor when the server credential is unavailable", async () => {
    mocks.client.mockImplementation(() => { throw new Error("Missing a credential"); });
    const result = await loadAdminParticipantEmails(["wanted"]);
    expect(result.warning).toContain("You can still manage participants");
    expect(result.emailsByProfileId.size).toBe(0);
  });
});
