"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { parseChampionshipStandingsPaste } from "@/lib/championship-standings";
import {
  deleteManagedDriverHeadshot,
  getFormFile,
  uploadDriverHeadshot
} from "@/lib/driver-images";
import { finalizeRaceWinnerNow } from "@/lib/fantasy-winner";
import { deleteManagedRaceTitleImage, uploadRaceTitleImage } from "@/lib/race-images";
import { requireAdmin } from "@/lib/admin";
import { recordAdminAudit } from "@/lib/admin-audit";
import { normalizeDriverName, parseIndycarResultsPaste } from "@/lib/indycar-results";
import { parseQualifyingOrderPaste } from "@/lib/qualifying-order";
import {
  INDY_500_QUALIFYING_FIELD_SIZE,
  indy500GroupForQualifyingPosition,
  isValidAverageSpeedMph,
  isRacePickFormat,
  normalizeRacePickFormat,
  type RacePickFormat
} from "@/lib/race-format";
import { withMigrationHint } from "@/lib/supabase/migration-errors";
import { invalidateScoringCache } from "@/lib/scoring-cache";
import { buildLeagueScoringSnapshotUncached } from "@/lib/scoring";
import { SEASON_RECOVERY_MIGRATION_FILE } from "@/lib/season-recovery";
import { getLeagueYear, parseLeagueDateTimeLocalInput } from "@/lib/timezone";

const asText = (value: FormDataEntryValue | null): string =>
  typeof value === "string" ? value.trim() : "";

const MAX_DRIVER_NAME_LENGTH = 100;
const MAX_PROFILE_NAME_LENGTH = 100;
const MAX_RACE_NAME_LENGTH = 200;

type AdminTab =
  | "drivers"
  | "participants"
  | "races"
  | "results"
  | "feedback"
  | "health"
  | "recovery";

type RaceStatusRow = {
  id: number;
  is_archived: boolean;
  pick_format: RacePickFormat;
};

type EditablePickWindowRace = {
  field_frozen_at: string | null;
  id: number;
  is_archived: boolean;
  pick_format: RacePickFormat;
  pick_window_key: string;
  qualifying_start_at: string;
  race_date: string;
  race_name: string;
  round_number: number;
  season_id: number;
};

const parseAdminTab = (value: string): AdminTab | null => {
  if (
    value === "drivers" ||
    value === "participants" ||
    value === "races" ||
    value === "results" ||
    value === "feedback" ||
    value === "health" ||
    value === "recovery"
  ) {
    return value;
  }

  return null;
};

const parseRacePickFormat = (value: string): RacePickFormat =>
  isRacePickFormat(value) ? value : "standard";

const RESULT_PUBLICATION_MIGRATION_FILE =
  "supabase/migrations/20260709_harden_roles_and_result_publication.sql";
const HALL_OF_FAME_MIGRATION_FILE =
  "supabase/migrations/20260717_add_hall_of_fame.sql";
const LEAGUE_SEASONS_MIGRATION_FILE =
  "supabase/migrations/20260718_add_league_seasons_and_active_participants.sql";
const OPERATIONS_HARDENING_MIGRATION_FILE =
  "supabase/migrations/20260725_harden_race_and_season_operations.sql";
const SHARED_PICK_WINDOWS_MIGRATION_FILE =
  "supabase/migrations/20260726_add_shared_pick_windows.sql";

const withResultPublicationMigrationHint = (message: string): string =>
  /function .* does not exist|schema cache/i.test(message)
    ? withMigrationHint(message, RESULT_PUBLICATION_MIGRATION_FILE)
    : message;

const adminRedirect = (
  key: "error" | "message",
  value: string,
  tab?: AdminTab,
  resultRaceId?: number | null
): never => {
  const params = new URLSearchParams({ [key]: value });
  if (tab) {
    params.set("tab", tab);
  }
  if (tab === "results" && resultRaceId) {
    params.set("result_race_id", String(resultRaceId));
  }
  redirect(`/admin?${params.toString()}`);
};

const adminMutationRedirect = (
  key: "error" | "message",
  value: string,
  tab: AdminTab,
  resultRaceId?: number | null
): never => {
  // Some mutations can succeed before a later audit/refresh step reports an error.
  // Invalidating on every admin mutation exit prevents a partial success from serving stale scores.
  invalidateScoringCache();
  return adminRedirect(key, value, tab, resultRaceId);
};

const createSeasonSafetySnapshot = async (
  supabase: SupabaseClient,
  seasonId: number,
  label: string,
  source: "pre_correction" | "pre_rollover" | "result_checkpoint",
  retentionKey: string
): Promise<void> => {
  const { error } = await supabase.rpc("create_season_restore_point_v2", {
    p_label: label.slice(0, 160),
    p_retention_key: retentionKey.slice(0, 120),
    p_season_id: seasonId,
    p_source: source
  });

  if (error) {
    throw new Error(withMigrationHint(error.message, SEASON_RECOVERY_MIGRATION_FILE));
  }
};

const createPublishedRaceCheckpoint = async (
  supabase: SupabaseClient,
  race: { id: number; raceName: string; roundNumber: number; seasonId: number },
  winnerOutcome: WinnerFinalizationOutcome
): Promise<string | null> => {
  try {
    await createSeasonSafetySnapshot(
      supabase,
      race.seasonId,
      `Finalized R${race.roundNumber}: ${race.raceName}${
        winnerOutcome.status === "pending" ? " (winner pending)" : ""
      }`,
      "result_checkpoint",
      `race:${race.id}`
    );
    return null;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not create the race checkpoint.";
    console.error(`[recovery] Post-publication checkpoint failed for race ${race.id}:`, message);
    return message;
  }
};

type WinnerFinalizationOutcome = {
  errorMessage: string | null;
  status: "finalized" | "pending";
  winnerProfileId: string | null;
};

const finalizePublishedRaceWinner = async (
  supabase: SupabaseClient,
  raceId: number
): Promise<WinnerFinalizationOutcome> => {
  try {
    return {
      errorMessage: null,
      status: "finalized",
      winnerProfileId: await finalizeRaceWinnerNow(supabase, raceId)
    };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown fantasy winner calculation error.";
    console.error(
      `[fantasy-winner] Immediate finalization failed for race ${raceId}; automatic retry remains pending:`,
      errorMessage
    );

    return {
      errorMessage,
      status: "pending",
      winnerProfileId: null
    };
  }
};

const fantasyWinnerPublicationMessage = (outcome: WinnerFinalizationOutcome): string =>
  outcome.status === "finalized"
    ? "The fantasy winner was recalculated immediately."
    : "Fantasy winner calculation is pending an automatic retry.";

const parsePositiveInteger = (value: string): number | null => {
  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null;
  }

  return parsed;
};

const parseNonNegativeNumber = (value: string): number | null => {
  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }

  return parsed;
};

const timestampsMatch = (left: string, right: string): boolean =>
  Date.parse(left) === Date.parse(right);

const isUuid = (value: string): boolean =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

const driverGroupForIndex = (index: number): number => {
  if (index < 4) return 1;
  if (index < 8) return 2;
  if (index < 12) return 3;
  if (index < 16) return 4;
  if (index < 20) return 5;
  return 6;
};

async function refreshDriverStandingsAndGroups(supabase: SupabaseClient) {
  const { data: activeDrivers, error: activeDriversError } = await supabase
    .from("drivers")
    .select("id,championship_points,current_standing,driver_name")
    .eq("is_active", true)
    .order("championship_points", { ascending: false })
    .order("current_standing", { ascending: true })
    .order("driver_name", { ascending: true });

  if (activeDriversError) {
    throw new Error(activeDriversError.message);
  }

  const { data: inactiveDrivers, error: inactiveDriversError } = await supabase
    .from("drivers")
    .select("id,current_standing,driver_name")
    .eq("is_active", false)
    .order("current_standing", { ascending: true })
    .order("driver_name", { ascending: true });

  if (inactiveDriversError) {
    throw new Error(inactiveDriversError.message);
  }

  const rankedActiveDrivers = activeDrivers ?? [];
  const inactiveDriverRows = inactiveDrivers ?? [];

  const activeUpdateResponses = await Promise.all(
    rankedActiveDrivers.map((driver, index) =>
      supabase
        .from("drivers")
        .update({
          current_standing: index + 1,
          group_number: driverGroupForIndex(index)
        })
        .eq("id", driver.id)
    )
  );

  const inactiveUpdateResponses = await Promise.all(
    inactiveDriverRows.map((driver, index) =>
      supabase
        .from("drivers")
        .update({
          // Keep inactive drivers after active drivers for deterministic ordering.
          current_standing: rankedActiveDrivers.length + index + 1,
          group_number: 6
        })
        .eq("id", driver.id)
    )
  );

  const failed = [...activeUpdateResponses, ...inactiveUpdateResponses].find(
    (result) => result.error
  );

  if (failed?.error) {
    throw new Error(failed.error.message);
  }
}

async function ensureRaceIsActive(supabase: SupabaseClient, raceId: number) {
  const { data: race, error } = await supabase
    .from("races")
    .select("id,is_archived,pick_format")
    .eq("id", raceId)
    .maybeSingle<RaceStatusRow>();

  if (error) {
    throw new Error(error.message);
  }

  if (!race) {
    throw new Error("Selected race was not found.");
  }

  if (race.is_archived) {
    throw new Error("Selected race is archived. Unarchive it before updating winners or results.");
  }
}

export async function createLeagueSeasonAction(formData: FormData) {
  const { supabase } = await requireAdmin();
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
    adminRedirect(
      "error",
      error.code === "23505"
        ? `${seasonYear} already exists.`
        : withMigrationHint(error.message, OPERATIONS_HARDENING_MIGRATION_FILE),
      "races"
    );
  }

  revalidatePath("/admin");
  adminRedirect("message", `${seasonYear} season created. Add its schedule before activation.`, "races");
}

