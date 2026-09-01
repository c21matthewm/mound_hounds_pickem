"use server";

import { revalidatePath } from "next/cache";
import { parseChampionshipStandingsPaste } from "@/lib/championship-standings";
import { errorReference, reportAppError } from "@/lib/app-error-reporter";
import {
  deleteManagedDriverHeadshot,
  getFormFile,
  uploadDriverHeadshot
} from "@/lib/driver-images";
import { requireAdmin } from "@/lib/admin";
import { recordAdminAudit } from "@/lib/admin-audit";
import { normalizeDriverName } from "@/lib/indycar-results";
import { withMigrationHint } from "@/lib/supabase/migration-errors";
import {
  type AdminTab,
  MAX_DRIVER_NAME_LENGTH,
  OPERATIONS_HARDENING_MIGRATION_FILE,
  adminMutationRedirect,
  asText,
  parseAdminTab,
  parsePositiveInteger,
  refreshDriverStandingsAndGroups,
  reportAdminActionFailure
} from "@/app/admin/action-runtime";

const reportDriverFailure = ({
  code,
  driverId,
  error,
  fallback,
  operation,
  tab,
  userId
}: {
  code: string;
  driverId?: number | null;
  error: unknown;
  fallback: string;
  operation: string;
  tab: AdminTab;
  userId: string;
}) =>
  reportAdminActionFailure({
    actorProfileId: userId,
    code,
    context: { entityId: driverId, entityType: "driver", operation },
    error,
    fallback,
    tab
  });

