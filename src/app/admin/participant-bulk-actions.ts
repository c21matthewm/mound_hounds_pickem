"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin";
import { invalidateScoringCache } from "@/lib/scoring-cache";
import { parseParticipantBulkRequest, type ParticipantBulkState } from "@/lib/admin-participant-bulk";
import { adminSafeErrorMessage } from "@/lib/app-error-safety";
import { errorReference, reportAppError } from "@/lib/app-error-reporter";

const refreshParticipantViews = () => {
  invalidateScoringCache();
  for (const path of ["/admin", "/dashboard", "/picks", "/leaderboard", "/season-registration"]) revalidatePath(path);
};
const unconfirmedMessage = "The update could not be confirmed. Refresh Participants to check the selected accounts before retrying.";

export async function bulkUpdateParticipantsAction(
  _previousState: ParticipantBulkState,
  formData: FormData
): Promise<ParticipantBulkState> {
  const { supabase, user } = await requireAdmin();
  let request: ReturnType<typeof parseParticipantBulkRequest>;
  try { request = parseParticipantBulkRequest(formData); }
  catch (error) { return { ok: false, message: error instanceof Error ? error.message : "Invalid participant selection." }; }
  const reportFailure = async (error: unknown) => {
    try {
      return errorReference(await reportAppError({
        actorProfileId: user.id,
        code: "bulk-update-participants-failed",
        context: { entityType: "participant", operation: request.operation, ...(request.seasonId ? { seasonId: request.seasonId } : {}) },
        error, route: "/admin?tab=participants", subsystem: "admin"
      }));
    } catch {
      // Reporting must not replace a useful action result or lose the selection.
      return "";
    }
  };
  let result;
  try {
    result = await supabase.rpc("admin_bulk_update_participants", {
      p_operation: request.operation,
      p_season_id: request.seasonId,
      p_participants: request.participants
    });
  } catch (error) {
    // A dropped response does not tell us whether the transaction committed.
    // Never retry automatically or describe this as a confirmed rollback.
    refreshParticipantViews();
    return { ok: false, message: `${unconfirmedMessage}${await reportFailure(error)}` };
  }
  const { data, error } = result;
  if (error) {
    if (error.code === "PGRST202" || error.code === "42883") {
      return { ok: false, message: "Bulk participant management is not configured yet. Apply the admin bulk participants migration before retrying." };
    }
    if (["55P03", "40P01", "40001"].includes(error.code)) {
      return { ok: false, message: "Participant or season data changed, or another update is in progress. Refresh Participants and select the accounts again." };
    }
    if (!/^[0-9A-Z]{5}$/.test(error.code)) {
      refreshParticipantViews();
      return { ok: false, message: `${unconfirmedMessage}${await reportFailure(error)}` };
    }
    return { ok: false, message: `${adminSafeErrorMessage(error, "The selected participants could not be updated.")}${await reportFailure(error)}` };
  }
  refreshParticipantViews();
  if (!data || typeof data !== "object" || Array.isArray(data) || data.updated_count !== request.participants.length) {
    return { ok: false, message: unconfirmedMessage };
  }
  const action = { enable: "Participation enabled", disable: "Participation disabled", register: "Season registration confirmed", decline: "Season participation declined" }[request.operation];
  return { ok: true, message: `${action} for ${request.participants.length} account${request.participants.length === 1 ? "" : "s"}.` };
}
