"use server";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin";
import { recordAdminAudit } from "@/lib/admin-audit";
import { finalizeDueRaceWinners } from "@/lib/fantasy-winner";
import { withJobRun } from "@/lib/job-runs";
import { invalidateScoringCache } from "@/lib/scoring-cache";
import { adminRedirect, asText, parsePositiveInteger, reportAdminActionFailure } from "@/app/admin/action-runtime";
export async function triggerFantasyWinnerJobAction() {
  const {supabase, user} = await requireAdmin();
  let summary;
  try {
    summary = await withJobRun("fantasy-winner", finalizeDueRaceWinners, {
      completionForResult: result => result.failedRaceCount > 0 ? {status: "degraded", errorMessage: `${result.failedRaceCount} winner calculations failed.`} : {status: "succeeded"},
      shouldRecordResult: () => true
    });
  } catch (error) {
    return reportAdminActionFailure({actorProfileId: user.id, code: "manual-winner-job-failed", error, fallback: "The winner check could not finish. Review System Health before retrying.", tab: "health"});
  } finally {
    // A job can finalize some races before a later failure.
    invalidateScoringCache();
    for (const path of ["/admin", "/dashboard", "/leaderboard", "/picks"]) revalidatePath(path);
  }
  await recordAdminAudit(supabase, {
    action: "run_fantasy_winner_check", entityType: "job", entityId: "fantasy-winner",
    afterState: {processed: summary.processedRaceCount, updated: summary.updatedRaceCount, failed: summary.failedRaceCount},
    summary: `Manually checked ${summary.processedRaceCount} due race winners; ${summary.updatedRaceCount} updated, ${summary.failedRaceCount} failed.`
  });
  return adminRedirect(summary.failedRaceCount ? "error" : "message", `Winner check complete: ${summary.processedRaceCount} checked, ${summary.updatedRaceCount} updated, ${summary.failedRaceCount} failed.`, "health");
}

export async function freezeRaceFieldAction(formData: FormData) {
  const {supabase, user} = await requireAdmin();
  const raceId = parsePositiveInteger(asText(formData.get("race_id")));
  if (!raceId || asText(formData.get("confirm_field_freeze")) !== "yes") {
    return adminRedirect("error", "Confirm the selected race field before freezing it.", "race-week", raceId, "preparation");
  }
  const {data, error} = await supabase.rpc("admin_freeze_race_field", {p_race_id: raceId});
  if (error) {
    if (error.code === "PGRST202" || error.code === "42883") {
      return adminRedirect("error", "Manual field freezing is not configured yet. Apply the admin field-freeze migration, then retry.", "race-week", raceId, "preparation");
    }
    if (["55P03", "40P01", "40001"].includes(error.code)) {
      return adminRedirect("error", "The roster or schedule is being updated. Refresh and try again.", "race-week", raceId, "preparation");
    }
    return reportAdminActionFailure({actorProfileId:user.id,code:"admin-field-freeze-failed",context:{raceId,entityId:raceId,entityType:"race",operation:"freeze_field"},error,fallback:"The race field could not be frozen.",tab:"race-week",resultRaceId:raceId,raceWeekPhase:"preparation"});
  }
  invalidateScoringCache();
  for (const path of ["/admin", "/dashboard", "/picks", "/leaderboard"]) revalidatePath(path);
  const alreadyFrozen = data && typeof data === "object" && !Array.isArray(data) && data.already_frozen === true;
  return adminRedirect("message", alreadyFrozen ? "The field is already frozen for this pick window." : "The field is frozen for this pick window. Participant picks will use these saved groups.", "race-week", raceId, "preparation");
}
