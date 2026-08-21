"use server";

import { revalidatePath } from "next/cache";
import { getFormFile } from "@/lib/driver-images";
import { errorReference, reportAppError } from "@/lib/app-error-reporter";
import { finalizeRaceWinnerNow } from "@/lib/fantasy-winner";
import { deleteManagedRaceTitleImage, uploadRaceTitleImage } from "@/lib/race-images";
import { requireAdmin } from "@/lib/admin";
import { recordAdminAudit } from "@/lib/admin-audit";
import {
  normalizeRacePickFormat,
  type RacePickFormat
} from "@/lib/race-format";
import { withMigrationHint } from "@/lib/supabase/migration-errors";
import { getLeagueYear, parseLeagueDateTimeLocalInput } from "@/lib/timezone";
import {
  type EditablePickWindowRace,
  LEAGUE_SEASONS_MIGRATION_FILE,
  MAX_RACE_NAME_LENGTH,
  SHARED_PICK_WINDOWS_MIGRATION_FILE,
  adminMutationRedirect,
  asText,
  ensureRaceIsActive,
  isUuid,
  parseAdminTab,
  parseNonNegativeNumber,
  parsePositiveInteger,
  parseRacePickFormat,
  reportAdminActionFailure,
  timestampsMatch,
  withResultPublicationMigrationHint
} from "@/app/admin/action-runtime";

const reportRaceFailure = ({
  code,
  error,
  fallback,
  operation,
  raceId,
  userId
}: {
  code: string;
  error: unknown;
  fallback: string;
  operation: string;
  raceId?: number | null;
  userId: string;
}) =>
  reportAdminActionFailure({
    actorProfileId: userId,
    code,
    context: { entityId: raceId, entityType: "race", operation, raceId },
    error,
    fallback,
    tab: "races"
  });