export async function setLeagueSeasonInviteCodeAction(formData: FormData) {
  const { supabase } = await requireAdmin();
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
    adminRedirect(
      "error",
      withMigrationHint(error.message, OPERATIONS_HARDENING_MIGRATION_FILE),
      "races"
    );
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
  const { supabase } = await requireAdmin();
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
    adminRedirect("error", error.message, "races");
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
  const { supabase } = await requireAdmin();
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
    adminRedirect("error", currentSeasonError.message, "races");
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
      adminRedirect(
        "error",
        snapshotError instanceof Error
          ? snapshotError.message
          : "Could not create the required pre-activation backup.",
        "races"
      );
    }
  }

  const { error } = await supabase.rpc("activate_league_season", {
    p_season_id: seasonId
  });

  if (error) {
    adminRedirect(
      "error",
      withMigrationHint(error.message, LEAGUE_SEASONS_MIGRATION_FILE),
      "races"
    );
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
  const { supabase } = await requireAdmin();
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
    adminRedirect(
      "error",
      error.code === "23505"
        ? "That team name is already in use."
        : withMigrationHint(error.message, OPERATIONS_HARDENING_MIGRATION_FILE),
      "participants"
    );
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

export async function createDriverAction(formData: FormData) {
  const { supabase } = await requireAdmin();
  const tab = parseAdminTab(asText(formData.get("tab"))) ?? "drivers";
  const redirectWithTab = (key: "error" | "message", value: string): never =>
    adminMutationRedirect(key, value, tab);

  const driverName = asText(formData.get("driver_name"));
  const imageUrlInput = asText(formData.get("image_url"));
  const imageFile = getFormFile(formData, "image_file");
  const isActive = asText(formData.get("is_active")) === "on";

  if (!driverName) {
    redirectWithTab("error", "Driver name is required.");
  }
  if (driverName.length > MAX_DRIVER_NAME_LENGTH) {
    redirectWithTab("error", "Driver names must be 100 characters or fewer.");
  }

  const { data: insertedDriver, error } = await supabase
    .from("drivers")
    .insert({
      championship_points: 0,
      current_standing: 9999,
      driver_name: driverName,
      group_number: 6,
      image_url: imageUrlInput || null,
      is_active: isActive,
      opening_seed_standing: 9999
    })
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505") {
      redirectWithTab("error", "Driver name already exists.");
    }

    redirectWithTab("error", error.message);
  }

  const insertedDriverId = insertedDriver?.id;
  if (!insertedDriverId) {
    redirectWithTab("error", "Driver was created but no id was returned.");
  }

  if (imageFile) {
    try {
      const uploadedUrl = await uploadDriverHeadshot({
        driverId: insertedDriverId,
        driverName,
        file: imageFile
      });

      const { error: updateImageError } = await supabase
        .from("drivers")
        .update({ image_url: uploadedUrl })
        .eq("id", insertedDriverId);

      if (updateImageError) {
        await deleteManagedDriverHeadshot(uploadedUrl).catch((cleanupError) => {
          console.error("[storage] Failed rolling back driver image upload:", cleanupError);
        });
        redirectWithTab(
          "error",
          `Driver created, but image update failed: ${updateImageError.message}`
        );
      }
    } catch (uploadError) {
      const message =
        uploadError instanceof Error ? uploadError.message : "Unknown image upload error.";
      redirectWithTab("error", `Driver created, but image upload failed: ${message}`);
    }
  }

  try {
    await refreshDriverStandingsAndGroups(supabase);
  } catch (refreshError) {
    const message =
      refreshError instanceof Error
        ? refreshError.message
        : "Failed to refresh driver standings/groups.";
    redirectWithTab("error", message);
  }

  await recordAdminAudit(supabase, {
    action: "create",
    afterState: { driver_name: driverName, is_active: isActive },
    entityId: String(insertedDriverId),
    entityType: "driver",
    summary: `Created driver ${driverName}.`
  });

  revalidatePath("/admin");
  revalidatePath("/picks");
  redirectWithTab("message", "Driver added. Standings and groups were refreshed.");
}

export async function updateDriverAction(formData: FormData) {
  const { supabase } = await requireAdmin();
  const tab = parseAdminTab(asText(formData.get("tab"))) ?? "drivers";
  const redirectWithTab = (key: "error" | "message", value: string): never =>
    adminMutationRedirect(key, value, tab);

  const driverId = parsePositiveInteger(asText(formData.get("driver_id")));
  const driverName = asText(formData.get("driver_name"));
  const imageUrlInput = asText(formData.get("image_url"));
  const imageFile = getFormFile(formData, "image_file");
  const isActive = asText(formData.get("is_active")) === "on";

  if (!driverId || !driverName) {
    redirectWithTab("error", "Driver update requires id and name.");
  }
  if (driverName.length > MAX_DRIVER_NAME_LENGTH) {
    redirectWithTab("error", "Driver names must be 100 characters or fewer.");
  }
  const driverIdValue = driverId as number;
  const { data: existingDriver, error: existingDriverError } = await supabase
    .from("drivers")
    .select("driver_name,image_url,is_active")
    .eq("id", driverIdValue)
    .maybeSingle<{ driver_name: string; image_url: string | null; is_active: boolean }>();

  if (existingDriverError) {
    redirectWithTab("error", existingDriverError.message);
  }
  if (!existingDriver) {
    redirectWithTab("error", "Driver not found.");
  }
  const selectedExistingDriver = existingDriver!;
  const existingDriverImageUrl = selectedExistingDriver.image_url ?? null;

  let imageUrl = imageUrlInput || null;
  if (imageFile) {
    try {
      imageUrl = await uploadDriverHeadshot({
        driverId: driverIdValue,
        driverName,
        file: imageFile
      });
    } catch (uploadError) {
      const message =
        uploadError instanceof Error ? uploadError.message : "Unknown image upload error.";
      redirectWithTab("error", `Driver update failed because image upload failed: ${message}`);
    }
  }

  const { error } = await supabase
    .from("drivers")
    .update({
      driver_name: driverName,
      image_url: imageUrl || null,
      is_active: isActive
    })
    .eq("id", driverIdValue);

  if (error) {
    if (imageFile && imageUrl !== existingDriverImageUrl) {
      await deleteManagedDriverHeadshot(imageUrl).catch((cleanupError) => {
        console.error("[storage] Failed rolling back driver image upload:", cleanupError);
      });
    }
    if (error.code === "23505") {
      redirectWithTab("error", "Driver name already exists.");
    }

    redirectWithTab("error", error.message);
  }

  let imageCleanupWarning = "";
  if (existingDriverImageUrl && existingDriverImageUrl !== imageUrl) {
    try {
      await deleteManagedDriverHeadshot(existingDriverImageUrl);
    } catch (cleanupError) {
      const message = cleanupError instanceof Error ? cleanupError.message : "Unknown cleanup error.";
      imageCleanupWarning = ` Replaced image cleanup needs attention: ${message}`;
    }
  }

  try {
    await refreshDriverStandingsAndGroups(supabase);
  } catch (refreshError) {
    const message =
      refreshError instanceof Error
        ? refreshError.message
        : "Failed to refresh driver standings/groups.";
    redirectWithTab("error", message);
  }

  await recordAdminAudit(supabase, {
    action: "update",
    afterState: { driver_name: driverName, is_active: isActive },
    beforeState: {
      driver_name: selectedExistingDriver.driver_name,
      is_active: selectedExistingDriver.is_active
    },
    entityId: String(driverIdValue),
    entityType: "driver",
    summary: `Updated driver ${driverName}.`
  });

  revalidatePath("/admin");
  revalidatePath("/picks");
  redirectWithTab(
    "message",
    `Driver updated. Standings and groups were refreshed.${imageCleanupWarning}`
  );
}

export async function deleteDriverAction(formData: FormData) {
  const { supabase } = await requireAdmin();
  const tab = parseAdminTab(asText(formData.get("tab"))) ?? "drivers";
  const redirectWithTab = (key: "error" | "message", value: string): never =>
    adminMutationRedirect(key, value, tab);
  const driverId = parsePositiveInteger(asText(formData.get("driver_id")));

  if (!driverId) {
    redirectWithTab("error", "Driver id is required for deletion.");
  }
  const driverIdValue = driverId as number;

  const [pickUsageResponse, resultUsageResponse, raceFieldUsageResponse] = await Promise.all([
    supabase
      .from("picks")
      .select("id")
      .or(
        `driver_group1_id.eq.${driverIdValue},driver_group2_id.eq.${driverIdValue},driver_group3_id.eq.${driverIdValue},driver_group4_id.eq.${driverIdValue},driver_group5_id.eq.${driverIdValue},driver_group6_id.eq.${driverIdValue},driver_group7_id.eq.${driverIdValue},driver_group8_id.eq.${driverIdValue}`
      )
      .limit(1),
    supabase.from("results").select("id").eq("driver_id", driverIdValue).limit(1),
    supabase
      .from("race_driver_groups")
      .select("race_id")
      .eq("driver_id", driverIdValue)
      .limit(1)
  ]);
  if (pickUsageResponse.error) {
    redirectWithTab("error", pickUsageResponse.error.message);
  }
  if (resultUsageResponse.error) {
    redirectWithTab("error", resultUsageResponse.error.message);
  }
  if (raceFieldUsageResponse.error) {
    redirectWithTab("error", raceFieldUsageResponse.error.message);
  }

  const hasPicks = (pickUsageResponse.data ?? []).length > 0;
  const hasResults = (resultUsageResponse.data ?? []).length > 0;
  const hasRaceFieldSnapshot = (raceFieldUsageResponse.data ?? []).length > 0;
  if (hasPicks || hasResults || hasRaceFieldSnapshot) {
    redirectWithTab(
      "error",
      "Cannot delete a driver that appears in picks, race results, or a race field snapshot. Mark the driver inactive instead."
    );
  }

  const { data: deletedDriver, error } = await supabase
    .from("drivers")
    .delete()
    .eq("id", driverIdValue)
    .select("driver_name,image_url")
    .maybeSingle<{ driver_name: string; image_url: string | null }>();
  if (error) {
    redirectWithTab("error", error.message);
  }

  let imageCleanupWarning = "";
  try {
    await deleteManagedDriverHeadshot(deletedDriver?.image_url ?? null);
  } catch (cleanupError) {
    const message = cleanupError instanceof Error ? cleanupError.message : "Unknown cleanup error.";
    imageCleanupWarning = ` Stored image cleanup needs attention: ${message}`;
  }

  try {
    await refreshDriverStandingsAndGroups(supabase);
  } catch (refreshError) {
    const message =
      refreshError instanceof Error
        ? refreshError.message
        : "Driver deleted, but failed to refresh standings/groups.";
    redirectWithTab("error", message);
  }

  await recordAdminAudit(supabase, {
    action: "delete",
    beforeState: deletedDriver ?? null,
    entityId: String(driverIdValue),
    entityType: "driver",
    summary: `Deleted unused driver ${deletedDriver?.driver_name ?? `#${driverIdValue}`}.`
  });

  revalidatePath("/admin");
  revalidatePath("/picks");
  revalidatePath("/leaderboard");
  redirectWithTab("message", `Driver deleted.${imageCleanupWarning}`);
}

