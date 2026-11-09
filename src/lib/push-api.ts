import "server-only";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/service-role";
import { getPublicVapidKey, isWebPushConfigured, validPushEndpoint, validPushKeys } from "@/lib/web-push";
import { deliverDevicePush } from "@/lib/push-subscriptions";
const PUSH_BODY_LIMIT = 8192;
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
async function body(request: Request): Promise<Record<string, unknown>> {
    const reader = request.body?.getReader();
    if (!reader)
        throw new Error("Invalid body");
    let size = 0;
    const chunks: Uint8Array[] = [];
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Timeout")), 5000); });
    try {
        while (true) {
            const next = await Promise.race([reader.read(), deadline]);
            if (next.done)
                break;
            size += next.value.byteLength;
            if (size > PUSH_BODY_LIMIT)
                throw new Error("Too large");
            chunks.push(next.value);
        }
        const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        if (!value || typeof value !== "object" || Array.isArray(value))
            throw new Error("Invalid body");
        return value;
    }
    finally {
        clearTimeout(timer);
        await reader.cancel().catch(() => { });
    }
}
export async function handlePushRequest(request: Request, test = false): Promise<Response> {
    if (request.method !== "GET" && request.headers.get("origin") !== new URL(request.url).origin)
        return reply({ error: "Use this app to manage device notifications." }, 403);
    const client = await createServerSupabaseClient();
    const { data: { user } } = await client.auth.getUser();
    if (!user)
        return reply({ error: "Sign in to manage notifications." }, 401);
    try {
        const store = client;
        if (request.method === "GET") {
            const endpoint = new URL(request.url).searchParams.get("endpoint");
            const { data, error } = await store.from("push_subscriptions").select("id,is_active").eq("user_id", user.id).eq("is_active", true).limit(10);
            if (error)
                return reply({ configured: false, publicKey: null, enabled: false, setupRequired: true });
            let enabled = false;
            if (endpoint && validPushEndpoint(endpoint)) {
                const match = await store.from("push_subscriptions").select("is_active").eq("user_id", user.id).eq("endpoint", endpoint).maybeSingle();
                enabled = match.data?.is_active === true;
            }
            return reply({ configured: isWebPushConfigured(), publicKey: getPublicVapidKey(), hasDevices: !!data?.length, enabled, pickDeliveryEnabled: process.env.PICK_PUSH_ENABLED === "true" });
        }
        const input = await body(request);
        if (request.method === "DELETE" && input.allDevices === true) {
            const {error}=await store.from("push_subscriptions").delete().eq("user_id",user.id);
            return error?reply({error:"Devices could not be disabled."},503):reply({enabled:false});
        }
        const endpoint = input.endpoint;
        if (!validPushEndpoint(endpoint))
            return reply({ error: "This browser supplied an unsupported push subscription." }, 400);
        if (request.method === "DELETE") {
            const { error } = await store.from("push_subscriptions").delete().eq("user_id", user.id).eq("endpoint", endpoint);
            return error ? reply({ error: "Device could not be disabled." }, 503) : reply({ enabled: false });
        }
        if (input.action === "status") {
            const { data, error } = await store.from("push_subscriptions").select("is_active").eq("user_id", user.id).eq("endpoint", endpoint).maybeSingle();
            return error ? reply({ error: "Device status unavailable." }, 503) : reply({ enabled: data?.is_active === true });
        }
        if (!isWebPushConfigured())
            return reply({ error: "Push delivery is not configured yet." }, 503);
        if (test) {
            const { data: claimed, error } = await store.rpc("claim_push_test", { p_endpoint: endpoint });
            if (error || claimed !== true)
                return reply({ error: "Enable this device first, or wait one minute before another test." }, 429);
            const { data: subscription } = await store.from("push_subscriptions").select("*").eq("user_id", user.id).eq("endpoint", endpoint).eq("is_active", true).maybeSingle();
            if (!subscription)
                return reply({ error: "Enable this device first." }, 409);
            const result = await deliverDevicePush(createServiceRoleSupabaseClient(), subscription, { title: "Mound Hounds Test Notification", body: "Notifications are enabled on this device.", url: "/picks", tag: "mound-hounds-test" }, 60);
            return result.status === "sent" ? reply({ sent: true }) : reply({ error: result.status === "expired" ? "This device subscription expired. Enable it again." : "The notification could not be sent. Try again later." }, 503);
        }
        const keys = input.keys as Record<string, unknown> | undefined;
        if (!keys || !validPushKeys(keys.p256dh, keys.auth))
            return reply({ error: "Invalid browser push keys." }, 400);
        const { data: existing } = await store.from("push_subscriptions").select("id").eq("user_id", user.id).eq("endpoint", endpoint).maybeSingle();
        const values = { endpoint, p256dh: String(keys.p256dh), auth: String(keys.auth), is_active: true, pick_reminders_enabled: true, device_label: typeof input.deviceLabel === "string" ? input.deviceLabel.slice(0, 80) : null, user_agent: request.headers.get("user-agent")?.slice(0, 300) ?? null };
        // Owner-scoped update/insert. Never service-role upsert an endpoint owned by
        // another account, and never overwrite server-owned delivery/test timestamps.
        const result = existing ? await store.from("push_subscriptions").update(values).eq("id", existing.id).eq("user_id", user.id) : await store.from("push_subscriptions").insert({ ...values, user_id: user.id });
        return result.error ? reply({ error: "Device registration failed. If this device was used by another account, reset its browser subscription and try again." }, 409) : reply({ enabled: true });
    }
    catch {
        return reply({ error: "Device notification settings could not be updated." }, 400);
    }
}
