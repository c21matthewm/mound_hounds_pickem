"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin";
import { isSafeRulesDocumentUrl, RULES_DOCUMENT_MIGRATION } from "@/lib/season-rules";
import { withMigrationHint } from "@/lib/supabase/migration-errors";
import { invalidateScoringCache } from "@/lib/scoring-cache";
import {
  LEAGUE_SEASONS_MIGRATION_FILE,
  MAX_PROFILE_NAME_LENGTH,
  OPERATIONS_HARDENING_MIGRATION_FILE,
  adminRedirect,
  asText,
  isUuid,
  parsePositiveInteger,
  reportAdminActionFailure
} from "@/app/admin/action-runtime";

export async function createLeagueSeasonAction(formData: FormData) {
  const { supabase, user } = await requireAdmin();
  const seasonYear = parsePositiveInteger(asText(formData.get("season_year")));
  const inviteCode = asText(formData.get("invite_code"));
  const inviteCodeConfirmation = asText(formData.get("invite_code_confirmation"));

  if (!seasonYear || seasonYear < 2000 || seasonYear > 2100) {
    return adminRedirect("error", "Enter a valid four-digit season year.", "seasons");
  }
  if (inviteCode.length < 8 || inviteCode.length > 64) {
    adminRedirect(
      "error",
      "Season invite code must be between 8 and 64 characters.",
      "seasons"
    );
  }
  if (inviteCode !== inviteCodeConfirmation) {
    adminRedirect("error", "Season invite code confirmation does not match.", "seasons");
  }

  const { error } = await supabase.rpc("create_league_season", {
    p_invite_code: inviteCode,
    p_season_year: seasonYear
  });

  if (error) {
    if (error.code === "23505") {
      adminRedirect("error", `${seasonYear} already exists.`, "seasons");
    }
    await reportAdminActionFailure({
      actorProfileId: user.id,
      code: "create-season-failed",
      context: { entityId: seasonYear, entityType: "league_season", operation: "create" },
      error: withMigrationHint(error.message, OPERATIONS_HARDENING_MIGRATION_FILE),
      fallback: "The season could not be created.",
      tab: "seasons"
    });
  }

  revalidatePath("/admin");
  adminRedirect(
    "message",
    `${seasonYear} season created. Configure its opening driver roster when you are ready to activate it.`,
    "seasons"
  );
}

export async function setLeagueSeasonInviteCodeAction(formData: FormData) {
  const { supabase, user } = await requireAdmin();
  const seasonId = parsePositiveInteger(asText(formData.get("season_id")));
  const inviteCode = asText(formData.get("invite_code"));
  const inviteCodeConfirmation = asText(formData.get("invite_code_confirmation"));

  if (!seasonId) {
    return adminRedirect("error", "Select a season before setting its invite code.", "seasons");
  }
  if (inviteCode.length < 8 || inviteCode.length > 64) {
    adminRedirect(
      "error",
      "Season invite code must be between 8 and 64 characters.",
      "seasons"
    );
  }
  if (inviteCode !== inviteCodeConfirmation) {
    adminRedirect("error", "Season invite code confirmation does not match.", "seasons");
  }

  const { error } = await supabase.rpc("set_league_season_invite_code", {
    p_invite_code: inviteCode,
    p_season_id: seasonId
  });

  if (error) {
    await reportAdminActionFailure({
      actorProfileId: user.id,
      code: "set-season-invite-failed",
      context: { entityId: seasonId, entityType: "league_season", operation: "set_invite" },
      error: withMigrationHint(error.message, OPERATIONS_HARDENING_MIGRATION_FILE),
      fallback: "The season invite code could not be saved.",
      tab: "seasons"
    });
  }

  revalidatePath("/admin");
  revalidatePath("/signup");
  adminRedirect(
    "message",
    "Season invite code saved. Existing registered participants are unaffected.",
    "seasons"
  );
}