export async function importChampionshipStandingsAction(formData: FormData) {
  const { supabase } = await requireAdmin();
  const tab = parseAdminTab(asText(formData.get("tab"))) ?? "drivers";
  const redirectWithTab = (key: "error" | "message", value: string): never =>
    adminMutationRedirect(key, value, tab);
  const rawPaste = asText(formData.get("standings_paste"));
  const seasonId = parsePositiveInteger(asText(formData.get("season_id")));

  if (!rawPaste || !seasonId) {
    redirectWithTab("error", "Select a season and paste the standings table before importing.");
  }

  const parsed = parseChampionshipStandingsPaste(rawPaste);
  if (parsed.rows.length === 0) {
    redirectWithTab(
      "error",
      "No standings rows detected. Expected columns: Rank, Driver, ..., Points."
    );
  }

  const { data: existingDrivers, error: existingDriversError } = await supabase
    .from("drivers")
    .select("id,driver_name");
  if (existingDriversError) {
    redirectWithTab("error", existingDriversError.message);
  }
  const existingDriverByNormalizedName = new Map(
    (existingDrivers ?? []).map((driver) => [
      normalizeDriverName(driver.driver_name),
      driver.id
    ])
  );

  const seenNormalizedNames = new Set<string>();
  const rosterRows = parsed.rows.filter((row) => {
    const normalizedName = normalizeDriverName(row.driverName);
    if (!normalizedName || seenNormalizedNames.has(normalizedName)) {
      return false;
    }
    seenNormalizedNames.add(normalizedName);
    return true;
  }).map((row) => ({
    driver_id: existingDriverByNormalizedName.get(normalizeDriverName(row.driverName)) ?? null,
    driver_name: row.driverName,
    rank: row.rank
  }));

  const { data: syncResult, error: syncError } = await supabase.rpc(
    "sync_opening_driver_roster",
    {
      p_rows: rosterRows,
      p_season_id: seasonId
    }
  );

  if (syncError) {
    redirectWithTab(
      "error",
      withMigrationHint(syncError.message, OPERATIONS_HARDENING_MIGRATION_FILE)
    );
  }

  const summary =
    syncResult && typeof syncResult === "object" && !Array.isArray(syncResult)
      ? (syncResult as Record<string, unknown>)
      : {};
  const createdCount = Number(summary.created_count ?? 0);
  const updatedCount = Number(summary.updated_count ?? 0);
  const activeDriverCount = Number(summary.active_driver_count ?? rosterRows.length);

  revalidatePath("/admin");
  revalidatePath("/picks");
  revalidatePath("/leaderboard");

  const ignoredSummary =
    parsed.ignoredLineCount > 0 ? ` ${parsed.ignoredLineCount} line(s) ignored.` : "";
  redirectWithTab(
    "message",
    `Opening roster synchronized: ${activeDriverCount} active drivers, ${updatedCount} updated, ${createdCount} created. Drivers absent from the import are now inactive.${ignoredSummary}`
  );
}

export async function createRaceAction(formData: FormData) {
  const { supabase } = await requireAdmin();
  const tab = parseAdminTab(asText(formData.get("tab"))) ?? "races";
  const redirectWithTab = (key: "error" | "message", value: string): never =>
    adminMutationRedirect(key, value, tab);

  const raceName = asText(formData.get("race_name"));
  const raceDateInput = asText(formData.get("race_date"));
  const qualifyingStartInput = asText(formData.get("qualifying_start_at"));
  const titleImageUrlInput = asText(formData.get("title_image_url"));
  const titleImageFile = getFormFile(formData, "title_image_file");
  const pickFormat = parseRacePickFormat(asText(formData.get("pick_format")));
  const payoutValue = parseNonNegativeNumber(asText(formData.get("payout")));
  const pickWindowPartnerId = parsePositiveInteger(
    asText(formData.get("pick_window_partner_id"))
  );
  const roundNumber = parsePositiveInteger(asText(formData.get("round_number")));
  const seasonId = parsePositiveInteger(asText(formData.get("season_id")));
  const raceDate = parseLeagueDateTimeLocalInput(raceDateInput);
  const qualifyingStartAt = parseLeagueDateTimeLocalInput(qualifyingStartInput);

  if (!raceName || payoutValue === null || !roundNumber || !seasonId) {
    redirectWithTab(
      "error",
      "Season, round, race name, qualifying start, race start, and payout are required."
    );
  }

  if (/^\s*Race\s+\d+\s*-\s*/i.test(raceName)) {
    redirectWithTab("error", "Enter only the event name. Round number belongs in the Round field.");
  }
  if (raceName.length > MAX_RACE_NAME_LENGTH) {
    redirectWithTab("error", "Race names must be 200 characters or fewer.");
  }

  if (raceDate === null || qualifyingStartAt === null) {
    redirectWithTab(
      "error",
      "Race name, qualifying start, race start, and payout are required. Use valid Indianapolis times."
    );
    return;
  }

  const raceStartTime = Date.parse(raceDate);

  const { data: season, error: seasonError } = await supabase
    .from("league_seasons")
    .select("id,season_year,status")
    .eq("id", seasonId)
    .maybeSingle<{ id: number; season_year: number; status: string }>();

  if (seasonError || !season) {
    redirectWithTab(
      "error",
      withMigrationHint(seasonError?.message ?? "Selected season was not found.", LEAGUE_SEASONS_MIGRATION_FILE)
    );
  }
  const selectedSeason = season as { id: number; season_year: number; status: string };
  if (selectedSeason.status === "completed") {
    redirectWithTab("error", "Races cannot be added to a completed season.");
  }
  if (getLeagueYear(new Date(raceDate)) !== selectedSeason.season_year) {
    redirectWithTab("error", `Race start year must match the ${selectedSeason.season_year} season.`);
  }

  let effectiveQualifyingStartAt = qualifyingStartAt;
  let pickWindowKey: string | undefined;
  if (pickWindowPartnerId) {
    const { data: partner, error: partnerError } = await supabase
      .from("races")
      .select(
        "id,is_archived,field_frozen_at,pick_format,pick_window_key,qualifying_start_at,round_number,season_id"
      )
      .eq("id", pickWindowPartnerId)
      .maybeSingle<{
        field_frozen_at: string | null;
        id: number;
        is_archived: boolean;
        pick_format: RacePickFormat;
        pick_window_key: string;
        qualifying_start_at: string;
        round_number: number;
        season_id: number;
      }>();

    if (partnerError || !partner) {
      redirectWithTab(
        "error",
        withMigrationHint(
          partnerError?.message ?? "Selected shared-deadline race was not found.",
          SHARED_PICK_WINDOWS_MIGRATION_FILE
        )
      );
    }

    const selectedPartner = partner as {
      field_frozen_at: string | null;
      id: number;
      is_archived: boolean;
      pick_format: RacePickFormat;
      pick_window_key: string;
      qualifying_start_at: string;
      round_number: number;
      season_id: number;
    };
    if (
      pickFormat !== "standard" ||
      normalizeRacePickFormat(selectedPartner.pick_format) !== "standard"
    ) {
      redirectWithTab("error", "Only standard-format races can share a pick deadline.");
    }
    if (selectedPartner.is_archived || selectedPartner.field_frozen_at) {
      redirectWithTab(
        "error",
        "The selected race is archived or already frozen and cannot accept a new deadline link."
      );
    }
    if (
      selectedPartner.season_id !== seasonId ||
      Math.abs(selectedPartner.round_number - (roundNumber as number)) !== 1
    ) {
      redirectWithTab(
        "error",
        "Shared-deadline races must be consecutive rounds in the same season."
      );
    }

    const { count: partnerWindowCount, error: partnerWindowError } = await supabase
      .from("races")
      .select("id", { count: "exact", head: true })
      .eq("pick_window_key", selectedPartner.pick_window_key);
    if (partnerWindowError) {
      redirectWithTab(
        "error",
        withMigrationHint(partnerWindowError.message, SHARED_PICK_WINDOWS_MIGRATION_FILE)
      );
    }
    if ((partnerWindowCount ?? 0) > 1) {
      redirectWithTab(
        "error",
        "The selected race already shares its deadline with another race."
      );
    }

    effectiveQualifyingStartAt = selectedPartner.qualifying_start_at;
    pickWindowKey = selectedPartner.pick_window_key;
  }

  if (Date.parse(effectiveQualifyingStartAt) > raceStartTime) {
    redirectWithTab("error", "The shared qualifying start must be at or before race start.");
  }

  const { data: insertedRace, error } = await supabase
    .from("races")
    .insert({
      pick_format: pickFormat,
      ...(pickWindowKey ? { pick_window_key: pickWindowKey } : {}),
      payout: payoutValue,
      qualifying_start_at: effectiveQualifyingStartAt,
      race_date: raceDate,
      race_name: raceName,
      round_number: roundNumber,
      season_id: seasonId,
      title_image_url: titleImageUrlInput || null
    })
    .select("id")
    .single();

  if (error) {
    redirectWithTab(
      "error",
      withMigrationHint(
        error.message,
        pickWindowPartnerId
          ? SHARED_PICK_WINDOWS_MIGRATION_FILE
          : LEAGUE_SEASONS_MIGRATION_FILE
      )
    );
  }

  const insertedRaceId = insertedRace?.id;
  if (!insertedRaceId) {
    redirectWithTab("error", "Race was created but no id was returned.");
  }

  if (titleImageFile) {
    try {
      const uploadedUrl = await uploadRaceTitleImage({
        raceId: insertedRaceId,
        raceName,
        file: titleImageFile
      });

      const { error: updateImageError } = await supabase
        .from("races")
        .update({ title_image_url: uploadedUrl })
        .eq("id", insertedRaceId);

      if (updateImageError) {
        await deleteManagedRaceTitleImage(uploadedUrl).catch((cleanupError) => {
          console.error("[storage] Failed rolling back race image upload:", cleanupError);
        });
        redirectWithTab(
          "error",
          `Race created, but title image update failed: ${updateImageError.message}`
        );
      }
    } catch (uploadError) {
      const message =
        uploadError instanceof Error ? uploadError.message : "Unknown image upload error.";
      redirectWithTab("error", `Race created, but title image upload failed: ${message}`);
    }
  }

  await recordAdminAudit(supabase, {
    action: "create",
    afterState: {
      pick_format: pickFormat,
      pick_window_key: pickWindowKey ?? null,
      qualifying_start_at: effectiveQualifyingStartAt,
      race_date: raceDate,
      race_name: raceName,
      round_number: roundNumber,
      season_id: seasonId
    },
    entityId: String(insertedRaceId),
    entityType: "race",
    summary: `Created ${raceName}${pickWindowPartnerId ? " with a shared doubleheader deadline" : ""}.`
  });

  revalidatePath("/admin");
  revalidatePath("/picks");
  redirectWithTab("message", "Race added.");
}

