import "server-only";
import type { AppSupabaseClient, PushSubscriptionRow } from "@/lib/supabase/types";
import { sendWebPushNotification, type WebPushPayload } from "@/lib/web-push";
export async function loadPushSubscriptions(client: AppSupabaseClient, userIds: string[], picksOnly = false): Promise<PushSubscriptionRow[]> {
    if (!userIds.length)
        return [];
    const rows: PushSubscriptionRow[] = [];
    for (let offset = 0; offset < userIds.length; offset += 100) {
        let query = client.from("push_subscriptions").select("*").in("user_id", userIds.slice(offset, offset + 100)).eq("is_active", true);
        if (picksOnly)
            query = query.eq("pick_reminders_enabled", true);
        const { data, error } = await query.order("id").limit(1000);
        if (error)
            throw new Error("Device subscriptions could not be loaded.");
        rows.push(...(data ?? []));
    }
    return rows;
}
export async function loadCurrentPushSubscription(client: AppSupabaseClient, id: string, userId: string) {
    const { data, error } = await client.from("push_subscriptions").select("*").eq("id", id).eq("user_id", userId).eq("is_active", true).eq("pick_reminders_enabled", true).maybeSingle();
    if (error)
        throw new Error("Device consent could not be checked.");
    return data;
}
export async function deliverDevicePush(client: AppSupabaseClient, subscription: PushSubscriptionRow, payload: WebPushPayload, ttl?: number) {
    const result = await sendWebPushNotification(subscription, payload, { ttl });
    const table = client.from("push_subscriptions");
    // Deleted devices release their unique endpoint and cannot accumulate dead keys.
    const response = result.status === "expired" ? await table.delete().eq("id", subscription.id).eq("endpoint", subscription.endpoint).eq("p256dh", subscription.p256dh).eq("auth", subscription.auth)
        : await table.update(result.status === "sent" ? { last_delivered_at: new Date().toISOString(), last_error: null } : { last_error: "Push delivery failed." }).eq("id", subscription.id).eq("endpoint", subscription.endpoint).eq("p256dh", subscription.p256dh).eq("auth", subscription.auth);
    if (response.error)
        console.error("[web-push] Delivery metadata needs follow-up.");
    return result;
}