export async function createRaceAction(formData: FormData) {
  const { supabase, user } = await requireAdmin();
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

  if (seasonError) {
    await reportRaceFailure({
      code: "load-race-season-failed",
      error: withMigrationHint(seasonError.message, LEAGUE_SEASONS_MIGRATION_FILE),
      fallback: "The selected season could not be loaded.",
      operation: "create",
      userId: user.id
    });
  }
  if (!season) {
    redirectWithTab("error", "Selected season was not found.");
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

    if (partnerError) {
      await reportRaceFailure({
        code: "load-pick-window-partner-failed",
        error: withMigrationHint(partnerError.message, SHARED_PICK_WINDOWS_MIGRATION_FILE),
        fallback: "The shared-deadline race could not be loaded.",
        operation: "create_pick_window",
        raceId: pickWindowPartnerId,
        userId: user.id
      });
    }
    if (!partner) {
      redirectWithTab("error", "Selected shared-deadline race was not found.");
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
      await reportRaceFailure({
        code: "check-pick-window-failed",
        error: withMigrationHint(partnerWindowError.message, SHARED_PICK_WINDOWS_MIGRATION_FILE),
        fallback: "The shared pick deadline could not be checked.",
        operation: "create_pick_window",
        raceId: pickWindowPartnerId,
        userId: user.id
      });
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
    await reportRaceFailure({
      code: "create-race-failed",
      error: withMigrationHint(
        error.message,
        pickWindowPartnerId
          ? SHARED_PICK_WINDOWS_MIGRATION_FILE
          : LEAGUE_SEASONS_MIGRATION_FILE
      ),
      fallback: "The race could not be created.",
      operation: "create",
      userId: user.id
    });
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
        await reportRaceFailure({
          code: "save-race-image-failed",
          error: updateImageError,
          fallback: "The race was created, but its title image could not be saved.",
          operation: "save_image",
          raceId: insertedRaceId,
          userId: user.id
        });
      }
    } catch (uploadError) {
      await reportRaceFailure({
        code: "upload-race-image-failed",
        error: uploadError,
        fallback: "The race was created, but its title image upload failed.",
        operation: "upload_image",
        raceId: insertedRaceId,
        userId: user.id
      });
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
  const { supabase, user } = await requireAdmin();
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
    await reportRaceFailure({
      code: "load-race-for-update-failed",
      error: existingRaceError,
      fallback: "The race could not be loaded for editing.",
      operation: "load_for_update",
      raceId: raceIdValue,
      userId: user.id
    });
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
    await reportRaceFailure({
      code: "check-pick-window-failed",
      error: withMigrationHint(pickWindowCountError.message, SHARED_PICK_WINDOWS_MIGRATION_FILE),
      fallback: "The shared pick deadline could not be checked.",
      operation: "update",
      raceId: raceIdValue,
      userId: user.id
    });
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
  if (seasonError) {
    await reportRaceFailure({
      code: "load-race-season-failed",
      error: withMigrationHint(seasonError.message, LEAGUE_SEASONS_MIGRATION_FILE),
      fallback: "The selected season could not be loaded.",
      operation: "update",
      raceId: raceIdValue,
      userId: user.id
    });
  }
  if (!season) {
    redirectWithTab("error", "Selected season was not found.");
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
      await reportRaceFailure({
        code: "check-race-dependencies-failed",
        error:
          pickCountResponse.error ??
          resultCountResponse.error ??
          new Error("Failed checking race dependencies."),
        fallback: "Race dependencies could not be checked safely.",
        operation: "update",
        raceId: raceIdValue,
        userId: user.id
      });
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
      await reportRaceFailure({
        code: "upload-race-image-failed",
        error: uploadError,
        fallback: "The race title image could not be uploaded.",
        operation: "upload_image",
        raceId: raceIdValue,
        userId: user.id
      });
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
    await reportRaceFailure({
      code: "update-race-failed",
      error: withMigrationHint(error.message, SHARED_PICK_WINDOWS_MIGRATION_FILE),
      fallback: "The race could not be updated.",
      operation: "update",
      raceId: raceIdValue,
      userId: user.id
    });
  }

  let imageCleanupWarning = "";
  if (existingRaceImageUrl && existingRaceImageUrl !== titleImageUrl) {
    try {
      await deleteManagedRaceTitleImage(existingRaceImageUrl);
    } catch (cleanupError) {
      const reported = await reportAppError({
        actorProfileId: user.id,
        code: "cleanup-race-image-failed",
        context: { entityId: raceIdValue, entityType: "race", operation: "replace_image" },
        error: cleanupError,
        route: "/admin?tab=races",
        severity: "warning",
        subsystem: "storage"
      });
      imageCleanupWarning = ` Replaced image cleanup needs attention.${errorReference(reported)}`;
    }
  }

  await recordAdminAudit(supabase, {
    action: scheduleChanged ? "schedule_correction" : "update",
    afterState: {
      pick_format: pickFormat,
      payout: payoutValue,
      qualifying_start_at: qualifyingStartAt,
      race_date: raceDate,
      race_name: raceName,
      round_number: roundNumber,
      season_id: seasonId
    },
    beforeState: {
      pick_format: selectedExistingRace.pick_format,
      qualifying_start_at: selectedExistingRace.qualifying_start_at,
      race_date: selectedExistingRace.race_date,
      round_number: selectedExistingRace.round_number,
      season_id: selectedExistingRace.season_id
    },
    entityId: String(raceIdValue),
    entityType: "race",
    summary: scheduleChanged
      ? `Corrected schedule for ${raceName}.`
      : `Updated ${raceName}.`
  });

  revalidatePath("/admin");
  revalidatePath("/picks");
  revalidatePath("/leaderboard");
  redirectWithTab("message", `Race updated.${imageCleanupWarning}`);
}

export async function setRacePickWindowAction(formData: FormData) {
  const { supabase, user } = await requireAdmin();
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

  if (selectedRaceError) {
    await reportRaceFailure({
      code: "load-pick-window-race-failed",
      error: withMigrationHint(selectedRaceError.message, SHARED_PICK_WINDOWS_MIGRATION_FILE),
      fallback: "The selected race could not be loaded.",
      operation: "set_pick_window",
      raceId,
      userId: user.id
    });
  }
  if (!selectedRace) {
    adminMutationRedirect("error", "Selected race was not found.", "races");
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
    await reportRaceFailure({
      code: "load-current-pick-window-failed",
      error: withMigrationHint(currentWindowError.message, SHARED_PICK_WINDOWS_MIGRATION_FILE),
      fallback: "The current pick deadline could not be loaded.",
      operation: "set_pick_window",
      raceId,
      userId: user.id
    });
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
      await reportRaceFailure({
        code: "unlink-pick-window-failed",
        error: withMigrationHint(unlinkError.message, SHARED_PICK_WINDOWS_MIGRATION_FILE),
        fallback: "The shared pick deadline could not be removed.",
        operation: "unlink_pick_window",
        raceId,
        userId: user.id
      });
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
  if (partnerRaceError) {
    await reportRaceFailure({
      code: "load-pick-window-partner-failed",
      error: withMigrationHint(partnerRaceError.message, SHARED_PICK_WINDOWS_MIGRATION_FILE),
      fallback: "The partner race could not be loaded.",
      operation: "set_pick_window",
      raceId: partnerId,
      userId: user.id
    });
  }
  if (!partnerRace) {
    adminMutationRedirect("error", "Selected partner race was not found.", "races");
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
    await reportRaceFailure({
      code: "check-pick-window-failed",
      error: withMigrationHint(partnerWindowError.message, SHARED_PICK_WINDOWS_MIGRATION_FILE),
      fallback: "The partner pick deadline could not be checked.",
      operation: "set_pick_window",
      raceId: partnerId,
      userId: user.id
    });
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
    await reportRaceFailure({
      code: "link-pick-window-failed",
      error: withMigrationHint(linkError.message, SHARED_PICK_WINDOWS_MIGRATION_FILE),
      fallback: "The shared pick deadline could not be saved.",
      operation: "link_pick_window",
      raceId,
      userId: user.id
    });
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
  const { supabase, user } = await requireAdmin();
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
    await reportRaceFailure({
      code: "check-race-dependencies-failed",
      error:
        pickCountResponse.error ??
        resultCountResponse.error ??
        new Error("Failed checking race dependencies."),
      fallback: "Race dependencies could not be checked safely.",
      operation: "delete",
      raceId: raceIdValue,
      userId: user.id
    });
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
    await reportRaceFailure({
      code: "delete-race-failed",
      error,
      fallback: "The race could not be deleted.",
      operation: "delete",
      raceId: raceIdValue,
      userId: user.id
    });
  }

  let imageCleanupWarning = "";
  try {
    await deleteManagedRaceTitleImage(deletedRace?.title_image_url ?? null);
  } catch (cleanupError) {
    const reported = await reportAppError({
      actorProfileId: user.id,
      code: "cleanup-race-image-failed",
      context: { entityId: raceIdValue, entityType: "race", operation: "delete" },
      error: cleanupError,
      route: "/admin?tab=races",
      severity: "warning",
      subsystem: "storage"
    });
    imageCleanupWarning = ` Stored image cleanup needs attention.${errorReference(reported)}`;
  }

  const { error: refreshError } = await supabase.rpc(
    "refresh_driver_standings_from_published_results"
  );
  if (refreshError) {
    await reportRaceFailure({
      code: "refresh-driver-order-failed",
      error: withResultPublicationMigrationHint(refreshError.message),
      fallback: "The race was deleted, but driver standings could not be refreshed.",
      operation: "refresh_after_delete",
      raceId: raceIdValue,
      userId: user.id
    });
  }

  await recordAdminAudit(supabase, {
    action: "delete",
    afterState: null,
    beforeState: deletedRace ?? null,
    entityId: String(raceIdValue),
    entityType: "race",
    summary: `Deleted empty race ${deletedRace?.race_name ?? `#${raceIdValue}`}.`
  });

  revalidatePath("/admin");
  revalidatePath("/picks");
  revalidatePath("/leaderboard");
  redirectWithTab("message", `Race deleted.${imageCleanupWarning}`);
}

export async function setRaceArchivedAction(formData: FormData) {
  const { supabase, user } = await requireAdmin();
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
  if (selectedRaceError) {
    await reportRaceFailure({
      code: "load-race-for-archive-failed",
      error: withMigrationHint(selectedRaceError.message, SHARED_PICK_WINDOWS_MIGRATION_FILE),
      fallback: "The race could not be loaded.",
      operation: shouldArchive ? "archive" : "unarchive",
      raceId: raceIdValue,
      userId: user.id
    });
  }
  if (!selectedRace) {
    redirectWithTab("error", "Race not found.");
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
    await reportRaceFailure({
      code: "archive-race-failed",
      error,
      fallback: shouldArchive ? "The race could not be archived." : "The race could not be unarchived.",
      operation: shouldArchive ? "archive" : "unarchive",
      raceId: raceIdValue,
      userId: user.id
    });
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
  const { supabase, user } = await requireAdmin();
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
    await reportRaceFailure({
      code: "load-race-winner-status-failed",
      error: withResultPublicationMigrationHint(winnerRaceStatusError.message),
      fallback: "The race result status could not be checked.",
      operation: "set_winner",
      raceId: selectedRaceId,
      userId: user.id
    });
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
      await reportRaceFailure({
        code: "load-winner-profile-failed",
        error: winnerProfileError,
        fallback: "The selected fantasy winner could not be checked.",
        operation: "set_winner",
        raceId: selectedRaceId,
        userId: user.id
      });
    }
    if (!winnerProfile) {
      redirectWithTab("error", "Selected fantasy winner was not found.");
    }
  }

  if (!winnerProfileId) {
    try {
      await finalizeRaceWinnerNow(supabase, selectedRaceId);
    } catch (error) {
      await reportRaceFailure({
        code: "calculate-fantasy-winner-failed",
        error,
        fallback: "The fantasy winner could not be recalculated.",
        operation: "recalculate_winner",
        raceId: selectedRaceId,
        userId: user.id
      });
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
      await reportRaceFailure({
        code: "set-fantasy-winner-failed",
        error,
        fallback: "The fantasy winner could not be updated.",
        operation: "set_winner",
        raceId: selectedRaceId,
        userId: user.id
      });
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