export async function updateRaceAction(formData: FormData) {
  const { supabase } = await requireAdmin();
  const tab = parseAdminTab(asText(formData.get("tab"))) ?? "races";
  const redirectWithTab = (key: "error" | "message", value: string): never =>
    adminMutationRedirect(key, value, tab);

  const raceId = parsePositiveInteger(asText(formData.get("race_id")));
  const raceName = asText(formData.get("race_name"));
  const raceDateInput = asText(formData.get("race_date"));
  const qualifyingStartInput = asText(formData.get("qualifying_start_at"));
  const titleImageUrlInput = asText(formData.get("title_image_url"));
  const titleImageFile = getFormFile(formData, "title_image_file");
  const pickFormat = parseRacePickFormat(asText(formData.get("pick_format")));
  const payoutValue = parseNonNegativeNumber(asText(formData.get("payout")));
  const roundNumber = parsePositiveInteger(asText(formData.get("round_number")));
  const seasonId = parsePositiveInteger(asText(formData.get("season_id")));
  const allowScheduleCorrection =
    asText(formData.get("allow_schedule_correction")) === "on";

  if (!raceId || !raceName || payoutValue === null || !roundNumber || !seasonId) {
    redirectWithTab(
      "error",
      "Race id, season, round, race name, qualifying start, race start, and payout are required."
    );
  }
  if (/^\s*Race\s+\d+\s*-\s*/i.test(raceName)) {
    redirectWithTab("error", "Enter only the event name. Round number belongs in the Round field.");
  }
  if (raceName.length > MAX_RACE_NAME_LENGTH) {
    redirectWithTab("error", "Race names must be 200 characters or fewer.");
  }
  const raceIdValue = raceId as number;
  const { data: existingRace, error: existingRaceError } = await supabase
    .from("races")
    .select(
      "title_image_url,season_id,round_number,pick_format,pick_window_key,qualifying_start_at,race_date,field_frozen_at"
    )
    .eq("id", raceIdValue)
    .maybeSingle<{
      field_frozen_at: string | null;
      pick_format: RacePickFormat;
      pick_window_key: string;
      qualifying_start_at: string;
      race_date: string;
      round_number: number;
      season_id: number;
      title_image_url: string | null;
    }>();

  if (existingRaceError) {
    redirectWithTab("error", existingRaceError.message);
  }
  if (!existingRace) {
    redirectWithTab("error", "Race not found.");
  }
  const selectedExistingRace = existingRace as {
    field_frozen_at: string | null;
    pick_format: RacePickFormat;
    pick_window_key: string;
    qualifying_start_at: string;
    race_date: string;
    round_number: number;
    season_id: number;
    title_image_url: string | null;
  };
  const existingRaceImageUrl = selectedExistingRace.title_image_url;
  const { count: pickWindowRaceCount, error: pickWindowCountError } = await supabase
    .from("races")
    .select("id", { count: "exact", head: true })
    .eq("pick_window_key", selectedExistingRace.pick_window_key);
  if (pickWindowCountError) {
    redirectWithTab(
      "error",
      withMigrationHint(pickWindowCountError.message, SHARED_PICK_WINDOWS_MIGRATION_FILE)
    );
  }
  const hasSharedPickWindow = (pickWindowRaceCount ?? 0) > 1;

  const raceDate = parseLeagueDateTimeLocalInput(raceDateInput);
  const qualifyingStartAt = parseLeagueDateTimeLocalInput(qualifyingStartInput);

  if (raceDate === null || qualifyingStartAt === null) {
    redirectWithTab(
      "error",
      "Race id, race name, qualifying start, race start, and payout are required."
    );
    return;
  }

  const qualifyingStartTime = Date.parse(qualifyingStartAt);
  const raceStartTime = Date.parse(raceDate);
  if (qualifyingStartTime > raceStartTime) {
    redirectWithTab("error", "Qualifying start must be at or before race start.");
  }

  const { data: season, error: seasonError } = await supabase
    .from("league_seasons")
    .select("id,season_year,status")
    .eq("id", seasonId)
    .maybeSingle<{ id: number; season_year: number; status: string }>();
  if (seasonError || !season) {
    redirectWithTab(
      "error",
      withMigrationHint(seasonError?.message ?? "Selected season was not found.", LEAGUE_SEASONS_MIGRATION_FILE)
    );
  }
  const selectedSeason = season as { id: number; season_year: number; status: string };
  if (selectedSeason.status === "completed" && selectedExistingRace.season_id !== seasonId) {
    redirectWithTab("error", "Races cannot be moved into a completed season.");
  }
  if (getLeagueYear(new Date(raceDate)) !== selectedSeason.season_year) {
    redirectWithTab("error", `Race start year must match the ${selectedSeason.season_year} season.`);
  }

  const identityChanged =
    selectedExistingRace.season_id !== seasonId ||
    selectedExistingRace.round_number !== roundNumber ||
    normalizeRacePickFormat(selectedExistingRace.pick_format) !== pickFormat;
  if (
    hasSharedPickWindow &&
    (identityChanged ||
      !timestampsMatch(selectedExistingRace.qualifying_start_at, qualifyingStartAt))
  ) {
    redirectWithTab(
      "error",
      "Unlink this race from its shared pick deadline before changing season, round, pick rules, or qualifying time."
    );
  }
  const scheduleChanged =
    !timestampsMatch(selectedExistingRace.qualifying_start_at, qualifyingStartAt) ||
    !timestampsMatch(selectedExistingRace.race_date, raceDate);
  if (identityChanged || scheduleChanged) {
    const [pickCountResponse, resultCountResponse] = await Promise.all([
      supabase.from("picks").select("id", { count: "exact", head: true }).eq("race_id", raceIdValue),
      supabase.from("results").select("id", { count: "exact", head: true }).eq("race_id", raceIdValue)
    ]);
    if (pickCountResponse.error || resultCountResponse.error) {
      redirectWithTab(
        "error",
        pickCountResponse.error?.message ??
          resultCountResponse.error?.message ??
          "Failed checking race dependencies."
      );
    }
    const pickCount = pickCountResponse.count ?? 0;
    const resultCount = resultCountResponse.count ?? 0;
    if (
      identityChanged &&
      (Boolean(selectedExistingRace.field_frozen_at) || pickCount > 0 || resultCount > 0)
    ) {
      redirectWithTab(
        "error",
        "Season, round, and pick format cannot change after the race field freezes."
      );
    }
    if (scheduleChanged && pickCount > 0 && !allowScheduleCorrection) {
      redirectWithTab(
        "error",
        "This race already has submitted picks. Check the schedule-correction confirmation before changing qualifying or race time."
      );
    }
  }

  let titleImageUrl = titleImageUrlInput || null;

  if (titleImageFile) {
    try {
      titleImageUrl = await uploadRaceTitleImage({
        raceId: raceIdValue,
        raceName,
        file: titleImageFile
      });
    } catch (uploadError) {
      const message =
        uploadError instanceof Error ? uploadError.message : "Unknown image upload error.";
      redirectWithTab("error", `Race update failed because title image upload failed: ${message}`);
    }
  }

  const { error } = await supabase
    .from("races")
    .update({
      pick_format: pickFormat,
      payout: payoutValue,
      qualifying_start_at: qualifyingStartAt,
      race_date: raceDate,
      race_name: raceName,
      round_number: roundNumber,
      season_id: seasonId,
      title_image_url: titleImageUrl
    })
    .eq("id", raceIdValue);

  if (error) {
    if (titleImageFile && titleImageUrl !== existingRaceImageUrl) {
      await deleteManagedRaceTitleImage(titleImageUrl).catch((cleanupError) => {
        console.error("[storage] Failed rolling back race image upload:", cleanupError);
      });
    }
    redirectWithTab(
      "error",
      withMigrationHint(error.message, SHARED_PICK_WINDOWS_MIGRATION_FILE)
    );
  }

  let imageCleanupWarning = "";
  if (existingRaceImageUrl && existingRaceImageUrl !== titleImageUrl) {
    try {
      await deleteManagedRaceTitleImage(existingRaceImageUrl);
    } catch (cleanupError) {
      const message = cleanupError instanceof Error ? cleanupError.message : "Unknown cleanup error.";
      imageCleanupWarning = ` Replaced image cleanup needs attention: ${message}`;
    }
  }

  const { error: auditError } = await supabase.rpc("write_admin_audit_event", {
    p_action: scheduleChanged ? "schedule_correction" : "update",
    p_after_state: {
      pick_format: pickFormat,
      payout: payoutValue,
      qualifying_start_at: qualifyingStartAt,
      race_date: raceDate,
      race_name: raceName,
      round_number: roundNumber,
      season_id: seasonId
    },
    p_before_state: {
      pick_format: selectedExistingRace.pick_format,
      qualifying_start_at: selectedExistingRace.qualifying_start_at,
      race_date: selectedExistingRace.race_date,
      round_number: selectedExistingRace.round_number,
      season_id: selectedExistingRace.season_id
    },
    p_entity_id: String(raceIdValue),
    p_entity_type: "race",
    p_summary: scheduleChanged
      ? `Corrected schedule for ${raceName}.`
      : `Updated ${raceName}.`
  });
  if (auditError) {
    console.error("[audit] Failed recording race update:", auditError.message);
  }

  revalidatePath("/admin");
  revalidatePath("/picks");
  revalidatePath("/leaderboard");
  redirectWithTab("message", `Race updated.${imageCleanupWarning}`);
}

