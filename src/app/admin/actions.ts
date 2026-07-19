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
import { normalizeDriverName, parseIndycarResultsPaste } from "@/lib/indycar-results";
import { parseQualifyingOrderPaste } from "@/lib/qualifying-order";
import {
  INDY_500_QUALIFYING_FIELD_SIZE,
  indy500GroupForQualifyingPosition,
  isRacePickFormat,
  normalizeRacePickFormat,
  type RacePickFormat
} from "@/lib/race-format";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/service-role";
import { withMigrationHint } from "@/lib/supabase/migration-errors";
import { invalidateScoringCache } from "@/lib/scoring-cache";
import { buildLeagueScoringSnapshotUncached } from "@/lib/scoring";
import { getLeagueYear, parseLeagueDateTimeLocalInput } from "@/lib/timezone";

const asText = (value: FormDataEntryValue | null): string =>
  typeof value === "string" ? value.trim() : "";

const TEST_FLOW_PREFIX = "[TEST FLOW ";
const MAX_DRIVER_NAME_LENGTH = 100;
const MAX_PROFILE_NAME_LENGTH = 100;
const MAX_RACE_NAME_LENGTH = 200;

type AdminTab = "drivers" | "participants" | "races" | "results" | "feedback";

type RaceStatusRow = {
  id: number;
  is_archived: boolean;
  pick_format: RacePickFormat;
};

