"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin";
import { buildLeagueScoringSnapshotUncached } from "@/lib/scoring";
import { invalidateScoringCache } from "@/lib/scoring-cache";
import type { Json } from "@/lib/supabase/types";
import { adminRedirect, asText, parsePositiveInteger, reportAdminActionFailure } from "@/app/admin/action-runtime";

export async function completeLeagueSeasonAction(formData: FormData) {
  const {supabase,user} = await requireAdmin();
  const seasonId = parsePositiveInteger(asText(formData.get("season_id")));
  const archiveId = parsePositiveInteger(asText(formData.get("archive_id")));
  const finalizedAt = asText(formData.get("archive_finalized_at"));
  if (!seasonId || !archiveId || !Number.isFinite(Date.parse(finalizedAt)) || asText(formData.get("confirm_complete")) !== "yes") {
    return adminRedirect("error", "Review the saved final standings and confirm season completion.", "seasons");
  }
  const refresh = () => {
    invalidateScoringCache();
    for (const page of ["/admin","/dashboard","/leaderboard","/picks","/profile","/rules","/signup","/season-registration"]) revalidatePath(page);
  };
  const failed = (error: unknown) => reportAdminActionFailure({actorProfileId:user.id,
    code:"season-completion-failed",context:{entityType:"league_season",entityId:seasonId,operation:"complete"},
    error,fallback:"The season could not be completed. Refresh Seasons & League and try again.",tab:"seasons"});
  const context = await supabase.rpc("get_season_closeout_context",{p_season_id:seasonId});
  if (context.error) {
    if (["PGRST202","42883"].includes(context.error.code)) return adminRedirect("error", "Season completion needs database setup. Apply 20260921_season_completion.sql, then refresh.", "seasons");
    return failed(context.error);
  }
  const data = context.data;
  if (!data || typeof data !== "object" || Array.isArray(data) || typeof data.source_hash !== "string"
    || !/^[a-f0-9]{64}$/.test(data.source_hash) || typeof data.historical_archive !== "boolean") {
    return failed(new Error("Season closeout review was incomplete. Refresh and try again."));
  }
  let entries: Json = null;
  if (!data.historical_archive && !data.already_completed) {
    let snapshot;
    try { snapshot = await buildLeagueScoringSnapshotUncached(seasonId); }
    catch (error) { return failed(error); }
    if (!snapshot.raceColumns.length || snapshot.leaderboardRows.filter(row => row.currentStanding === 1).length !== 1) {
      return adminRedirect("error", "A complete final leaderboard with one champion is required before season completion.", "seasons");
    }
    entries = snapshot.leaderboardRows.map(row => ({final_rank:row.currentStanding,team_name:row.teamName,total_points:row.totalPoints,
      race_breakdown:snapshot.raceColumns.map(race=>({points:row.raceBreakdown[race.raceId]??0,race_date:race.raceDate,
        race_id:race.raceId,race_name:race.raceName,round_number:race.roundNumber}))}));
  }
  let result;
  try {
    result = await supabase.rpc("complete_league_season",{p_season_id:seasonId,p_expected_archive_id:archiveId,
      p_expected_finalized_at:finalizedAt,p_expected_source_hash:data.source_hash,p_current_entries:entries});
  } catch {
    refresh();
    return adminRedirect("error", "Completion could not be confirmed. Refresh Seasons & League and check the season status before retrying.", "seasons");
  }
  refresh();
  if (result.error) {
    if (!/^[0-9A-Z]{5}$/.test(result.error.code) || result.error.code.startsWith("08") || result.error.code === "40003") {
      return adminRedirect("error", "Completion could not be confirmed. Refresh Seasons & League and check the season status before retrying.", "seasons");
    }
    return failed(result.error);
  }
  if (!result.data || typeof result.data !== "object" || Array.isArray(result.data) || typeof result.data.season_year !== "number") {
    return adminRedirect("error", "Completion could not be confirmed. Refresh and check the season status before retrying.", "seasons");
  }
  return adminRedirect("message", `${result.data.season_year} is complete. Final standings remain in Hall of Fame. No season is active until you activate the next one.`, "seasons");
}