export async function setRacePickWindowAction(formData: FormData) {
  const { supabase } = await requireAdmin();
  const raceId = parsePositiveInteger(asText(formData.get("race_id")));
  const partnerId = parsePositiveInteger(asText(formData.get("pick_window_partner_id")));

  if (!raceId) {
    adminMutationRedirect("error", "Select a race before changing its shared deadline.", "races");
  }

  const raceFields =
    "id,race_name,is_archived,field_frozen_at,pick_format,pick_window_key,qualifying_start_at,race_date,round_number,season_id";
  const { data: selectedRace, error: selectedRaceError } = await supabase
    .from("races")
    .select(raceFields)
    .eq("id", raceId)
    .maybeSingle<EditablePickWindowRace>();

  if (selectedRaceError || !selectedRace) {
    adminMutationRedirect(
      "error",
      withMigrationHint(
        selectedRaceError?.message ?? "Selected race was not found.",
        SHARED_PICK_WINDOWS_MIGRATION_FILE
      ),
      "races"
    );
  }
  const race = selectedRace as EditablePickWindowRace;
  if (race.is_archived || race.field_frozen_at) {
    adminMutationRedirect(
      "error",
      "Archived or frozen races cannot change their shared pick deadline.",
      "races"
    );
  }
  if (normalizeRacePickFormat(race.pick_format) !== "standard") {
    adminMutationRedirect(
      "error",
      "Only standard-format races can share a pick deadline.",
      "races"
    );
  }

  const { data: currentWindow, error: currentWindowError } = await supabase
    .from("races")
    .select("id,race_name")
    .eq("pick_window_key", race.pick_window_key);
  if (currentWindowError) {
    adminMutationRedirect(
      "error",
      withMigrationHint(currentWindowError.message, SHARED_PICK_WINDOWS_MIGRATION_FILE),
      "races"
    );
  }

  const currentPartner = (currentWindow ?? []).find((windowRace) => windowRace.id !== race.id);
  if (!partnerId) {
    if (!currentPartner) {
      adminMutationRedirect(
        "message",
        `${race.race_name} already uses a standalone pick deadline.`,
        "races"
      );
    }

    const { error: unlinkError } = await supabase
      .from("races")
      .update({ pick_window_key: crypto.randomUUID() })
      .eq("id", race.id);
    if (unlinkError) {
      adminMutationRedirect(
        "error",
        withMigrationHint(unlinkError.message, SHARED_PICK_WINDOWS_MIGRATION_FILE),
        "races"
      );
    }

    await recordAdminAudit(supabase, {
      action: "unlink_pick_window",
      afterState: { partner_race_id: null },
      beforeState: { partner_race_id: currentPartner?.id ?? null },
      entityId: String(race.id),
      entityType: "race",
      summary: `Restored a standalone pick deadline for ${race.race_name}.`
    });
    revalidatePath("/admin");
    revalidatePath("/picks");
    revalidatePath("/dashboard");
    revalidatePath("/race-center");
    adminMutationRedirect(
      "message",
      `${race.race_name} now uses a standalone pick deadline.`,
      "races"
    );
  }

  if (partnerId === race.id) {
    adminMutationRedirect("error", "A race cannot share a deadline with itself.", "races");
  }
  if (currentPartner && currentPartner.id === partnerId) {
    adminMutationRedirect(
      "message",
      `${race.race_name} already shares its deadline with ${currentPartner.race_name}.`,
      "races"
    );
  }
  if (currentPartner) {
    adminMutationRedirect(
      "error",
      `Unlink ${race.race_name} from ${currentPartner.race_name} before choosing another race.`,
      "races"
    );
  }

  const { data: partnerRace, error: partnerRaceError } = await supabase
    .from("races")
    .select(raceFields)
    .eq("id", partnerId)
    .maybeSingle<EditablePickWindowRace>();
  if (partnerRaceError || !partnerRace) {
    adminMutationRedirect(
      "error",
      withMigrationHint(
        partnerRaceError?.message ?? "Selected partner race was not found.",
        SHARED_PICK_WINDOWS_MIGRATION_FILE
      ),
      "races"
    );
  }
  const partner = partnerRace as EditablePickWindowRace;
  if (
    partner.is_archived ||
    partner.field_frozen_at ||
    normalizeRacePickFormat(partner.pick_format) !== "standard"
  ) {
    adminMutationRedirect(
      "error",
      "The partner must be an editable, active standard-format race.",
      "races"
    );
  }
  if (
    partner.season_id !== race.season_id ||
    Math.abs(partner.round_number - race.round_number) !== 1
  ) {
    adminMutationRedirect(
      "error",
      "Shared-deadline races must be consecutive rounds in the same season.",
      "races"
    );
  }
  if (Date.parse(partner.qualifying_start_at) > Date.parse(race.race_date)) {
    adminMutationRedirect(
      "error",
      "The shared qualifying deadline cannot be after either race start.",
      "races"
    );
  }

  const { count: partnerWindowCount, error: partnerWindowError } = await supabase
    .from("races")
    .select("id", { count: "exact", head: true })
    .eq("pick_window_key", partner.pick_window_key);
  if (partnerWindowError) {
    adminMutationRedirect(
      "error",
      withMigrationHint(partnerWindowError.message, SHARED_PICK_WINDOWS_MIGRATION_FILE),
      "races"
    );
  }
  if ((partnerWindowCount ?? 0) > 1) {
    adminMutationRedirect(
      "error",
      `${partner.race_name} already shares its deadline with another race.`,
      "races"
    );
  }

  const { error: linkError } = await supabase
    .from("races")
    .update({
      pick_window_key: partner.pick_window_key,
      qualifying_start_at: partner.qualifying_start_at
    })
    .eq("id", race.id);
  if (linkError) {
    adminMutationRedirect(
      "error",
      withMigrationHint(linkError.message, SHARED_PICK_WINDOWS_MIGRATION_FILE),
      "races"
    );
  }

  await recordAdminAudit(supabase, {
    action: "link_pick_window",
    afterState: {
      partner_race_id: partner.id,
      qualifying_start_at: partner.qualifying_start_at
    },
    beforeState: { partner_race_id: null },
    entityId: String(race.id),
    entityType: "race",
    summary: `Linked ${race.race_name} and ${partner.race_name} to one pick deadline.`
  });
  revalidatePath("/admin");
  revalidatePath("/picks");
  revalidatePath("/dashboard");
  revalidatePath("/race-center");
  adminMutationRedirect(
    "message",
    `${race.race_name} now shares its pick deadline with ${partner.race_name}.`,
    "races"
  );
}

export async function deleteRaceAction(formData: FormData) {
  const { supabase } = await requireAdmin();
  const tab = parseAdminTab(asText(formData.get("tab"))) ?? "races";
  const redirectWithTab = (key: "error" | "message", value: string): never =>
    adminMutationRedirect(key, value, tab);

  const raceId = parsePositiveInteger(asText(formData.get("race_id")));
  if (!raceId) {
    redirectWithTab("error", "Race id is required for deletion.");
  }
  const raceIdValue = raceId as number;

  const [pickCountResponse, resultCountResponse] = await Promise.all([
    supabase.from("picks").select("id", { count: "exact", head: true }).eq("race_id", raceIdValue),
    supabase.from("results").select("id", { count: "exact", head: true }).eq("race_id", raceIdValue)
  ]);
  if (pickCountResponse.error || resultCountResponse.error) {
    redirectWithTab(
      "error",
      pickCountResponse.error?.message ??
        resultCountResponse.error?.message ??
        "Failed checking race dependencies."
    );
  }
  if ((pickCountResponse.count ?? 0) > 0 || (resultCountResponse.count ?? 0) > 0) {
    redirectWithTab(
      "error",
      "A race with picks or results cannot be deleted. Archive it to preserve league history."
    );
  }

  const { data: deletedRace, error } = await supabase
    .from("races")
    .delete()
    .eq("id", raceIdValue)
    .select("race_name,title_image_url")
    .maybeSingle<{ race_name: string; title_image_url: string | null }>();
  if (error) {
    redirectWithTab("error", error.message);
  }

  let imageCleanupWarning = "";
  try {
    await deleteManagedRaceTitleImage(deletedRace?.title_image_url ?? null);
  } catch (cleanupError) {
    const message = cleanupError instanceof Error ? cleanupError.message : "Unknown cleanup error.";
    imageCleanupWarning = ` Stored image cleanup needs attention: ${message}`;
  }

  const { error: refreshError } = await supabase.rpc(
    "refresh_driver_standings_from_published_results"
  );
  if (refreshError) {
    redirectWithTab(
      "error",
      `Race deleted, but driver standings could not be refreshed: ${withResultPublicationMigrationHint(refreshError.message)}`
    );
  }

  const { error: auditError } = await supabase.rpc("write_admin_audit_event", {
    p_action: "delete",
    p_after_state: null,
    p_before_state: deletedRace ?? null,
    p_entity_id: String(raceIdValue),
    p_entity_type: "race",
    p_summary: `Deleted empty race ${deletedRace?.race_name ?? `#${raceIdValue}`}.`
  });
  if (auditError) {
    console.error("[audit] Failed recording race deletion:", auditError.message);
  }

  revalidatePath("/admin");
  revalidatePath("/picks");
  revalidatePath("/leaderboard");
  redirectWithTab("message", `Race deleted.${imageCleanupWarning}`);
}

export async function setRaceArchivedAction(formData: FormData) {
  const { supabase } = await requireAdmin();
  const tab = parseAdminTab(asText(formData.get("tab"))) ?? "races";
  const redirectWithTab = (key: "error" | "message", value: string): never =>
    adminMutationRedirect(key, value, tab);

  const raceId = parsePositiveInteger(asText(formData.get("race_id")));
  const shouldArchive = asText(formData.get("archive")) === "true";

  if (!raceId) {
    redirectWithTab("error", "Race id is required.");
  }
  const raceIdValue = raceId as number;
  const { data: selectedRace, error: selectedRaceError } = await supabase
    .from("races")
    .select("id,race_name,pick_window_key")
    .eq("id", raceIdValue)
    .maybeSingle<{ id: number; pick_window_key: string; race_name: string }>();
  if (selectedRaceError || !selectedRace) {
    redirectWithTab(
      "error",
      withMigrationHint(
        selectedRaceError?.message ?? "Race not found.",
        SHARED_PICK_WINDOWS_MIGRATION_FILE
      )
    );
  }
  const raceToArchive = selectedRace as {
    id: number;
    pick_window_key: string;
    race_name: string;
  };

  const updatePayload: {
    archived_at: string | null;
    is_archived: boolean;
    winner_auto_eligible_at?: string | null;
  } = {
    archived_at: shouldArchive ? new Date().toISOString() : null,
    is_archived: shouldArchive
  };

  if (shouldArchive) {
    updatePayload.winner_auto_eligible_at = null;
  }

  const { data: updatedRaces, error } = await supabase
    .from("races")
    .update(updatePayload)
    .eq("pick_window_key", raceToArchive.pick_window_key)
    .select("id");

  if (error) {
    redirectWithTab("error", error.message);
  }
  if (!updatedRaces || updatedRaces.length === 0) {
    redirectWithTab("error", "Race not found.");
  }
  const changedRaceCount = (updatedRaces ?? []).length;

  await recordAdminAudit(supabase, {
    action: shouldArchive ? "archive" : "unarchive",
    afterState: { is_archived: shouldArchive },
    entityId: String(raceIdValue),
    entityType: "race",
    summary: shouldArchive
      ? `Archived ${changedRaceCount === 2 ? "a doubleheader pick window" : "a race"}.`
      : `Unarchived ${changedRaceCount === 2 ? "a doubleheader pick window" : "a race"}.`
  });

  revalidatePath("/admin");
  revalidatePath("/picks");
  revalidatePath("/leaderboard");
  redirectWithTab(
    "message",
    shouldArchive
      ? changedRaceCount === 2
        ? "Both doubleheader races were archived."
        : "Race archived."
      : changedRaceCount === 2
        ? "Both doubleheader races were unarchived."
        : "Race unarchived."
  );
}

