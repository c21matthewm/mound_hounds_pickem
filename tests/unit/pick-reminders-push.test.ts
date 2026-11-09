import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
const mocks = vi.hoisted(() => ({ client: vi.fn(), season: vi.fn(), gate: vi.fn(), email: vi.fn(), configured: vi.fn(), devices: vi.fn(), current: vi.fn(), deliver: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleSupabaseClient: mocks.client }));
vi.mock("@/lib/seasons", () => ({ loadActiveLeagueSeason: mocks.season }));
vi.mock("@/lib/pickem-results-gate", () => ({ getPreviousRaceResultsGate: mocks.gate }));
vi.mock("@/lib/resend-email", () => ({ sendResendEmail: mocks.email }));
vi.mock("@/lib/web-push", () => ({ isWebPushConfigured: mocks.configured }));
vi.mock("@/lib/push-subscriptions", () => ({ loadPushSubscriptions: mocks.devices, loadCurrentPushSubscription: mocks.current, deliverDevicePush: mocks.deliver }));
import { sendDuePickReminders } from "@/lib/pick-reminders";
const person = { id: "fixture-user", full_name: "Private Fixture Name", team_name: "Private Team" };
const race = (id = 1) => ({ id, race_name: id === 1 ? "First Race" : "Second Race", pick_format: "standard", pick_window_key: "fixture-window", qualifying_start_at: "2027-05-02T12:00:00Z", race_date: "2027-05-03T12:00:00Z", season_id: 1, round_number: id });
let races = [race()], picks: Array<{
    race_id: number;
    user_id: string;
}> = [], queue: Array<Record<string, unknown>> = [];
let nextId = 1;
function fake() {
    const auth = { admin: { listUsers: vi.fn(async () => ({ data: { users: [{ id: person.id, email: "private@example.test" }] }, error: null })) } };
    const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
        if (name === "ensure_race_pick_field_snapshot")
            return { data: null, error: null };
        if (name === "claim_pick_reminder_delivery")
            return { data: queue.find(row => row.channel === args.p_channel)?.id ?? null, error: null };
        if (name === "validate_pick_reminder_delivery")
            return { data: { valid: true, races, missingRaces: races.filter(r => !picks.some(p => p.race_id === r.id)) }, error: null };
        throw Error("Unexpected RPC " + name);
    });
    const from = (table: string) => {
        let method = "select", values: unknown;
        const filters: Array<[
            string,
            unknown
        ]> = [];
        const q = { select: () => q, eq: (key: string, value: unknown) => { filters.push([key, value]); return q; }, in: () => q, gt: () => q, order: () => q, limit: () => q, neq: () => q, delete: () => { method = "delete"; return q; }, update: (data: unknown) => { method = "update"; values = data; return q; }, upsert: (data: unknown) => { method = "upsert"; values = data; return q; }, then: (resolve: (v: unknown) => unknown) => {
                let data: unknown = [];
                if (table === "races")
                    data = races;
                else if (table === "season_participants")
                    data = [{ profile_id: person.id }];
                else if (table === "profiles")
                    data = [person];
                else if (table === "picks")
                    data = picks;
                else if (table === "pick_reminders") {
                    if (method === "upsert")
                        for (const row of values as Array<Record<string, unknown>>) {
                            if (!queue.some(q => q.channel === row.channel))
                                queue.push({ ...row, id: nextId++ });
                        }
                    const id = filters.find(([key]) => key === "id")?.[1];
                    if (method === "update")
                        queue = queue.map(row => row.id === id ? { ...row, ...values as object } : row);
                    if (method === "delete")
                        queue = queue.filter(row => row.id !== id);
                    data = queue;
                }
                else
                    throw Error("Unexpected table " + table);
                return resolve({ data, error: null });
            } };
        return q;
    };
    return { auth, rpc, from };
}
beforeEach(() => { vi.resetAllMocks(); vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2027-05-01T12:00:00Z")); vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://fixture.example"); vi.stubEnv("PICK_EMAILS_ENABLED", "true"); vi.stubEnv("PICK_PUSH_ENABLED", "true"); races = [race()]; picks = []; queue = []; nextId = 1; mocks.season.mockResolvedValue({ id: 1 }); mocks.gate.mockResolvedValue({ status: "allowed" }); mocks.email.mockResolvedValue({ id: "fixture-email", skipped: false }); mocks.configured.mockReturnValue(true); mocks.devices.mockResolvedValue([{ id: "device-1", user_id: person.id }]); mocks.current.mockImplementation(async (_client, id) => ({ id, user_id: person.id })); mocks.deliver.mockResolvedValue({ status: "sent" }); mocks.client.mockReturnValue(fake()); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });
describe("independent reminder channels preserve domain gates", () => {
    it("keeps email-only delivery unchanged without device lookups", async () => { vi.stubEnv("PICK_PUSH_ENABLED", "false"); const result = await sendDuePickReminders(); expect(result.emailSent).toBe(1); expect(mocks.devices).not.toHaveBeenCalled(); expect(mocks.email.mock.calls[0][0]).toMatchObject({ to: "private@example.test", idempotencyKey: "pick-1-fixture-user-2d-email" }); expect(mocks.email.mock.calls[0][0].text).toContain("Private"); });
    it("sends push-only without loading Auth emails", async () => { vi.stubEnv("PICK_EMAILS_ENABLED", "false"); const result = await sendDuePickReminders(); expect(result.pushSent).toBe(1); expect(mocks.client().auth.admin.listUsers).not.toHaveBeenCalled(); expect(mocks.email).not.toHaveBeenCalled(); expect(JSON.stringify(mocks.deliver.mock.calls[0][2])).not.toContain("Private"); });
    it.each(["email", "push"])("a %s preparation failure does not block the other channel", async (channel) => { const spy = vi.spyOn(console, "error").mockImplementation(() => { }); if (channel === "email")
        mocks.client().auth.admin.listUsers.mockRejectedValueOnce(Error("Unavailable"));
    else
        mocks.devices.mockRejectedValueOnce(Error("Unavailable")); const result = await sendDuePickReminders(); expect(channel === "email" ? result.pushSent : result.emailSent).toBe(1); expect(channel === "email" ? result.emailFailed : result.pushFailed).toBe(1); spy.mockRestore(); });
    it("settles partial device failures before applying any-success-is-sent", async () => { vi.stubEnv("PICK_EMAILS_ENABLED", "false"); mocks.devices.mockResolvedValue([{ id: "device-1", user_id: person.id }, { id: "device-2", user_id: person.id }]); mocks.current.mockImplementation(async (_client, id) => { if (id === "device-2")
        throw Error("Consent unavailable"); return { id, user_id: person.id }; }); const result = await sendDuePickReminders(); expect(result.pushSent).toBe(1); expect(result.pushFailed).toBe(0); expect(queue[0]).toMatchObject({ delivery_status: "sent", delivery_id: "web-push:1/2" }); });
    it("names the actual missing doubleheader form and uses the shared window tag", async () => { vi.stubEnv("PICK_EMAILS_ENABLED", "false"); races = [race(), race(2)]; picks = [{ race_id: 1, user_id: person.id }]; await sendDuePickReminders(); const payload = mocks.deliver.mock.calls[0][2]; expect(payload.body).toContain("Second Race"); expect(payload.body).not.toContain("First Race"); expect(payload.url).toBe("/picks"); expect(payload.tag).toBe("pick-reminder-2d-fixture-window"); });
    it.each(["expired", "unsubscribed"])("discards %s devices without failure alarms", async (state) => { vi.stubEnv("PICK_EMAILS_ENABLED", "false"); if (state === "expired")
        mocks.deliver.mockResolvedValue({ status: "expired" });
    else
        mocks.current.mockResolvedValue(null); const result = await sendDuePickReminders(); expect(result.pushFailed).toBe(0); expect(result.queuePermanentFailed).toBe(0); expect(queue).toHaveLength(0); });
    it("previous-results gate blocks both channels before field or delivery work", async () => { mocks.gate.mockResolvedValue({ status: "blocked" }); const result = await sendDuePickReminders(); expect(result.reason).toBe("waiting_previous_results"); expect(mocks.devices).not.toHaveBeenCalled(); expect(mocks.client().rpc).not.toHaveBeenCalled(); });
});