export async function createDriverAction(formData: FormData) {
  const { supabase, user } = await requireAdmin();
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

    await reportDriverFailure({
      code: "create-driver-failed",
      error,
      fallback: "The driver could not be created.",
      operation: "create",
      tab,
      userId: user.id
    });
  }

  const insertedDriverId = insertedDriver?.id;
  if (!insertedDriverId) {
    return redirectWithTab("error", "Driver was created but no id was returned.");
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
        await reportDriverFailure({
          code: "save-driver-image-failed",
          driverId: insertedDriverId,
          error: updateImageError,
          fallback: "The driver was created, but its image could not be saved.",
          operation: "save_image",
          tab,
          userId: user.id
        });
      }
    } catch (uploadError) {
      await reportDriverFailure({
        code: "upload-driver-image-failed",
        driverId: insertedDriverId,
        error: uploadError,
        fallback: "The driver was created, but its image upload failed.",
        operation: "upload_image",
        tab,
        userId: user.id
      });
    }
  }

  try {
    await refreshDriverStandingsAndGroups(supabase);
  } catch (refreshError) {
    await reportDriverFailure({
      code: "refresh-driver-order-failed",
      driverId: insertedDriverId,
      error: refreshError,
      fallback: "The driver was created, but standings could not be refreshed.",
      operation: "refresh_order",
      tab,
      userId: user.id
    });
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
  const { supabase, user } = await requireAdmin();
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
    await reportDriverFailure({
      code: "load-driver-for-update-failed",
      driverId: driverIdValue,
      error: existingDriverError,
      fallback: "The driver could not be loaded for editing.",
      operation: "load_for_update",
      tab,
      userId: user.id
    });
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
      await reportDriverFailure({
        code: "upload-driver-image-failed",
        driverId: driverIdValue,
        error: uploadError,
        fallback: "The driver image could not be uploaded.",
        operation: "upload_image",
        tab,
        userId: user.id
      });
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

    await reportDriverFailure({
      code: "update-driver-failed",
      driverId: driverIdValue,
      error,
      fallback: "The driver could not be updated.",
      operation: "update",
      tab,
      userId: user.id
    });
  }

  let imageCleanupWarning = "";
  if (existingDriverImageUrl && existingDriverImageUrl !== imageUrl) {
    try {
      await deleteManagedDriverHeadshot(existingDriverImageUrl);
    } catch (cleanupError) {
      const reported = await reportAppError({
        actorProfileId: user.id,
        code: "cleanup-driver-image-failed",
        context: { entityId: driverIdValue, entityType: "driver", operation: "replace_image" },
        error: cleanupError,
        route: "/admin?tab=drivers",
        severity: "warning",
        subsystem: "storage"
      });
      imageCleanupWarning = ` Replaced image cleanup needs attention.${errorReference(reported)}`;
    }
  }

  try {
    await refreshDriverStandingsAndGroups(supabase);
  } catch (refreshError) {
    await reportDriverFailure({
      code: "refresh-driver-order-failed",
      driverId: driverIdValue,
      error: refreshError,
      fallback: "The driver was updated, but standings could not be refreshed.",
      operation: "refresh_order",
      tab,
      userId: user.id
    });
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
  const { supabase, user } = await requireAdmin();
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
    await reportDriverFailure({
      code: "check-driver-usage-failed",
      driverId: driverIdValue,
      error: pickUsageResponse.error,
      fallback: "Driver usage could not be checked safely.",
      operation: "check_pick_usage",
      tab,
      userId: user.id
    });
  }
  if (resultUsageResponse.error) {
    await reportDriverFailure({
      code: "check-driver-usage-failed",
      driverId: driverIdValue,
      error: resultUsageResponse.error,
      fallback: "Driver usage could not be checked safely.",
      operation: "check_result_usage",
      tab,
      userId: user.id
    });
  }
  if (raceFieldUsageResponse.error) {
    await reportDriverFailure({
      code: "check-driver-usage-failed",
      driverId: driverIdValue,
      error: raceFieldUsageResponse.error,
      fallback: "Driver usage could not be checked safely.",
      operation: "check_field_usage",
      tab,
      userId: user.id
    });
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
    await reportDriverFailure({
      code: "delete-driver-failed",
      driverId: driverIdValue,
      error,
      fallback: "The driver could not be deleted.",
      operation: "delete",
      tab,
      userId: user.id
    });
  }

  let imageCleanupWarning = "";
  try {
    await deleteManagedDriverHeadshot(deletedDriver?.image_url ?? null);
  } catch (cleanupError) {
    const reported = await reportAppError({
      actorProfileId: user.id,
      code: "cleanup-driver-image-failed",
      context: { entityId: driverIdValue, entityType: "driver", operation: "delete" },
      error: cleanupError,
      route: "/admin?tab=drivers",
      severity: "warning",
      subsystem: "storage"
    });
    imageCleanupWarning = ` Stored image cleanup needs attention.${errorReference(reported)}`;
  }

  try {
    await refreshDriverStandingsAndGroups(supabase);
  } catch (refreshError) {
    await reportDriverFailure({
      code: "refresh-driver-order-failed",
      driverId: driverIdValue,
      error: refreshError,
      fallback: "The driver was deleted, but standings could not be refreshed.",
      operation: "refresh_order",
      tab,
      userId: user.id
    });
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
  const { supabase, user } = await requireAdmin();
  const tab = parseAdminTab(asText(formData.get("tab"))) ?? "drivers";
  const redirectWithTab = (key: "error" | "message", value: string): never =>
    adminMutationRedirect(key, value, tab);
  const rawPaste = asText(formData.get("standings_paste"));
  const seasonId = parsePositiveInteger(asText(formData.get("season_id")));

  if (!rawPaste || !seasonId) {
    return redirectWithTab(
      "error",
      "Select a season and paste the standings table before importing."
    );
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
    await reportDriverFailure({
      code: "load-driver-roster-failed",
      error: existingDriversError,
      fallback: "The existing driver roster could not be loaded.",
      operation: "import_roster",
      tab,
      userId: user.id
    });
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
    await reportDriverFailure({
      code: "sync-driver-roster-failed",
      error: withMigrationHint(syncError.message, OPERATIONS_HARDENING_MIGRATION_FILE),
      fallback: "The opening driver roster could not be synchronized.",
      operation: "import_roster",
      tab,
      userId: user.id
    });
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
