"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin";
import { recordAdminAudit } from "@/lib/admin-audit";
import { withMigrationHint } from "@/lib/supabase/migration-errors";
import { invalidateScoringCache } from "@/lib/scoring-cache";
import {
  LEAGUE_SEASONS_MIGRATION_FILE,
  MAX_PROFILE_NAME_LENGTH,
  OPERATIONS_HARDENING_MIGRATION_FILE,
  adminRedirect,
  asText,
  createSeasonSafetySnapshot,
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
    adminRedirect("error", "Enter a valid four-digit season year.", "races");
  }
  if (inviteCode.length < 8 || inviteCode.length > 64) {
    adminRedirect(
      "error",
      "Season invite code must be between 8 and 64 characters.",
      "races"
    );
  }
  if (inviteCode !== inviteCodeConfirmation) {
    adminRedirect("error", "Season invite code confirmation does not match.", "races");
  }

  const { error } = await supabase.rpc("create_league_season", {
    p_invite_code: inviteCode,
    p_season_year: seasonYear
  });

  if (error) {
    if (error.code === "23505") {
      adminRedirect("error", `${seasonYear} already exists.`, "races");
    }
    await reportAdminActionFailure({
      actorProfileId: user.id,
      code: "create-season-failed",
      context: { entityId: seasonYear, entityType: "league_season", operation: "create" },
      error: withMigrationHint(error.message, OPERATIONS_HARDENING_MIGRATION_FILE),
      fallback: "The season could not be created.",
      tab: "races"
    });
  }

  revalidatePath("/admin");
  adminRedirect("message", `${seasonYear} season created. Add its schedule before activation.`, "races");
}

export async function setLeagueSeasonInviteCodeAction(formData: FormData) {
  const { supabase, user } = await requireAdmin();
  const seasonId = parsePositiveInteger(asText(formData.get("season_id")));
  const inviteCode = asText(formData.get("invite_code"));
  const inviteCodeConfirmation = asText(formData.get("invite_code_confirmation"));

  if (!seasonId) {
    adminRedirect("error", "Select a season before setting its invite code.", "races");
  }
  if (inviteCode.length < 8 || inviteCode.length > 64) {
    adminRedirect(
      "error",
      "Season invite code must be between 8 and 64 characters.",
      "races"
    );
  }
  if (inviteCode !== inviteCodeConfirmation) {
    adminRedirect("error", "Season invite code confirmation does not match.", "races");
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
      tab: "races"
    });
  }

  revalidatePath("/admin");
  revalidatePath("/signup");
  adminRedirect(
    "message",
    "Season invite code saved. Existing registered participants are unaffected.",
    "races"
  );
}

export async function setLeagueSeasonRulesDocumentAction(formData: FormData) {
  const { supabase, user } = await requireAdmin();
  const seasonId = parsePositiveInteger(asText(formData.get("season_id")));
  const rulesDocumentUrl = asText(formData.get("rules_document_url"));

  if (!seasonId) {
    adminRedirect("error", "Select a season before saving its rules document.", "races");
  }
  if (
    rulesDocumentUrl &&
    !rulesDocumentUrl.startsWith("/") &&
    !/^https:\/\//i.test(rulesDocumentUrl)
  ) {
    adminRedirect(
      "error",
      "Rules document must use a site path beginning with / or a secure https URL.",
      "races"
    );
  }

  const { data: season, error } = await supabase
    .from("league_seasons")
    .update({ rules_document_url: rulesDocumentUrl || null })
    .eq("id", seasonId)
    .neq("status", "completed")
    .select("season_year")
    .maybeSingle<{ season_year: number }>();

  if (error) {
    await reportAdminActionFailure({
      actorProfileId: user.id,
      code: "set-season-rules-failed",
      context: { entityId: seasonId, entityType: "league_season", operation: "set_rules" },
      error,
      fallback: "The season rules document could not be saved.",
      tab: "races"
    });
  }
  if (!season) {
    adminRedirect("error", "Rules can only be changed for an active or upcoming season.", "races");
  }
  const selectedSeason = season!;

  await recordAdminAudit(supabase, {
    action: "update_rules_document",
    afterState: { rules_document_url: rulesDocumentUrl || null },
    entityId: String(seasonId),
    entityType: "league_season",
    summary: `Updated the ${selectedSeason.season_year} rules document.`
  });

  revalidatePath("/admin");
  revalidatePath("/rules");
  adminRedirect("message", "Season rules document updated.", "races");
}

export async function activateLeagueSeasonAction(formData: FormData) {
  const { supabase, user } = await requireAdmin();
  const seasonId = parsePositiveInteger(asText(formData.get("season_id")));

  if (!seasonId) {
    adminRedirect("error", "Select a season to activate.", "races");
  }

  const { data: currentSeason, error: currentSeasonError } = await supabase
    .from("league_seasons")
    .select("id,season_year")
    .eq("status", "active")
    .maybeSingle<{ id: number; season_year: number }>();
  if (currentSeasonError) {
    await reportAdminActionFailure({
      actorProfileId: user.id,
      code: "load-active-season-failed",
      context: { entityId: seasonId, entityType: "league_season", operation: "activate" },
      error: currentSeasonError,
      fallback: "The active season could not be checked.",
      tab: "races"
    });
  }

  if (currentSeason && currentSeason.id !== seasonId) {
    try {
      await createSeasonSafetySnapshot(
        supabase,
        currentSeason.id,
        `Before activating a new season from ${currentSeason.season_year}`,
        "pre_rollover",
        `season:${currentSeason.id}:activation`
      );
    } catch (snapshotError) {
      await reportAdminActionFailure({
        actorProfileId: user.id,
        code: "season-rollover-backup-failed",
        context: {
          entityId: currentSeason.id,
          entityType: "league_season",
          operation: "pre_rollover_backup"
        },
        error: snapshotError,
        fallback: "Could not create the required pre-activation backup.",
        tab: "races"
      });
    }
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
      tab: "races"
    });
  }

  invalidateScoringCache();
  revalidatePath("/admin");
  revalidatePath("/dashboard");
  revalidatePath("/picks");
  revalidatePath("/leaderboard");
  adminRedirect(
    "message",
    "Season activated. Driver points were reset and the prior final standings were retained as the opening seed order.",
    "races"
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

  const { error } = await supabase.rpc("admin_update_participant", {
    p_account_eligible: accountEligible,
    p_force_removal: forceRemoval,
    p_full_name: fullName,
    p_profile_id: profileId,
    p_season_registered: seasonRegistered,
    p_team_name: teamName
  });

  if (error) {
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
    `Participant updated. League participation ${accountEligible ? "enabled" : "disabled"} and current-season registration ${seasonRegistered ? "confirmed" : "removed"}.`,
    "participants"
  );
}
