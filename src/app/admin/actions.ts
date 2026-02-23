"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { parseChampionshipStandingsPaste } from "@/lib/championship-standings";
import { getFormFile, uploadDriverHeadshot } from "@/lib/driver-images";
import {
  finalizeRaceWinnerNow,
  scheduleRaceWinnerAutoCalculation
} from "@/lib/fantasy-winner";
import { uploadRaceTitleImage } from "@/lib/race-images";
import { requireAdmin } from "@/lib/admin";
import { normalizeDriverName, parseIndycarResultsPaste } from "@/lib/indycar-results";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/service-role";
import { parseLeagueDateTimeLocalInput } from "@/lib/timezone";

const asText = (value: FormDataEntryValue | null): string =>
  typeof value === "string" ? value.trim() : "";

const TEST_FLOW_PREFIX = "[TEST FLOW ";

type AdminTab = "drivers" | "races" | "results" | "feedback";

type RaceStatusRow = {
  id: number;
  is_archived: boolean;
};

const parseAdminTab = (value: string): AdminTab | null => {
  if (value === "drivers" || value === "races" || value === "results" || value === "feedback") {
    return value;
  }

  return null;
};

const adminRedirect = (key: "error" | "message", value: string, tab?: AdminTab): never => {
  const params = new URLSearchParams({ [key]: value });
  if (tab) {
    params.set("tab", tab);
  }
  redirect(`/admin?${params.toString()}`);
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

  if (Number.isNaN(parsed) || parsed < 0) {
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

async function refreshDriverChampionshipPointsFromResults(supabase: SupabaseClient) {
  const [driversResponse, resultsResponse] = await Promise.all([
    supabase.from("drivers").select("id"),
    supabase.from("results").select("driver_id,points")
  ]);

  if (driversResponse.error) {
    throw new Error(driversResponse.error.message);
  }
  if (resultsResponse.error) {
    throw new Error(resultsResponse.error.message);
  }

  const pointsByDriverId = new Map<number, number>();
  (resultsResponse.data ?? []).forEach((result) => {
    const current = pointsByDriverId.get(result.driver_id) ?? 0;
    pointsByDriverId.set(result.driver_id, current + Number(result.points));
  });

  const updateResponses = await Promise.all(
    (driversResponse.data ?? []).map((driver) =>
      supabase
        .from("drivers")
        .update({
          championship_points: pointsByDriverId.get(driver.id) ?? 0
        })
        .eq("id", driver.id)
    )
  );

  const failedUpdate = updateResponses.find((result) => result.error);
  if (failedUpdate?.error) {
    throw new Error(failedUpdate.error.message);
  }

  await refreshDriverStandingsAndGroups(supabase);
}

async function ensureRaceIsActive(supabase: SupabaseClient, raceId: number) {
  const { data: race, error } = await supabase
    .from("races")
    .select("id,is_archived")
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

export async function createDriverAction(formData: FormData) {
  const { supabase } = await requireAdmin();
  const tab = parseAdminTab(asText(formData.get("tab"))) ?? "drivers";
  const redirectWithTab = (key: "error" | "message", value: string): never =>
    adminRedirect(key, value, tab);

  const driverName = asText(formData.get("driver_name"));
  const imageUrlInput = asText(formData.get("image_url"));
  const imageFile = getFormFile(formData, "image_file");
  const isActive = asText(formData.get("is_active")) === "on";

  if (!driverName) {
    redirectWithTab("error", "Driver name is required.");
  }

  const { data: insertedDriver, error } = await supabase
    .from("drivers")
    .insert({
      championship_points: 0,
      current_standing: 9999,
      driver_name: driverName,
      group_number: 6,
      image_url: imageUrlInput || null,
      is_active: isActive
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
    adminRedirect(key, value, tab);

  const driverId = parsePositiveInteger(asText(formData.get("driver_id")));
  const driverName = asText(formData.get("driver_name"));
  const imageUrlInput = asText(formData.get("image_url"));
  const imageFile = getFormFile(formData, "image_file");
  const isActive = asText(formData.get("is_active")) === "on";

  if (!driverId || !driverName) {
    redirectWithTab("error", "Driver update requires id and name.");
  }
  const driverIdValue = driverId as number;

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
    if (error.code === "23505") {
      redirectWithTab("error", "Driver name already exists.");
    }

    redirectWithTab("error", error.message);
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
  redirectWithTab("message", "Driver updated. Standings and groups were refreshed.");
}

export async function deleteDriverAction(formData: FormData) {
  const { supabase } = await requireAdmin();
  const tab = parseAdminTab(asText(formData.get("tab"))) ?? "drivers";
  const redirectWithTab = (key: "error" | "message", value: string): never =>
    adminRedirect(key, value, tab);
  const driverId = parsePositiveInteger(asText(formData.get("driver_id")));

  if (!driverId) {
    redirectWithTab("error", "Driver id is required for deletion.");
  }
  const driverIdValue = driverId as number;

  const [pickUsageResponse, resultUsageResponse] = await Promise.all([
    supabase
      .from("picks")
      .select("id")
      .or(
        `driver_group1_id.eq.${driverIdValue},driver_group2_id.eq.${driverIdValue},driver_group3_id.eq.${driverIdValue},driver_group4_id.eq.${driverIdValue},driver_group5_id.eq.${driverIdValue},driver_group6_id.eq.${driverIdValue}`
      )
      .limit(1),
    supabase.from("results").select("id").eq("driver_id", driverIdValue).limit(1)
  ]);

  if (pickUsageResponse.error) {
    redirectWithTab("error", pickUsageResponse.error.message);
  }
  if (resultUsageResponse.error) {
    redirectWithTab("error", resultUsageResponse.error.message);
  }

  const hasPicks = (pickUsageResponse.data ?? []).length > 0;
  const hasResults = (resultUsageResponse.data ?? []).length > 0;
  if (hasPicks || hasResults) {
    redirectWithTab(
      "error",
      "Cannot delete a driver that appears in picks or race results. Mark the driver inactive instead."
    );
  }

  const { error } = await supabase.from("drivers").delete().eq("id", driverIdValue);
  if (error) {
    redirectWithTab("error", error.message);
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
  redirectWithTab("message", "Driver deleted.");
}

export async function importChampionshipStandingsAction(formData: FormData) {
  const { supabase } = await requireAdmin();
  const tab = parseAdminTab(asText(formData.get("tab"))) ?? "drivers";
  const redirectWithTab = (key: "error" | "message", value: string): never =>
    adminRedirect(key, value, tab);
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
          championship_points: row.points,
          current_standing: row.rank
        })
        .eq("id", existing.id);

      if (updateError) {
        redirectWithTab("error", `Failed updating ${row.driverName}: ${updateError.message}`);
      }

      updatedCount += 1;
      continue;
    }

    const { error: insertError } = await supabase.from("drivers").insert({
      championship_points: row.points,
      current_standing: row.rank,
      driver_name: row.driverName,
      group_number: 6,
      image_url: null,
      is_active: true
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
    `Standings imported: ${updatedCount} updated, ${createdCount} created.${ignoredSummary}`
  );
}

export async function createRaceAction(formData: FormData) {
  const { supabase } = await requireAdmin();
  const tab = parseAdminTab(asText(formData.get("tab"))) ?? "races";
  const redirectWithTab = (key: "error" | "message", value: string): never =>
    adminRedirect(key, value, tab);

  const raceName = asText(formData.get("race_name"));
  const raceDateInput = asText(formData.get("race_date"));
  const qualifyingStartInput = asText(formData.get("qualifying_start_at"));
  const titleImageUrlInput = asText(formData.get("title_image_url"));
  const titleImageFile = getFormFile(formData, "title_image_file");
  const payoutValue = parseNonNegativeNumber(asText(formData.get("payout")));
  const raceDate = parseLeagueDateTimeLocalInput(raceDateInput);
  const qualifyingStartAt = parseLeagueDateTimeLocalInput(qualifyingStartInput);

  if (!raceName || payoutValue === null) {
    redirectWithTab(
      "error",
      "Race name, qualifying start, race start, and payout are required. Use valid Indianapolis times."
    );
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

  const { data: insertedRace, error } = await supabase
    .from("races")
    .insert({
      payout: payoutValue,
      qualifying_start_at: qualifyingStartAt,
      race_date: raceDate,
      race_name: raceName,
      title_image_url: titleImageUrlInput || null
    })
    .select("id")
    .single();

  if (error) {
    redirectWithTab("error", error.message);
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
    adminRedirect(key, value, tab);

  const raceId = parsePositiveInteger(asText(formData.get("race_id")));
  const raceName = asText(formData.get("race_name"));
  const raceDateInput = asText(formData.get("race_date"));
  const qualifyingStartInput = asText(formData.get("qualifying_start_at"));
  const titleImageUrlInput = asText(formData.get("title_image_url"));
  const titleImageFile = getFormFile(formData, "title_image_file");
  const payoutValue = parseNonNegativeNumber(asText(formData.get("payout")));

  if (!raceId || !raceName || payoutValue === null) {
    redirectWithTab(
      "error",
      "Race id, race name, qualifying start, race start, and payout are required."
    );
  }
  const raceIdValue = raceId as number;

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
      payout: payoutValue,
      qualifying_start_at: qualifyingStartAt,
      race_date: raceDate,
      race_name: raceName,
      title_image_url: titleImageUrl
    })
    .eq("id", raceIdValue);

  if (error) {
    redirectWithTab("error", error.message);
  }

  revalidatePath("/admin");
  revalidatePath("/picks");
  revalidatePath("/leaderboard");
  redirectWithTab("message", "Race updated.");
}

export async function deleteRaceAction(formData: FormData) {
  const { supabase } = await requireAdmin();
  const tab = parseAdminTab(asText(formData.get("tab"))) ?? "races";
  const redirectWithTab = (key: "error" | "message", value: string): never =>
    adminRedirect(key, value, tab);

  const raceId = parsePositiveInteger(asText(formData.get("race_id")));
  if (!raceId) {
    redirectWithTab("error", "Race id is required for deletion.");
  }
  const raceIdValue = raceId as number;

  const { error } = await supabase.from("races").delete().eq("id", raceIdValue);
  if (error) {
    redirectWithTab("error", error.message);
  }

  revalidatePath("/admin");
  revalidatePath("/picks");
  revalidatePath("/leaderboard");
  redirectWithTab("message", "Race deleted.");
}

export async function setRaceArchivedAction(formData: FormData) {
  const { supabase } = await requireAdmin();
  const tab = parseAdminTab(asText(formData.get("tab"))) ?? "races";
  const redirectWithTab = (key: "error" | "message", value: string): never =>
    adminRedirect(key, value, tab);

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
    adminRedirect(key, value, tab);

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

export async function upsertResultAction(formData: FormData) {
  const { supabase } = await requireAdmin();
  const tab = parseAdminTab(asText(formData.get("tab"))) ?? "results";
  const redirectWithTab = (key: "error" | "message", value: string): never =>
    adminRedirect(key, value, tab);

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

  const { error } = await supabase.from("results").upsert(
    {
      driver_id: selectedDriverId,
      points,
      race_id: selectedRaceId
    },
    { onConflict: "race_id,driver_id" }
  );

  if (error) {
    redirectWithTab("error", error.message);
  }

  try {
    await refreshDriverChampionshipPointsFromResults(supabase);
  } catch (refreshError) {
    const message =
      refreshError instanceof Error
        ? refreshError.message
        : "Race result saved, but failed to refresh driver standings/groups.";
    redirectWithTab("error", message);
  }

  try {
    await scheduleRaceWinnerAutoCalculation(supabase, selectedRaceId);
  } catch (scheduleError) {
    const message =
      scheduleError instanceof Error
        ? scheduleError.message
        : "Race result saved, but failed to schedule fantasy winner auto-calculation.";
    redirectWithTab("error", message);
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
    `Saved ${points} point(s) for ${driverName} in ${raceName}. ${raceResultCountText} Driver standings/groups were refreshed, and fantasy winner auto-calculation is scheduled for about 15 minutes from now.`
  );
}

export async function importIndycarResultsAction(formData: FormData) {
  const { supabase } = await requireAdmin();
  const tab = parseAdminTab(asText(formData.get("tab"))) ?? "results";
  const redirectWithTab = (key: "error" | "message", value: string): never =>
    adminRedirect(key, value, tab);

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
  const payload: Array<{ driver_id: number; points: number; race_id: number }> = [];
  const seenDriverIds = new Set<number>();

  parsed.rows.forEach((row) => {
    const normalized = normalizeDriverName(row.driverName);
    const match = driverMap.get(normalized);

    if (!match) {
      unmatchedNames.add(row.driverName);
      return;
    }

    if (seenDriverIds.has(match.id)) {
      return;
    }

    seenDriverIds.add(match.id);
    payload.push({
      driver_id: match.id,
      points: row.points,
      race_id: raceId
    });
  });

  if (unmatchedNames.size > 0) {
    redirectWithTab(
      "error",
      `Could not match these drivers in your database: ${Array.from(unmatchedNames).join(", ")}`
    );
  }

  if (payload.length === 0) {
    redirectWithTab("error", "No valid rows were mapped to drivers.");
  }

  const { error: upsertError } = await supabase
    .from("results")
    .upsert(payload, { onConflict: "race_id,driver_id" });

  if (upsertError) {
    redirectWithTab("error", upsertError.message);
  }

  try {
    await refreshDriverChampionshipPointsFromResults(supabase);
  } catch (refreshError) {
    const message =
      refreshError instanceof Error
        ? refreshError.message
        : "Results imported, but failed to refresh driver standings/groups.";
    redirectWithTab("error", message);
  }

  try {
    await scheduleRaceWinnerAutoCalculation(supabase, raceId);
  } catch (scheduleError) {
    const message =
      scheduleError instanceof Error
        ? scheduleError.message
        : "Results imported, but failed to schedule fantasy winner auto-calculation.";
    redirectWithTab("error", message);
  }

  revalidatePath("/admin");
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
    `Imported ${payload.length} result row(s) into ${raceName}. ${raceResultCountText} Driver standings/groups were refreshed, and fantasy winner auto-calculation is scheduled for about 15 minutes from now.${ignoredSummary}`
  );
}

export async function cleanupTestFlowDataAction(formData: FormData) {
  await requireAdmin();
  const tab = parseAdminTab(asText(formData.get("tab"))) ?? "feedback";
  const redirectWithTab = (key: "error" | "message", value: string): never =>
    adminRedirect(key, value, tab);

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
