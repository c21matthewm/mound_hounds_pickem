import { createECDH, randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { validPushEndpoint, validPushKeys, isWebPushConfigured, sendWebPushNotification, safePushPath } from "@/lib/web-push";
const keys = () => { const ec = createECDH("prime256v1"); ec.generateKeys(); return { publicKey: ec.getPublicKey().toString("base64url"), privateKey: ec.getPrivateKey().toString("base64url") }; };
const address = () => ({ endpoint: "https://fcm.googleapis.com/fcm/send/fictional", p256dh: keys().publicKey, auth: randomBytes(16).toString("base64url") });
beforeEach(() => { const key = keys(); vi.stubEnv("NEXT_PUBLIC_VAPID_PUBLIC_KEY", key.publicKey); vi.stubEnv("VAPID_PRIVATE_KEY", key.privateKey); vi.stubEnv("VAPID_SUBJECT", "mailto:fixture@example.test"); });
afterEach(() => vi.unstubAllEnvs());
describe("bounded VAPID transport", () => {
    it.each(["http://fcm.googleapis.com/token", "https://127.0.0.1/token", "https://[::1]/token", "https://10.0.0.1/token", "https://service.local/token", "https://internal.invalid/token", "https://fcm.googleapis.com.evil.invalid/token", "https://user:pass@fcm.googleapis.com/token", "https://fcm.googleapis.com:8443/token"])("rejects unsupported/SSRF destination %s", endpoint => expect(validPushEndpoint(endpoint)).toBe(false));
    it.each(["https://fcm.googleapis.com/fcm/send/example", "https://updates.push.services.mozilla.com/wpush/v2/example", "https://web.push.apple.com/example", "https://a.notify.windows.com/example"])("accepts browser relay %s", endpoint => expect(validPushEndpoint(endpoint)).toBe(true));
    it("requires actual P256 and auth bytes and matching VAPID pair", () => { const sub = address(); expect(validPushKeys(sub.p256dh, sub.auth)).toBe(true); expect(validPushKeys("a".repeat(87), sub.auth)).toBe(false); expect(isWebPushConfigured()).toBe(true); vi.stubEnv("VAPID_PRIVATE_KEY", keys().privateKey); expect(isWebPushConfigured()).toBe(false); });
    it.each([[201, "sent"], [404, "expired"], [410, "expired"], [429, "failed"], [503, "failed"]] as const)("classifies %i safely", async (code, status) => { const fetcher = vi.fn(async () => new Response(null, { status: code })); const sub = address(); const result = await sendWebPushNotification(sub, { title: "Reminder", body: "Pick before the deadline.", url: "/picks", tag: "fixture" }, { fetcher }); expect(result.status).toBe(status); const call = fetcher.mock.calls as unknown as [
        string,
        RequestInit
    ][]; expect(call[0][1].redirect).toBe("error"); expect(call[0][1].signal).toBeInstanceOf(AbortSignal); expect(Buffer.from(call[0][1].body as Uint8Array).toString()).not.toContain("Pick before"); expect(call[0][1].headers).toMatchObject({ TTL: 14400, "Content-Encoding": "aes128gcm" }); });
    it("sanitizes unknown send failures", async () => { const result = await sendWebPushNotification(address(), { title: "Reminder", body: "Open app", url: "/picks", tag: "fixture" }, { fetcher: vi.fn().mockRejectedValue(new Error("private endpoint secret")) }); expect(result).toEqual({ status: "failed", error: "Push delivery could not be confirmed." }); });
    it.each(["https://evil.invalid/", "//evil.invalid/", "javascript:alert(1)"])("keeps targets inside app %s", value => expect(safePushPath(value)).toBe("/picks"));
});