export async function setRaceWinnerAction(formData: FormData) {
  const { supabase } = await requireAdmin();
  const tab = parseAdminTab(asText(formData.get("tab"))) ?? "races";
  const redirectWithTab = (key: "error" | "message", value: string): never =>
    adminMutationRedirect(key, value, tab);

  const raceId = parsePositiveInteger(asText(formData.get("race_id")));
  const winnerProfileIdInput = asText(formData.get("winner_profile_id"));
  const winnerProfileId = winnerProfileIdInput || null;

  if (raceId === null) {
    redirectWithTab("error", "Race is required.");
  }
  const selectedRaceId = raceId as number;

  try {
    await ensureRaceIsActive(supabase, selectedRaceId);
  } catch (ensureError) {
    const message =
      ensureError instanceof Error ? ensureError.message : "Selected race is not editable.";
    redirectWithTab("error", message);
  }

  const { data: winnerRaceStatus, error: winnerRaceStatusError } = await supabase
    .from("races")
    .select("results_status")
    .eq("id", selectedRaceId)
    .maybeSingle<{ results_status: "draft" | "published" }>();
  if (winnerRaceStatusError) {
    redirectWithTab(
      "error",
      withResultPublicationMigrationHint(winnerRaceStatusError.message)
    );
  }
  if (winnerRaceStatus?.results_status !== "published") {
    redirectWithTab("error", "Publish the complete race results before setting a fantasy winner.");
  }

  if (winnerProfileId && !isUuid(winnerProfileId)) {
    redirectWithTab("error", "Winner selection is invalid.");
  }

  if (winnerProfileId) {
    const { data: winnerProfile, error: winnerProfileError } = await supabase
      .from("profiles")
      .select("id")
      .eq("id", winnerProfileId)
      .maybeSingle();

    if (winnerProfileError) {
      redirectWithTab("error", winnerProfileError.message);
    }
    if (!winnerProfile) {
      redirectWithTab("error", "Selected fantasy winner was not found.");
    }
  }

  if (!winnerProfileId) {
    try {
      await finalizeRaceWinnerNow(supabase, selectedRaceId);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to auto-calculate fantasy winner.";
      redirectWithTab("error", message);
    }
  } else {
    const { error } = await supabase
      .from("races")
      .update({
        winner_auto_eligible_at: null,
        winner_is_manual_override: true,
        winner_profile_id: winnerProfileId,
        winner_set_at: new Date().toISOString(),
        winner_source: "manual"
      })
      .eq("id", selectedRaceId);

    if (error) {
      redirectWithTab("error", error.message);
    }
  }

  await recordAdminAudit(supabase, {
    action: winnerProfileId ? "override_winner" : "recalculate_winner",
    afterState: { winner_profile_id: winnerProfileId },
    entityId: String(selectedRaceId),
    entityType: "race",
    summary: winnerProfileId
      ? "Set a manual fantasy winner override."
      : "Recalculated the fantasy winner."
  });

  revalidatePath("/admin");
  revalidatePath("/leaderboard");
  redirectWithTab("message", winnerProfileId ? "Fantasy winner updated." : "Fantasy winner recalculated.");
}

export async function importIndy500QualifyingOrderAction(formData: FormData) {
  const { supabase } = await requireAdmin();
  const tab = parseAdminTab(asText(formData.get("tab"))) ?? "results";
  const resultRaceId = parsePositiveInteger(asText(formData.get("result_race_id")));
  const redirectWithTab = (key: "error" | "message", value: string): never =>
    adminMutationRedirect(key, value, tab, resultRaceId);

  const raceIdInput = parsePositiveInteger(asText(formData.get("race_id")));
  const rawPaste = asText(formData.get("qualifying_order_paste"));

  if (raceIdInput === null) {
    redirectWithTab("error", "Select an Indianapolis 500 race before importing qualifying order.");
  }
  const raceId = raceIdInput as number;

  const { data: race, error: raceError } = await supabase
    .from("races")
    .select("id,race_name,is_archived,pick_format")
    .eq("id", raceId)
    .maybeSingle<RaceStatusRow & { race_name: string }>();

  if (raceError) {
    redirectWithTab("error", raceError.message);
  }
  if (!race) {
    redirectWithTab("error", "Selected race was not found.");
  }
  const selectedRace = race as RaceStatusRow & { race_name: string };

  if (selectedRace.is_archived) {
    redirectWithTab("error", "Selected race is archived. Unarchive it before importing qualifying order.");
  }
  if (normalizeRacePickFormat(selectedRace.pick_format) !== "indy_500") {
    redirectWithTab("error", "Qualifying order upload is only available for races marked Indianapolis 500.");
  }

  if (!rawPaste) {
    redirectWithTab("error", "Paste the 33-car Indianapolis 500 qualifying order before importing.");
  }

  const parsed = parseQualifyingOrderPaste(rawPaste);
  if (parsed.rows.length === 0) {
    redirectWithTab("error", "No qualifying order rows were detected.");
  }

  const rowsByPosition = new Map<number, (typeof parsed.rows)[number]>();
  const duplicatePositions = new Set<number>();
  parsed.rows.forEach((row) => {
    if (rowsByPosition.has(row.position)) {
      duplicatePositions.add(row.position);
      return;
    }
    rowsByPosition.set(row.position, row);
  });

  if (duplicatePositions.size > 0) {
    redirectWithTab(
      "error",
      `Duplicate qualifying position(s): ${Array.from(duplicatePositions).sort((a, b) => a - b).join(", ")}`
    );
  }

  const missingPositions: number[] = [];
  for (let position = 1; position <= INDY_500_QUALIFYING_FIELD_SIZE; position += 1) {
    if (!rowsByPosition.has(position)) {
      missingPositions.push(position);
    }
  }

  if (missingPositions.length > 0 || rowsByPosition.size !== INDY_500_QUALIFYING_FIELD_SIZE) {
    redirectWithTab(
      "error",
      `Indianapolis 500 qualifying order must include positions 1-${INDY_500_QUALIFYING_FIELD_SIZE}. Missing: ${missingPositions.join(", ") || "none"}.`
    );
  }

  const { data: drivers, error: driversError } = await supabase
    .from("drivers")
    .select("id,driver_name");

  if (driversError) {
    redirectWithTab("error", driversError.message);
  }

  const driverMap = new Map<string, { id: number; name: string }>();
  (drivers ?? []).forEach((driver) => {
    driverMap.set(normalizeDriverName(driver.driver_name), {
      id: driver.id,
      name: driver.driver_name
    });
  });

  const unmatchedNames = new Set<string>();
  const duplicateDriverNames = new Set<string>();
  const seenDriverIds = new Set<number>();
  const payload: Array<{
    driver_id: number;
    group_number: number;
    qualifying_position: number;
    race_id: number;
  }> = [];

  Array.from(rowsByPosition.values())
    .sort((a, b) => a.position - b.position)
    .forEach((row) => {
      const match = driverMap.get(normalizeDriverName(row.driverName));
      if (!match) {
        unmatchedNames.add(row.driverName);
        return;
      }
      if (seenDriverIds.has(match.id)) {
        duplicateDriverNames.add(match.name);
        return;
      }

      const groupNumber = indy500GroupForQualifyingPosition(row.position);
      if (!groupNumber) {
        return;
      }

      seenDriverIds.add(match.id);
      payload.push({
        driver_id: match.id,
        group_number: groupNumber,
        qualifying_position: row.position,
        race_id: raceId
      });
    });

  if (unmatchedNames.size > 0) {
    redirectWithTab(
      "error",
      `Could not match these qualifying drivers in your database: ${Array.from(unmatchedNames).join(", ")}`
    );
  }

  if (duplicateDriverNames.size > 0) {
    redirectWithTab(
      "error",
      `Duplicate driver(s) in qualifying order: ${Array.from(duplicateDriverNames).join(", ")}`
    );
  }

  if (payload.length !== INDY_500_QUALIFYING_FIELD_SIZE) {
    redirectWithTab(
      "error",
      `Expected ${INDY_500_QUALIFYING_FIELD_SIZE} matched qualifying rows, got ${payload.length}.`
    );
  }

  const { error: replaceError } = await supabase.rpc(
    "replace_indy_500_qualifying_order",
    {
      p_race_id: raceId,
      p_rows: payload.map(({ driver_id, group_number, qualifying_position }) => ({
        driver_id,
        group_number,
        qualifying_position
      }))
    }
  );

  if (replaceError) {
    redirectWithTab(
      "error",
      withMigrationHint(replaceError.message, OPERATIONS_HARDENING_MIGRATION_FILE)
    );
  }

  revalidatePath("/admin");
  revalidatePath("/picks");
  revalidatePath("/leaderboard");

  const ignoredSummary =
    parsed.ignoredLineCount > 0 ? ` ${parsed.ignoredLineCount} line(s) ignored.` : "";
  redirectWithTab(
    "message",
    `Imported Indianapolis 500 qualifying order for ${selectedRace.race_name}: ${payload.length} drivers across 8 groups.${ignoredSummary}`
  );
}

