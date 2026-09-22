"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin";
import { invalidateScoringCache } from "@/lib/scoring-cache";
import {
  adminRedirect,
  asText,
  isUuid,
  reportAdminActionFailure
} from "@/app/admin/action-runtime";

export async function updateParticipantRoleAction(formData: FormData) {
  const { supabase, user } = await requireAdmin();
  const profileId = asText(formData.get("profile_id"));
  const role = asText(formData.get("role"));
  const expectedRole = asText(formData.get("expected_role"));

  if (!isUuid(profileId) || !["admin", "participant"].includes(role)
    || !["admin", "participant"].includes(expectedRole) || role === expectedRole) {
    adminRedirect("error", "Select a valid participant and role change.", "participants");
  }
  if (profileId.toLowerCase() === user.id.toLowerCase() && role === "participant") {
    adminRedirect("error", "You cannot remove your own admin access.", "participants");
  }

  // The database rechecks permissions and the previous role while serializing
  // protected profile changes. It also writes the audit event in this transaction.
  const { error } = await supabase.rpc("admin_update_participant_role", {
    p_expected_role: expectedRole,
    p_profile_id: profileId,
    p_role: role
  });
  if (error) {
    if (error.code === "PGRST202" || error.code === "42883") {
      adminRedirect(
        "error",
        "Admin role management is not configured in this database yet. Apply the admin role delegation migration before retrying.",
        "participants"
      );
    }
    if (error.code === "55P03" || error.code === "40P01" || error.code === "40001") {
      adminRedirect("error", "Another account change is in progress. Refresh Participants and try again.", "participants");
    }
    await reportAdminActionFailure({
      actorProfileId: user.id,
      code: "update-participant-role-failed",
      context: { entityId: profileId, entityType: "profile", operation: "change_role" },
      error,
      fallback: "The participant role could not be updated.",
      tab: "participants"
    });
  }

  invalidateScoringCache();
  revalidatePath("/admin");
  revalidatePath("/dashboard");
  revalidatePath("/picks");
  revalidatePath("/leaderboard");
  adminRedirect(
    "message",
    role === "admin" ? "Admin access granted. Season registration is unchanged."
      : "Admin access removed. The account and season registration are unchanged.",
    "participants"
  );
}
