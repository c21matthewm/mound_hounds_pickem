import "server-only";
import { createECDH } from "node:crypto";
import webpush from "web-push";
export type WebPushPayload = {
    title: string;
    body: string;
    url: string;
    tag: string;
    icon?: string;
    badge?: string;
};
export type PushAddress = {
    endpoint: string;
    p256dh: string;
    auth: string;
};
export type PushResult = {
    status: "sent" | "expired" | "failed";
    error?: string;
};
const allowedHosts = ["push.services.mozilla.com", "web.push.apple.com", "notify.windows.com"];
export function validPushEndpoint(value: unknown): value is string {
    if (typeof value !== "string" || value.length > 2048 || !/^https:\/\//.test(value))
        return false;
    try {
        const url = new URL(value);
        // Trusted browser relays only. No development bypass or redirects to arbitrary hosts.
        return !url.username && !url.password && !url.port && !url.hash && url.pathname !== "/"
            && (url.hostname === "fcm.googleapis.com" || allowedHosts.some(host => url.hostname === host || url.hostname.endsWith(`.${host}`)));
    }
    catch {
        return false;
    }
}
function decodeKey(value: unknown, length: number): Buffer | null {
    if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value))
        return null;
    const decoded = Buffer.from(value, "base64url");
    return decoded.length === length && decoded.toString("base64url") === value ? decoded : null;
}
export function validPushKeys(p256dh: unknown, auth: unknown): boolean {
    const key = decodeKey(p256dh, 65);
    try {
        if (!key || key[0] !== 4 || !decodeKey(auth, 16))
            return false;
        const ec = createECDH("prime256v1");
        ec.generateKeys();
        ec.computeSecret(key);
        return true;
    }
    catch {
        return false;
    }
}
function configuration() {
    const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";
    const privateKey = process.env.VAPID_PRIVATE_KEY ?? "";
    const subject = process.env.VAPID_SUBJECT ?? "";
    try {
        const pub = decodeKey(publicKey, 65), priv = decodeKey(privateKey, 32);
        const uri = new URL(subject);
        if (!pub || !priv || !["mailto:", "https:"].includes(uri.protocol) || (uri.protocol === "mailto:" && !uri.pathname.includes("@")))
            return null;
        const ec = createECDH("prime256v1");
        ec.setPrivateKey(priv);
        if (!ec.getPublicKey().equals(pub))
            return null;
        return { publicKey, privateKey, subject };
    }
    catch {
        return null;
    }
}
export const isWebPushConfigured = (): boolean => configuration() !== null;
export const getPublicVapidKey = (): string | null => configuration()?.publicKey ?? null;
export function safePushPath(value: string): string {
    const origin = "https://push-target.invalid";
    try {
        const url = new URL(value, origin);
        if (url.origin !== origin || url.username || url.password || !value.startsWith("/") || value.startsWith("//"))
            return "/picks";
        return url.pathname + url.search;
    }
    catch {
        return "/picks";
    }
}
export async function sendWebPushNotification(subscription: PushAddress, payload: WebPushPayload, { ttl = 14400, fetcher = fetch }: {
    ttl?: number;
    fetcher?: typeof fetch;
} = {}): Promise<PushResult> {
    const vapidDetails = configuration();
    if (!vapidDetails || !validPushEndpoint(subscription.endpoint) || !validPushKeys(subscription.p256dh, subscription.auth))
        return { status: "failed", error: "Push configuration or subscription invalid." };
    const body = JSON.stringify({ title: payload.title.slice(0, 100), body: payload.body.slice(0, 500), url: safePushPath(payload.url), tag: payload.tag.slice(0, 180), icon: "/icons/icon-192.png", badge: "/icons/icon-192.png" });
    if (Buffer.byteLength(body) > 2048)
        return { status: "failed", error: "Notification exceeds its limit." };
    try {
        // The audited library owns RFC8291 encryption/VAPID; fetch owns total timeout,
        // redirect refusal and connection cleanup. Never call its unbounded sender.
        const details = webpush.generateRequestDetails({ endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } }, body, { vapidDetails, contentEncoding: "aes128gcm", TTL: Math.max(0, Math.min(ttl, 86400)), urgency: "normal" });
        const response = await fetcher(subscription.endpoint, { method: "POST", headers: details.headers as HeadersInit,
            body: new Uint8Array(details.body as Buffer), redirect: "error", signal: AbortSignal.timeout(10000) });
        await response.body?.cancel();
        if (response.status === 404 || response.status === 410)
            return { status: "expired" };
        return response.ok ? { status: "sent" } : { status: "failed", error: "Push relay rejected the notification." };
    }
    catch {
        return { status: "failed", error: "Push delivery could not be confirmed." };
    }
}