export async function upsertResultAction(formData: FormData) {
  const { supabase } = await requireAdmin();
  const tab = parseAdminTab(asText(formData.get("tab"))) ?? "results";
  const resultRaceId = parsePositiveInteger(asText(formData.get("result_race_id")));
  const redirectWithTab = (key: "error" | "message", value: string): never =>
    adminMutationRedirect(key, value, tab, resultRaceId);

  const raceId = parsePositiveInteger(asText(formData.get("race_id")));
  const driverId = parsePositiveInteger(asText(formData.get("driver_id")));
  const points = parseNonNegativeNumber(asText(formData.get("points")));
  const confirmResultsCorrection =
    asText(formData.get("confirm_results_correction")) === "on";

  if (!raceId || !driverId || points === null || !Number.isInteger(points)) {
    redirectWithTab("error", "Race, driver, and non-negative integer points are required.");
  }
  const selectedRaceId = raceId as number;
  const selectedDriverId = driverId as number;

  try {
    await ensureRaceIsActive(supabase, selectedRaceId);
  } catch (ensureError) {
    const message =
      ensureError instanceof Error ? ensureError.message : "Selected race is not editable.";
    redirectWithTab("error", message);
  }

  const { data: selectedRace, error: selectedRaceError } = await supabase
    .from("races")
    .select("race_name,results_status,round_number,season_id")
    .eq("id", selectedRaceId)
    .maybeSingle<{
      race_name: string;
      results_status: "draft" | "published";
      round_number: number;
      season_id: number;
    }>();
  if (selectedRaceError || !selectedRace) {
    redirectWithTab(
      "error",
      selectedRaceError?.message ?? "Selected race was not found."
    );
  }
  const resultRace = selectedRace!;
  if (resultRace.results_status === "published" && !confirmResultsCorrection) {
    redirectWithTab(
      "error",
      "Published results require the correction confirmation before they can return to draft."
    );
  }
  if (resultRace.results_status === "published") {
    try {
      await createSeasonSafetySnapshot(
        supabase,
        resultRace.season_id,
        `Before correcting R${resultRace.round_number}: ${resultRace.race_name}`,
        "pre_correction",
        `race:${selectedRaceId}`
      );
    } catch (snapshotError) {
      redirectWithTab(
        "error",
        snapshotError instanceof Error
          ? snapshotError.message
          : "Could not create the required pre-correction backup."
      );
    }
  }

  const { error } = await supabase.rpc("save_race_result_draft", {
    p_driver_id: selectedDriverId,
    p_points: points,
    p_race_id: selectedRaceId
  });

  if (error) {
    redirectWithTab(
      "error",
      withResultPublicationMigrationHint(error.message)
    );
  }

  await recordAdminAudit(supabase, {
    action:
      resultRace.results_status === "published"
        ? "begin_results_correction"
        : "save_result_draft",
    afterState: { driver_id: selectedDriverId, points },
    entityId: String(selectedRaceId),
    entityType: "race",
    summary:
      resultRace.results_status === "published"
        ? `Returned ${resultRace.race_name} to draft for a result correction.`
        : `Saved a draft result for ${resultRace.race_name}.`
  });

  revalidatePath("/admin");
  revalidatePath("/leaderboard");
  revalidatePath("/picks");

  const [raceNameRes, driverNameRes, raceResultCountRes] = await Promise.all([
    supabase.from("races").select("race_name").eq("id", selectedRaceId).maybeSingle(),
    supabase.from("drivers").select("driver_name").eq("id", selectedDriverId).maybeSingle(),
    supabase
      .from("results")
      .select("id", { count: "exact", head: true })
      .eq("race_id", selectedRaceId)
  ]);

  const raceName =
    raceNameRes.error || !raceNameRes.data
      ? `Race #${selectedRaceId}`
      : raceNameRes.data.race_name;
  const driverName =
    driverNameRes.error || !driverNameRes.data
      ? `Driver #${selectedDriverId}`
      : driverNameRes.data.driver_name;
  const raceResultCountText =
    raceResultCountRes.error || raceResultCountRes.count === null
      ? "Current result-row count for this race could not be confirmed."
      : `${raceResultCountRes.count} result row(s) are now saved for this race.`;

  redirectWithTab(
    "message",
    `Saved ${points} draft point(s) for ${driverName} in ${raceName}. ${raceResultCountText} Draft results do not affect participant standings until the complete race is published.`
  );
}

export async function publishSavedRaceResultsAction(formData: FormData) {
  const { supabase } = await requireAdmin();
  const tab = parseAdminTab(asText(formData.get("tab"))) ?? "results";
  const resultRaceId = parsePositiveInteger(asText(formData.get("result_race_id")));
  const redirectWithTab = (key: "error" | "message", value: string): never =>
    adminMutationRedirect(key, value, tab, resultRaceId);

  const raceId = parsePositiveInteger(asText(formData.get("race_id")));
  const officialWinningAverageSpeed = parseNonNegativeNumber(
    asText(formData.get("official_winning_average_speed"))
  );
  const confirmResultsCorrection =
    asText(formData.get("confirm_results_correction")) === "on";

  if (
    !raceId ||
    officialWinningAverageSpeed === null ||
    !isValidAverageSpeedMph(officialWinningAverageSpeed)
  ) {
    redirectWithTab(
      "error",
      "Race and an official winning average speed between 0 and 300 MPH are required."
    );
  }
  const selectedRaceId = raceId as number;

  const { data: selectedRace, error: selectedRaceError } = await supabase
    .from("races")
    .select("race_name,results_status,round_number,season_id")
    .eq("id", selectedRaceId)
    .maybeSingle<{
      race_name: string;
      results_status: "draft" | "published";
      round_number: number;
      season_id: number;
    }>();
  if (selectedRaceError || !selectedRace) {
    redirectWithTab(
      "error",
      selectedRaceError?.message ?? "Selected race was not found."
    );
  }
  const savedResultRace = selectedRace!;
  if (savedResultRace.results_status === "published" && !confirmResultsCorrection) {
    redirectWithTab(
      "error",
      "Check the published-results correction confirmation before republishing this race."
    );
  }
  if (savedResultRace.results_status === "published") {
    try {
      await createSeasonSafetySnapshot(
        supabase,
        savedResultRace.season_id,
        `Before republishing R${savedResultRace.round_number}: ${savedResultRace.race_name}`,
        "pre_correction",
        `race:${selectedRaceId}`
      );
    } catch (snapshotError) {
      redirectWithTab(
        "error",
        snapshotError instanceof Error
          ? snapshotError.message
          : "Could not create the required pre-correction backup."
      );
    }
  }

  const { data: publishedCount, error } = await supabase.rpc("publish_saved_race_results", {
    p_official_winning_average_speed: officialWinningAverageSpeed,
    p_race_id: selectedRaceId
  });

  if (error) {
    redirectWithTab(
      "error",
      withResultPublicationMigrationHint(error.message)
    );
  }

  const winnerOutcome = await finalizePublishedRaceWinner(supabase, selectedRaceId);
  const checkpointError = await createPublishedRaceCheckpoint(
    supabase,
    {
      id: selectedRaceId,
      raceName: savedResultRace.race_name,
      roundNumber: savedResultRace.round_number,
      seasonId: savedResultRace.season_id
    },
    winnerOutcome
  );

  await recordAdminAudit(supabase, {
    action: "publish_results",
    afterState: {
      fantasy_winner_error: winnerOutcome.errorMessage,
      fantasy_winner_status: winnerOutcome.status,
      recovery_checkpoint_error: checkpointError,
      official_winning_average_speed: officialWinningAverageSpeed,
      published_result_count: Number(publishedCount ?? 0),
      winner_profile_id: winnerOutcome.winnerProfileId
    },
    entityId: String(selectedRaceId),
    entityType: "race",
    summary: `Published ${Number(publishedCount ?? 0)} saved result rows.`
  });

  revalidatePath("/admin");
  revalidatePath("/dashboard");
  revalidatePath("/leaderboard");
  revalidatePath("/picks");
  redirectWithTab(
    "message",
    `Published ${Number(publishedCount ?? 0)} saved result row(s). Driver standings and groups were refreshed. ${fantasyWinnerPublicationMessage(winnerOutcome)}${
      checkpointError ? " Create and download a manual safety backup before making another correction." : ""
    }`
  );
}