export async function setLeagueSeasonRulesDocumentAction(formData: FormData) {
  const { supabase, user } = await requireAdmin();
  const seasonId = parsePositiveInteger(asText(formData.get("season_id")));
  const rulesDocumentUrl = formData.get("rules_document_url");
  const expectedUrl = formData.get("expected_rules_document_url");

  if (!seasonId || typeof expectedUrl !== "string" || expectedUrl.length > 2048) {
    return adminRedirect("error", "Refresh Seasons & League before saving its rules document.", "seasons");
  }
  if (typeof rulesDocumentUrl !== "string" || (rulesDocumentUrl !== "" && !isSafeRulesDocumentUrl(rulesDocumentUrl))) {
    return adminRedirect("error", "Use a site path beginning with a single / or a secure HTTPS URL without spaces or credentials.", "seasons");
  }
  let result;
  try {
    result = await supabase.rpc("set_league_season_rules_document", {
      p_season_id: seasonId, p_rules_document_url: rulesDocumentUrl || null,
      p_expected_rules_document_url: expectedUrl || null
    });
  } catch {
    revalidatePath("/admin"); revalidatePath("/rules");
    return adminRedirect("error", "The rules save could not be confirmed. Refresh and check the current document before trying again.", "seasons");
  }
  if (result.error) {
    return reportAdminActionFailure({ actorProfileId: user.id, code: "set-season-rules-failed",
      context: { entityId: seasonId, entityType: "league_season", operation: "set_rules" },
      error: result.error.code === "PGRST202" || result.error.code === "42883"
        ? withMigrationHint(result.error.message, RULES_DOCUMENT_MIGRATION) : result.error,
      fallback: "The season rules document could not be saved.", tab: "seasons" });
  }
  revalidatePath("/admin"); revalidatePath("/rules");
  if (result.data === null) {
    return adminRedirect("error", "The rules save could not be confirmed. Refresh and check the current document before trying again.", "seasons");
  }
  return adminRedirect("message", "Season rules document updated.", "seasons");
}

export async function activateLeagueSeasonAction(formData: FormData) {
  const { supabase, user } = await requireAdmin();
  const seasonId = parsePositiveInteger(asText(formData.get("season_id")));

  if (!seasonId) {
    return adminRedirect("error", "Select a season to activate.", "seasons");
  }

  const { error } = await supabase.rpc("activate_league_season", {
    p_season_id: seasonId
  });

  if (error) {
    await reportAdminActionFailure({
      actorProfileId: user.id,
      code: "activate-season-failed",
      context: { entityId: seasonId, entityType: "league_season", operation: "activate" },
      error: withMigrationHint(error.message, LEAGUE_SEASONS_MIGRATION_FILE),
      fallback: "The season could not be activated.",
      tab: "seasons"
    });
  }

  invalidateScoringCache();
  revalidatePath("/admin");
  revalidatePath("/dashboard");
  revalidatePath("/picks");
  revalidatePath("/leaderboard");
  adminRedirect(
    "message",
    "Season activated and registration opened. The configured driver order is the opening seed, and championship points start at zero.",
    "seasons"
  );
}

export async function updateParticipantAction(formData: FormData) {
  const { supabase, user } = await requireAdmin();
  const profileId = asText(formData.get("profile_id"));
  const fullName = asText(formData.get("full_name"));
  const teamName = asText(formData.get("team_name"));
  const accountEligible = asText(formData.get("account_eligible")) === "on";
  const seasonRegistered = asText(formData.get("season_registered")) === "on";
  const forceRemoval = asText(formData.get("force_removal")) === "on";
  const expectedSeasonText = formData.get("expected_season_id");
  const expectedSeasonId = typeof expectedSeasonText === "string" && expectedSeasonText ? parsePositiveInteger(expectedSeasonText) : null;
  if (typeof expectedSeasonText !== "string" || (expectedSeasonText !== "" && !expectedSeasonId)) {
    return adminRedirect("error", "Refresh Participants before saving account changes.", "participants");
  }

  if (!isUuid(profileId) || !fullName || !teamName) {
    adminRedirect(
      "error",
      "A valid participant, full name, and team name are required.",
      "participants"
    );
  }
  if (fullName.length > MAX_PROFILE_NAME_LENGTH || teamName.length > MAX_PROFILE_NAME_LENGTH) {
    adminRedirect("error", "Participant and team names must be 100 characters or fewer.", "participants");
  }

  const { error } = await supabase.rpc("admin_update_participant_v2", {
    p_expected_season_id: expectedSeasonId,
    p_account_eligible: accountEligible,
    p_force_removal: forceRemoval,
    p_full_name: fullName,
    p_profile_id: profileId,
    p_season_registered: seasonRegistered,
    p_team_name: teamName
  });

  if (error) {
    if (["PGRST202","42883"].includes(error.code)) return adminRedirect("error", "Participant editing needs database setup. Apply 20260921_season_completion.sql, then refresh.", "participants");
    if (error.code === "23505") {
      adminRedirect("error", "That team name is already in use.", "participants");
    }
    await reportAdminActionFailure({
      actorProfileId: user.id,
      code: "update-participant-failed",
      context: { entityId: profileId, entityType: "profile", operation: "admin_update" },
      error: withMigrationHint(error.message, OPERATIONS_HARDENING_MIGRATION_FILE),
      fallback: "The participant could not be updated.",
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
    expectedSeasonId ? `Participant updated. League participation ${accountEligible ? "enabled" : "disabled"} and current-season registration ${seasonRegistered ? "confirmed" : "removed"}.` : "Participant profile and participation eligibility updated. There is no active season; historical registrations were preserved.",
    "participants"
  );
}