const parseAdminTab = (value: string): AdminTab | null => {
  if (
    value === "drivers" ||
    value === "participants" ||
    value === "races" ||
    value === "results" ||
    value === "feedback"
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

const withResultPublicationMigrationHint = (message: string): string =>
  /function .* does not exist|schema cache/i.test(message)
    ? withMigrationHint(message, RESULT_PUBLICATION_MIGRATION_FILE)
    : message;

const adminRedirect = (key: "error" | "message", value: string, tab?: AdminTab): never => {
  const params = new URLSearchParams({ [key]: value });
  if (tab) {
    params.set("tab", tab);
  }
  redirect(`/admin?${params.toString()}`);
};

const adminMutationRedirect = (
  key: "error" | "message",
  value: string,
  tab: AdminTab
): never => {
  if (key === "message") {
    invalidateScoringCache();
  }
  return adminRedirect(key, value, tab);
};

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

  if (!seasonYear || seasonYear < 2000 || seasonYear > 2100) {
    adminRedirect("error", "Enter a valid four-digit season year.", "races");
  }

  const { error } = await supabase.from("league_seasons").insert({
    display_name: String(seasonYear),
    season_year: seasonYear,
    status: "upcoming"
  });

  if (error) {
    adminRedirect(
      "error",
      error.code === "23505"
        ? `${seasonYear} already exists.`
        : withMigrationHint(error.message, LEAGUE_SEASONS_MIGRATION_FILE),
      "races"
    );
  }

  revalidatePath("/admin");
  adminRedirect("message", `${seasonYear} season created. Add its schedule before activation.`, "races");
}

export async function activateLeagueSeasonAction(formData: FormData) {
  const { supabase } = await requireAdmin();
  const seasonId = parsePositiveInteger(asText(formData.get("season_id")));

  if (!seasonId) {
    adminRedirect("error", "Select a season to activate.", "races");
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
  const seasonRegistered = asText(formData.get("season_registered")) === "on";

  if (!isUuid(profileId) || !teamName) {
    adminRedirect("error", "A valid participant and team name are required.", "participants");
  }
  if (fullName.length > MAX_PROFILE_NAME_LENGTH || teamName.length > MAX_PROFILE_NAME_LENGTH) {
    adminRedirect("error", "Participant and team names must be 100 characters or fewer.", "participants");
  }

  const { error: profileError } = await supabase
    .from("profiles")
    .update({
      full_name: fullName || null,
      team_name: teamName
    })
    .eq("id", profileId);

  if (profileError) {
    adminRedirect(
      "error",
      profileError.code === "23505" ? "That team name is already in use." : profileError.message,
      "participants"
    );
  }

  const { data: activeSeason, error: seasonError } = await supabase
    .from("league_seasons")
    .select("id")
    .eq("status", "active")
    .maybeSingle<{ id: number }>();

  if (seasonError || !activeSeason) {
    return adminRedirect(
      "error",
      seasonError?.message ?? "Activate a season before changing participant registration.",
      "participants"
    );
  }

  const now = new Date().toISOString();
  const { error: registrationError } = await supabase.from("season_participants").upsert(
    {
      decided_at: now,
      profile_id: profileId,
      registered_at: seasonRegistered ? now : null,
      season_id: activeSeason.id,
      status: seasonRegistered ? "registered" : "declined"
    },
    { onConflict: "season_id,profile_id" }
  );

  if (registrationError) {
    adminRedirect("error", registrationError.message, "participants");
  }

  invalidateScoringCache();
  revalidatePath("/admin");
  revalidatePath("/dashboard");
  revalidatePath("/picks");
  revalidatePath("/leaderboard");
  adminRedirect("message", "Participant updated.", "participants");
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
    .select("image_url")
    .eq("id", driverIdValue)
    .maybeSingle<{ image_url: string | null }>();

  if (existingDriverError) {
    redirectWithTab("error", existingDriverError.message);
  }
  if (!existingDriver) {
    redirectWithTab("error", "Driver not found.");
  }
  const existingDriverImageUrl = existingDriver?.image_url ?? null;

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
    .select("image_url")
    .maybeSingle<{ image_url: string | null }>();
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

  if (!rawPaste) {
    redirectWithTab("error", "Paste the standings table before importing.");
  }

  const parsed = parseChampionshipStandingsPaste(rawPaste);
  if (parsed.rows.length === 0) {
    redirectWithTab(
      "error",
      "No standings rows detected. Expected columns: Rank, Driver, ..., Points."
    );
  }

  const { data: activeSeason, error: activeSeasonError } = await supabase
    .from("league_seasons")
    .select("id,season_year")
    .eq("status", "active")
    .maybeSingle<{ id: number; season_year: number }>();

  if (activeSeasonError || !activeSeason) {
    redirectWithTab(
      "error",
      withMigrationHint(
        activeSeasonError?.message ?? "Activate a league season before importing its opening seed.",
        LEAGUE_SEASONS_MIGRATION_FILE
      )
    );
  }
  const selectedActiveSeason = activeSeason as { id: number; season_year: number };

  const { count: publishedRaceCount, error: publishedRaceCountError } = await supabase
    .from("races")
    .select("id", { count: "exact", head: true })
    .eq("season_id", selectedActiveSeason.id)
    .eq("is_archived", false)
    .eq("results_status", "published");

  if (publishedRaceCountError) {
    redirectWithTab("error", publishedRaceCountError.message);
  }
  if ((publishedRaceCount ?? 0) > 0) {
    redirectWithTab(
      "error",
      `The ${selectedActiveSeason.season_year} opening seed is locked because season results have already been published. Correct race results instead.`
    );
  }

  const { data: existingDrivers, error: existingError } = await supabase
    .from("drivers")
    .select("id,driver_name");

  if (existingError) {
    redirectWithTab("error", existingError.message);
  }

  const existingMap = new Map<string, { id: number; driverName: string }>();
  (existingDrivers ?? []).forEach((driver) => {
    existingMap.set(normalizeDriverName(driver.driver_name), {
      driverName: driver.driver_name,
      id: driver.id
    });
  });

  const seenNormalizedNames = new Set<string>();
  let createdCount = 0;
  let updatedCount = 0;

  for (const row of parsed.rows) {
    const normalizedName = normalizeDriverName(row.driverName);
    if (!normalizedName) {
      continue;
    }

    if (seenNormalizedNames.has(normalizedName)) {
      continue;
    }
    seenNormalizedNames.add(normalizedName);

    const existing = existingMap.get(normalizedName);
    if (existing) {
      const { error: updateError } = await supabase
        .from("drivers")
        .update({
          championship_points: 0,
          current_standing: row.rank,
          opening_seed_standing: row.rank
        })
        .eq("id", existing.id);

      if (updateError) {
        redirectWithTab("error", `Failed updating ${row.driverName}: ${updateError.message}`);
      }

      updatedCount += 1;
      continue;
    }

    const { error: insertError } = await supabase.from("drivers").insert({
      championship_points: 0,
      current_standing: row.rank,
      driver_name: row.driverName,
      group_number: 6,
      image_url: null,
      is_active: true,
      opening_seed_standing: row.rank
    });

    if (insertError) {
      redirectWithTab("error", `Failed creating ${row.driverName}: ${insertError.message}`);
    }

    createdCount += 1;
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

  revalidatePath("/admin");
  revalidatePath("/picks");
  revalidatePath("/leaderboard");

  const ignoredSummary =
    parsed.ignoredLineCount > 0 ? ` ${parsed.ignoredLineCount} line(s) ignored.` : "";
  redirectWithTab(
    "message",
    `${selectedActiveSeason.season_year} opening seed imported: ${updatedCount} updated, ${createdCount} created. Current-season points remain at zero.${ignoredSummary}`
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
  if (selectedSeason.status === "completed") {
    redirectWithTab("error", "Races cannot be added to a completed season.");
  }
  if (getLeagueYear(new Date(raceDate)) !== selectedSeason.season_year) {
    redirectWithTab("error", `Race start year must match the ${selectedSeason.season_year} season.`);
  }

  const { data: insertedRace, error } = await supabase
    .from("races")
    .insert({
      pick_format: pickFormat,
      payout: payoutValue,
      qualifying_start_at: qualifyingStartAt,
      race_date: raceDate,
      race_name: raceName,
      round_number: roundNumber,
      season_id: seasonId,
      title_image_url: titleImageUrlInput || null
    })
    .select("id")
    .single();

  if (error) {
    redirectWithTab("error", withMigrationHint(error.message, LEAGUE_SEASONS_MIGRATION_FILE));
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
    .select("title_image_url,season_id,round_number")
    .eq("id", raceIdValue)
    .maybeSingle<{ round_number: number; season_id: number; title_image_url: string | null }>();

  if (existingRaceError) {
    redirectWithTab("error", existingRaceError.message);
  }
  if (!existingRace) {
    redirectWithTab("error", "Race not found.");
  }
  const selectedExistingRace = existingRace as {
    round_number: number;
    season_id: number;
    title_image_url: string | null;
  };
  const existingRaceImageUrl = selectedExistingRace.title_image_url;

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
    selectedExistingRace.season_id !== seasonId || selectedExistingRace.round_number !== roundNumber;
  if (identityChanged) {
    const [{ count: pickCount }, { count: resultCount }] = await Promise.all([
      supabase.from("picks").select("id", { count: "exact", head: true }).eq("race_id", raceIdValue),
      supabase.from("results").select("id", { count: "exact", head: true }).eq("race_id", raceIdValue)
    ]);
    if ((pickCount ?? 0) > 0 || (resultCount ?? 0) > 0) {
      redirectWithTab("error", "Season and round cannot change after picks or results exist.");
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
    redirectWithTab("error", withMigrationHint(error.message, LEAGUE_SEASONS_MIGRATION_FILE));
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

  revalidatePath("/admin");
  revalidatePath("/picks");
  revalidatePath("/leaderboard");
  redirectWithTab("message", `Race updated.${imageCleanupWarning}`);
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

  const { data: deletedRace, error } = await supabase
    .from("races")
    .delete()
    .eq("id", raceIdValue)
    .select("title_image_url")
    .maybeSingle<{ title_image_url: string | null }>();
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

  const { data: updatedRace, error } = await supabase
    .from("races")
    .update(updatePayload)
    .eq("id", raceIdValue)
    .select("id")
    .maybeSingle();

  if (error) {
    redirectWithTab("error", error.message);
  }
  if (!updatedRace) {
    redirectWithTab("error", "Race not found.");
  }

  revalidatePath("/admin");
  revalidatePath("/picks");
  revalidatePath("/leaderboard");
  redirectWithTab("message", shouldArchive ? "Race archived." : "Race unarchived.");
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

  revalidatePath("/admin");
  revalidatePath("/leaderboard");
  redirectWithTab("message", winnerProfileId ? "Fantasy winner updated." : "Fantasy winner recalculated.");
}

export async function importIndy500QualifyingOrderAction(formData: FormData) {
  const { supabase } = await requireAdmin();
  const tab = parseAdminTab(asText(formData.get("tab"))) ?? "results";
  const redirectWithTab = (key: "error" | "message", value: string): never =>
    adminMutationRedirect(key, value, tab);

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

  const { error: deleteExistingError } = await supabase
    .from("race_driver_groups")
    .delete()
    .eq("race_id", raceId);

  if (deleteExistingError) {
    redirectWithTab("error", deleteExistingError.message);
  }

  const { error: insertError } = await supabase.from("race_driver_groups").insert(payload);

  if (insertError) {
    redirectWithTab("error", insertError.message);
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
  const redirectWithTab = (key: "error" | "message", value: string): never =>
    adminMutationRedirect(key, value, tab);

  const raceId = parsePositiveInteger(asText(formData.get("race_id")));
  const driverId = parsePositiveInteger(asText(formData.get("driver_id")));
  const points = parseNonNegativeNumber(asText(formData.get("points")));

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
  const redirectWithTab = (key: "error" | "message", value: string): never =>
    adminMutationRedirect(key, value, tab);

  const raceId = parsePositiveInteger(asText(formData.get("race_id")));
  const officialWinningAverageSpeed = parseNonNegativeNumber(
    asText(formData.get("official_winning_average_speed"))
  );

  if (!raceId || officialWinningAverageSpeed === null || officialWinningAverageSpeed <= 0) {
    redirectWithTab("error", "Race and a positive official winning average speed are required.");
  }

  const { data: publishedCount, error } = await supabase.rpc("publish_saved_race_results", {
    p_official_winning_average_speed: officialWinningAverageSpeed,
    p_race_id: raceId
  });

  if (error) {
    redirectWithTab(
      "error",
      withResultPublicationMigrationHint(error.message)
    );
  }

  revalidatePath("/admin");
  revalidatePath("/dashboard");
  revalidatePath("/leaderboard");
  revalidatePath("/picks");
  redirectWithTab(
    "message",
    `Published ${Number(publishedCount ?? 0)} saved result row(s). Driver standings and groups were refreshed, and fantasy winner calculation is scheduled for about 15 minutes from now.`
  );
}

export async function importIndycarResultsAction(formData: FormData) {
  const { supabase } = await requireAdmin();
  const tab = parseAdminTab(asText(formData.get("tab"))) ?? "results";
  const redirectWithTab = (key: "error" | "message", value: string): never =>
    adminMutationRedirect(key, value, tab);

  const raceIdInput = parsePositiveInteger(asText(formData.get("race_id")));
  const rawPaste = asText(formData.get("results_paste"));

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

  if (parsed.winningAverageSpeed === null) {
    redirectWithTab(
      "error",
      "Could not determine official race average speed from the pasted results. Include the Average Speed column."
    );
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
    `Published ${Number(publishedCount ?? payload.length)} complete result row(s) for ${raceName}. ${raceResultCountText} Driver standings/groups were refreshed, and fantasy winner auto-calculation is scheduled for about 15 minutes from now.${ignoredSummary}`
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

  revalidatePath("/admin");
  revalidatePath("/leaderboard");
  redirectWithTab(
    "message",
    `${seasonYear} final standings saved to the Hall of Fame. This snapshot remains available after drivers are retired or replaced.`
  );
}

export async function cleanupTestFlowDataAction(formData: FormData) {
  await requireAdmin();
  const tab = parseAdminTab(asText(formData.get("tab"))) ?? "feedback";
  const redirectWithTab = (key: "error" | "message", value: string): never =>
    adminMutationRedirect(key, value, tab);

  const serviceRoleSupabase = createServiceRoleSupabaseClient();

  const [testRacesResponse, testProfilesResponse] = await Promise.all([
    serviceRoleSupabase
      .from("races")
      .select("id")
      .ilike("race_name", `${TEST_FLOW_PREFIX}%`),
    serviceRoleSupabase
      .from("profiles")
      .select("id,team_name")
      .ilike("team_name", `${TEST_FLOW_PREFIX}%`)
  ]);

  if (testRacesResponse.error) {
    redirectWithTab("error", testRacesResponse.error.message);
  }
  if (testProfilesResponse.error) {
    redirectWithTab("error", testProfilesResponse.error.message);
  }

  const raceIds = (testRacesResponse.data ?? []).map((race) => race.id);
  const profileRows = testProfilesResponse.data ?? [];

  let deletedRaceCount = 0;
  if (raceIds.length > 0) {
    const { data: deletedRaces, error: deleteRacesError } = await serviceRoleSupabase
      .from("races")
      .delete()
      .in("id", raceIds)
      .select("id");

    if (deleteRacesError) {
      redirectWithTab("error", deleteRacesError.message);
    }

    deletedRaceCount = (deletedRaces ?? []).length;
  }

  let deletedFeedbackCount = 0;
  {
    const { data: deletedFeedbackRows, error: deleteFeedbackError } = await serviceRoleSupabase
      .from("feedback_items")
      .delete()
      .ilike("details", `${TEST_FLOW_PREFIX}%`)
      .select("id");

    if (deleteFeedbackError) {
      redirectWithTab("error", deleteFeedbackError.message);
    }

    deletedFeedbackCount = (deletedFeedbackRows ?? []).length;
  }

  let deletedAuthUserCount = 0;
  const failedAuthDeletes: string[] = [];

  for (const profileRow of profileRows) {
    const { error: deleteUserError } = await serviceRoleSupabase.auth.admin.deleteUser(profileRow.id);
    if (deleteUserError) {
      failedAuthDeletes.push(`${profileRow.team_name}: ${deleteUserError.message}`);
      continue;
    }

    deletedAuthUserCount += 1;
  }

  const { error: refreshDriverError } = await serviceRoleSupabase.rpc(
    "refresh_driver_standings_from_published_results"
  );
  if (refreshDriverError) {
    redirectWithTab(
      "error",
      `Test artifacts were deleted, but driver standings could not be refreshed: ${withResultPublicationMigrationHint(
        refreshDriverError.message
      )}`
    );
  }

  revalidatePath("/admin");
  revalidatePath("/leaderboard");
  revalidatePath("/picks");
  revalidatePath("/feedback");
  revalidatePath("/dashboard");

  if (failedAuthDeletes.length > 0) {
    redirectWithTab(
      "error",
      `Cleanup partly completed. Deleted ${deletedRaceCount} race(s), ${deletedFeedbackCount} feedback row(s), ${deletedAuthUserCount} auth user(s). Failed user deletions: ${failedAuthDeletes.join(
        " | "
      )}`
    );
  }

  redirectWithTab(
    "message",
    `Cleanup completed. Deleted ${deletedRaceCount} race(s), ${deletedFeedbackCount} feedback row(s), and ${deletedAuthUserCount} test auth user(s).`
  );
}