export async function importIndycarResultsAction(formData: FormData) {
  const { supabase } = await requireAdmin();
  const tab = parseAdminTab(asText(formData.get("tab"))) ?? "results";
  const resultRaceId = parsePositiveInteger(asText(formData.get("result_race_id")));
  const redirectWithTab = (key: "error" | "message", value: string): never =>
    adminMutationRedirect(key, value, tab, resultRaceId);

  const raceIdInput = parsePositiveInteger(asText(formData.get("race_id")));
  const rawPaste = asText(formData.get("results_paste"));
  const confirmResultsCorrection =
    asText(formData.get("confirm_results_correction")) === "on";

  if (raceIdInput === null) {
    redirectWithTab("error", "Select a race before importing pasted results.");
  }
  const raceId = raceIdInput as number;

  try {
    await ensureRaceIsActive(supabase, raceId);
  } catch (ensureError) {
    const message =
      ensureError instanceof Error ? ensureError.message : "Selected race is not editable.";
    redirectWithTab("error", message);
  }

  const { data: selectedRace, error: selectedRaceError } = await supabase
    .from("races")
    .select("race_name,results_status,round_number,season_id")
    .eq("id", raceId)
    .maybeSingle<{
      race_name: string;
      results_status: "draft" | "published";
      round_number: number;
      season_id: number;
    }>();
  if (selectedRaceError || !selectedRace) {
    redirectWithTab(
      "error",
      selectedRaceError?.message ?? "Selected race was not found."
    );
  }
  const importResultRace = selectedRace!;
  if (importResultRace.results_status === "published" && !confirmResultsCorrection) {
    redirectWithTab(
      "error",
      "Check the published-results correction confirmation before replacing this race."
    );
  }
  if (!rawPaste) {
    redirectWithTab("error", "Paste results text before importing.");
  }

  const parsed = parseIndycarResultsPaste(rawPaste);

  if (parsed.rows.length === 0) {
    redirectWithTab(
      "error",
      "No result rows were detected. Make sure you pasted the INDYCAR table rows."
    );
  }

  const { data: drivers, error: driversError } = await supabase
    .from("drivers")
    .select("id,driver_name");

  if (driversError) {
    redirectWithTab("error", driversError.message);
  }

  const driverRows = drivers ?? [];
  const driverMap = new Map<string, { id: number; name: string }>();
  driverRows.forEach((driver) => {
    driverMap.set(normalizeDriverName(driver.driver_name), {
      id: driver.id,
      name: driver.driver_name
    });
  });

  const unmatchedNames = new Set<string>();
  const duplicateNames = new Set<string>();
  const payload: Array<{
    driver_id: number;
    points: number;
    position: number | null;
    race_id: number;
  }> = [];
  const seenDriverIds = new Set<number>();

  parsed.rows.forEach((row) => {
    const normalized = normalizeDriverName(row.driverName);
    const match = driverMap.get(normalized);

    if (!match) {
      unmatchedNames.add(row.driverName);
      return;
    }

    if (seenDriverIds.has(match.id)) {
      duplicateNames.add(match.name);
      return;
    }

    seenDriverIds.add(match.id);
    payload.push({
      driver_id: match.id,
      points: row.points,
      position: row.position,
      race_id: raceId
    });
  });

  if (unmatchedNames.size > 0) {
    redirectWithTab(
      "error",
      `Could not match these drivers in your database: ${Array.from(unmatchedNames).join(", ")}`
    );
  }

  if (duplicateNames.size > 0) {
    redirectWithTab(
      "error",
      `Duplicate result rows were found for: ${Array.from(duplicateNames).join(", ")}`
    );
  }

  if (payload.length === 0) {
    redirectWithTab("error", "No valid rows were mapped to drivers.");
  }

  const positions = payload.map((row) => row.position);
  const validPositions = positions.filter((position): position is number => position !== null);
  const sortedPositions = [...validPositions].sort((a, b) => a - b);
  const positionsAreComplete =
    validPositions.length === payload.length &&
    new Set(validPositions).size === payload.length &&
    sortedPositions.every((position, index) => position === index + 1);
  if (!positionsAreComplete) {
    redirectWithTab(
      "error",
      `Official finishing positions must be unique and contiguous from 1 through ${payload.length}.`
    );
  }

  if (
    parsed.winningAverageSpeed === null ||
    !isValidAverageSpeedMph(parsed.winningAverageSpeed)
  ) {
    redirectWithTab(
      "error",
      "Could not determine a valid official race average speed between 0 and 300 MPH. Include the Average Speed column."
    );
  }

  if (importResultRace.results_status === "published") {
    try {
      await createSeasonSafetySnapshot(
        supabase,
        importResultRace.season_id,
        `Before replacing R${importResultRace.round_number}: ${importResultRace.race_name}`,
        "pre_correction",
        `race:${raceId}`
      );
    } catch (snapshotError) {
      redirectWithTab(
        "error",
        snapshotError instanceof Error
          ? snapshotError.message
          : "Could not create the required pre-correction backup."
      );
    }
  }

  const { data: publishedCount, error: publishError } = await supabase.rpc(
    "publish_race_results",
    {
      p_official_winning_average_speed: parsed.winningAverageSpeed,
      p_race_id: raceId,
      p_results: payload.map(({ driver_id, points, position }) => ({
        driver_id,
        points,
        position
      }))
    }
  );

  if (publishError) {
    redirectWithTab(
      "error",
      withResultPublicationMigrationHint(publishError.message)
    );
  }

  const winnerOutcome = await finalizePublishedRaceWinner(supabase, raceId);
  const checkpointError = await createPublishedRaceCheckpoint(
    supabase,
    {
      id: raceId,
      raceName: importResultRace.race_name,
      roundNumber: importResultRace.round_number,
      seasonId: importResultRace.season_id
    },
    winnerOutcome
  );

  await recordAdminAudit(supabase, {
    action: "import_and_publish_results",
    afterState: {
      fantasy_winner_error: winnerOutcome.errorMessage,
      fantasy_winner_status: winnerOutcome.status,
      recovery_checkpoint_error: checkpointError,
      official_winning_average_speed: parsed.winningAverageSpeed,
      published_result_count: Number(publishedCount ?? payload.length),
      winner_profile_id: winnerOutcome.winnerProfileId
    },
    entityId: String(raceId),
    entityType: "race",
    summary: `Imported and published ${Number(publishedCount ?? payload.length)} result rows.`
  });

  revalidatePath("/admin");
  revalidatePath("/dashboard");
  revalidatePath("/leaderboard");
  revalidatePath("/picks");

  const ignoredSummary =
    parsed.ignoredLineCount > 0 ? ` ${parsed.ignoredLineCount} non-data line(s) ignored.` : "";

  const [raceNameRes, raceResultCountRes] = await Promise.all([
    supabase.from("races").select("race_name").eq("id", raceId).maybeSingle(),
    supabase
      .from("results")
      .select("id", { count: "exact", head: true })
      .eq("race_id", raceId)
  ]);

  const raceName =
    raceNameRes.error || !raceNameRes.data ? `Race #${raceId}` : raceNameRes.data.race_name;
  const raceResultCountText =
    raceResultCountRes.error || raceResultCountRes.count === null
      ? "Current result-row count for this race could not be confirmed."
      : `${raceResultCountRes.count} result row(s) are now saved for this race.`;

  redirectWithTab(
    "message",
    `Published ${Number(publishedCount ?? payload.length)} complete result row(s) for ${raceName}. ${raceResultCountText} Driver standings/groups were refreshed. ${fantasyWinnerPublicationMessage(winnerOutcome)}${
      checkpointError ? " Create and download a manual safety backup before making another correction." : ""
    }${ignoredSummary}`
  );
}

export async function finalizeHallOfFameSeasonAction(formData: FormData) {
  const { supabase } = await requireAdmin();
  const tab = parseAdminTab(asText(formData.get("tab"))) ?? "results";
  const redirectWithTab = (key: "error" | "message", value: string): never =>
    adminMutationRedirect(key, value, tab);
  const seasonId = parsePositiveInteger(asText(formData.get("season_id")));

  if (!seasonId) {
    redirectWithTab("error", "An active season is required before final standings can be saved.");
  }

  const { data: season, error: seasonError } = await supabase
    .from("league_seasons")
    .select("id,season_year,status")
    .eq("id", seasonId)
    .maybeSingle<{ id: number; season_year: number; status: string }>();
  if (seasonError || !season) {
    redirectWithTab(
      "error",
      withMigrationHint(seasonError?.message ?? "Active season not found.", LEAGUE_SEASONS_MIGRATION_FILE)
    );
  }
  const selectedSeason = season as { id: number; season_year: number; status: string };
  if (selectedSeason.status !== "active") {
    redirectWithTab("error", "Only the active season can be finalized.");
  }
  const seasonIdValue = seasonId as number;
  const seasonYear = selectedSeason.season_year;

  const { data: seasonRaces, error: racesError } = await supabase
    .from("races")
    .select("id,race_name,race_date,results_status,round_number")
    .eq("is_archived", false)
    .eq("season_id", seasonIdValue)
    .order("round_number", { ascending: true });

  if (racesError) {
    redirectWithTab("error", racesError.message);
  }

  const races = seasonRaces ?? [];
  if (races.length === 0) {
    redirectWithTab("error", `No active races were found for the ${seasonYear} season.`);
  }

  const unpublishedRaces = races.filter((race) => race.results_status !== "published");
  if (unpublishedRaces.length > 0) {
    redirectWithTab(
      "error",
      `Publish every race before finalizing the season. Still waiting on: ${unpublishedRaces
        .map((race) => race.race_name)
        .join(", ")}.`
    );
  }

  const finalRace = races[races.length - 1];
  if (Date.parse(finalRace.race_date) > Date.now()) {
    redirectWithTab("error", `The final scheduled race, ${finalRace.race_name}, has not started yet.`);
  }

  let snapshot: Awaited<ReturnType<typeof buildLeagueScoringSnapshotUncached>> | null = null;
  try {
    snapshot = await buildLeagueScoringSnapshotUncached(seasonIdValue);
  } catch (snapshotError) {
    redirectWithTab(
      "error",
      snapshotError instanceof Error
        ? snapshotError.message
        : "Failed to calculate final season standings."
    );
  }

  if (!snapshot) {
    redirectWithTab("error", "Failed to calculate final season standings.");
  }
  const finalSnapshot = snapshot as Awaited<
    ReturnType<typeof buildLeagueScoringSnapshotUncached>
  >;

  if (finalSnapshot.raceColumns.length !== races.length || finalSnapshot.leaderboardRows.length === 0) {
    redirectWithTab(
      "error",
      "Final standings are incomplete. Confirm every race has published result rows before trying again."
    );
  }

  const entries = finalSnapshot.leaderboardRows.map((row) => ({
    final_rank: row.currentStanding,
    race_breakdown: finalSnapshot.raceColumns.map((race) => ({
      points: row.raceBreakdown[race.raceId] ?? 0,
      race_date: race.raceDate,
      race_id: race.raceId,
      race_name: race.raceName,
      round_number: race.roundNumber
    })),
    team_name: row.teamName,
    total_points: row.totalPoints
  }));

  try {
    await createSeasonSafetySnapshot(
      supabase,
      seasonIdValue,
      `Before finalizing ${seasonYear} Hall of Fame standings`,
      "pre_rollover",
      `season:${seasonIdValue}:hall-of-fame`
    );
  } catch (snapshotError) {
    redirectWithTab(
      "error",
      snapshotError instanceof Error
        ? snapshotError.message
        : "Could not create the required pre-finalization backup."
    );
  }

  const { error } = await supabase.rpc("finalize_hall_of_fame_season", {
    p_entries: entries,
    p_race_count: finalSnapshot.raceColumns.length,
    p_season_year: seasonYear
  });

  if (error) {
    redirectWithTab(
      "error",
      /function .* does not exist|schema cache|hall_of_fame/i.test(error.message)
        ? withMigrationHint(error.message, HALL_OF_FAME_MIGRATION_FILE)
        : error.message
    );
  }

  await recordAdminAudit(supabase, {
    action: "finalize_hall_of_fame",
    afterState: {
      participant_count: entries.length,
      race_count: finalSnapshot.raceColumns.length,
      season_year: seasonYear
    },
    entityId: String(seasonIdValue),
    entityType: "league_season",
    summary: `Finalized ${seasonYear} Hall of Fame standings.`
  });

  revalidatePath("/admin");
  revalidatePath("/leaderboard");
  redirectWithTab(
    "message",
    `${seasonYear} final standings saved to the Hall of Fame. This snapshot remains available after drivers are retired or replaced.`
  );
}
