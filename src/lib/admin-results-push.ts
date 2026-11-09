import "server-only";
import { isWebPushConfigured } from "@/lib/web-push";
import { loadPushSubscriptions, deliverDevicePush } from "@/lib/push-subscriptions";
import type { AppSupabaseClient } from "@/lib/supabase/types";
export async function notifyAdminsOfStagedResults(client: AppSupabaseClient, run: {
    run_id: unknown;
    race_id: unknown;
    race_name: unknown;
    status: unknown;
    flags_count: number;
    source_status?:unknown;
}) {
    if (process.env.ADMIN_RESULTS_PUSH_ENABLED === "false" || !isWebPushConfigured())
        return;
    const { data, error } = await client.from("profiles").select("id").eq("role", "admin").limit(100);
    if (error)
        throw new Error("Admin devices unavailable.");
    const subscriptions = await loadPushSubscriptions(client, (data ?? []).map(row => row.id));
    const ready = run.status === "READY_TO_PUBLISH";
    const provisional=run.source_status!=="official";
    const payload = { title: provisional?"⏳ Provisional Results Staged":ready ? "🏁 Official Results Ready to Publish" : "⚠️ Official Results Need Review", body: provisional?`${run.race_name}: waiting for official confirmation. Checking continues; publication is blocked.`:ready ? `${run.race_name}: 100% mapped with 0 critical flags. Tap to review and publish.` : `${run.race_name}: staged with ${run.flags_count} flag(s). Tap to review.`, url: `/admin?tab=results&result_race_id=${run.race_id}`, tag: `admin-staged-results-${run.race_id}-${run.run_id}` };
    // Bounded concurrency; subscription counts are capped in SQL. No results or
    // participant identity is included in the payload or diagnostic.
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(10, subscriptions.length) }, async () => { while (next < subscriptions.length) {
        const item = subscriptions[next++];
        try {
            const result = await deliverDevicePush(client, item, payload, 3600);
            if (result.status === "failed")
                console.error("[admin-results-push] Device delivery failed.");
        }
        catch {
            console.error("[admin-results-push] Device delivery failed.");
        }
    } }));
}
