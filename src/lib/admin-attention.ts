import "server-only";
import type { AppSupabaseClient } from "@/lib/supabase/types";

// Caller must requireAdmin first. Counts use existing status/date indexes and return no event bodies.
// A missing diagnostic must not stop an unrelated admin workflow or appear as an all-clear.
export async function loadAdminAttention(supabase: AppSupabaseClient, options: {
  seasonId: number | null; now: number; loadErrors: boolean; loadRaces: boolean;
}): Promise<{openErrors: number | null; unpublishedRaces: number | null}> {
  const unavailable = {count: null, error: null};
  const [errors, races] = await Promise.allSettled([
    options.loadErrors ? supabase.from("app_error_events").select("id", {count:"exact",head:true}).eq("status","open") : unavailable,
    options.loadRaces && options.seasonId ? supabase.from("races").select("id", {count:"exact",head:true})
      .eq("season_id",options.seasonId).eq("is_archived",false).eq("results_status","draft")
      .lte("race_date",new Date(options.now).toISOString()) : unavailable
  ]);
  return {
    openErrors: errors.status === "fulfilled" && !errors.value.error ? errors.value.count : null,
    unpublishedRaces: races.status === "fulfilled" && !races.value.error ? races.value.count : null
  };
}
