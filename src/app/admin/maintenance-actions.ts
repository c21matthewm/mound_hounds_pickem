"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin";
import { recordAdminAudit } from "@/lib/admin-audit";
import {
  pickLockAtForRace,
  type RacePickFormat
} from "@/lib/race-format";
import { getReminderWindow } from "@/lib/reminder-windows";
import { REMINDER_MAX_ATTEMPTS } from "@/lib/reminder-queue";
import { invalidateScoringCache } from "@/lib/scoring-cache";
import { SEASON_RECOVERY_MIGRATION_FILE } from "@/lib/season-recovery";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/service-role";
import { withMigrationHint } from "@/lib/supabase/migration-errors";

type AdminTab =
  | "drivers"
  | "participants"
  | "races"
  | "results"
  | "feedback"
  | "health"
  | "recovery";

const TEST_FLOW_PREFIX = "[TEST FLOW ";
const RESULT_PUBLICATION_MIGRATION_FILE =
  "supabase/migrations/20260709_harden_roles_and_result_publication.sql";

const asText = (value: FormDataEntryValue | null): string =>
  typeof value === "string" ? value.trim() : "";

const parsePositiveInteger = (value: string): number | null => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

const parseAdminTab = (value: string): AdminTab | null => {
  const tabs: AdminTab[] = [
    "drivers",
    "participants",
    "races",
    "results",
    "feedback",
    "health",
    "recovery"
  ];
  return tabs.includes(value as AdminTab) ? (value as AdminTab) : null;
};

const adminRedirect = (
  key: "error" | "message",
  value: string,
  tab: AdminTab
): never => {
  const params = new URLSearchParams({ [key]: value, tab });
  redirect(`/admin?${params.toString()}`);
};

const withResultPublicationMigrationHint = (message: string): string =>
  /function .* does not exist|schema cache/i.test(message)
    ? withMigrationHint(message, RESULT_PUBLICATION_MIGRATION_FILE)
    : message;

export async function retryFailedPickRemindersAction(formData: FormData) {
  const { supabase } = await requireAdmin();
  const raceId = parsePositiveInteger(asText(formData.get("race_id")));
  const reminderType = asText(formData.get("reminder_type"));

  if (!raceId || !["5d_open", "2d", "4h"].includes(reminderType)) {
    adminRedirect("error", "Select a valid reminder queue before retrying.", "health");
  }

  const { data: race, error: raceError } = await supabase
    .from("races")
    .select(
      "id,race_name,is_archived,season_id,pick_format,qualifying_start_at,race_date,league_seasons!inner(status)"
    )
    .eq("id", raceId)
    .maybeSingle<{
      id: number;
      is_archived: boolean;
      league_seasons: { status: string } | Array<{ status: string }>;
      pick_format: RacePickFormat;
      qualifying_start_at: string;
      race_date: string;
      race_name: string;
      season_id: number;
    }>();
  if (raceError || !race) {
    adminRedirect(
      "error",
      raceError?.message ?? "The selected reminder race was not found.",
      "health"
    );
  }

  const selectedRace = race!;
  const seasonStatus = Array.isArray(selectedRace.league_seasons)
    ? selectedRace.league_seasons[0]?.status
    : selectedRace.league_seasons.status;
  if (selectedRace.is_archived || seasonStatus !== "active") {
    adminRedirect(
      "error",
      "Failed reminders can only be retried for an active-season race.",
      "health"
    );
  }

  const activeReminderWindow = getReminderWindow(
    Date.parse(pickLockAtForRace(selectedRace)) - Date.now()
  );
  if (activeReminderWindow?.key !== reminderType) {
    adminRedirect(
      "error",
      "This reminder window is no longer active. Refresh Race Week before retrying.",
      "health"
    );
  }

  const serviceRoleSupabase = createServiceRoleSupabaseClient();
  const { data: resetRows, error: resetError } = await serviceRoleSupabase
    .from("pick_reminders")
    .update({
      attempt_count: 0,
      delivery_status: "pending",
      last_attempt_at: null,
      last_error: null,
      lease_expires_at: "1970-01-01T00:00:00.000Z"
    })
    .eq("race_id", raceId)
    .eq("reminder_type", reminderType)
    .eq("delivery_status", "failed")
    .gte("attempt_count", REMINDER_MAX_ATTEMPTS)
    .select("id");
  if (resetError) {
    adminRedirect("error", resetError.message, "health");
  }

  const resetCount = resetRows?.length ?? 0;
  await recordAdminAudit(supabase, {
    action: "retry_failed_reminders",
    afterState: {
      reminder_type: reminderType,
      reset_count: resetCount
    },
    entityId: String(raceId),
    entityType: "race",
    summary: `Reset ${resetCount} terminal ${reminderType} reminder deliver${
      resetCount === 1 ? "y" : "ies"
    } for ${selectedRace.race_name}.`
  });

  revalidatePath("/admin");
  adminRedirect(
    "message",
    resetCount > 0
      ? `${resetCount} failed reminder deliver${
          resetCount === 1 ? "y is" : "ies are"
        } queued for the next cron run.`
      : "No permanently failed deliveries were waiting for this race and reminder window.",
    "health"
  );
}

export async function updateFeedbackStatusAction(formData: FormData) {
  const { supabase } = await requireAdmin();
  const feedbackId = parsePositiveInteger(asText(formData.get("feedback_id")));
  const status = asText(formData.get("status"));
  const feedbackPage = parsePositiveInteger(asText(formData.get("feedback_page"))) ?? 1;
  const requestedFilter = asText(formData.get("feedback_status"));
  const feedbackStatus = ["all", "new", "in_review", "resolved"].includes(
    requestedFilter
  )
    ? requestedFilter
    : "all";
  const redirectWithFeedbackState = (
    key: "error" | "message",
    value: string
  ): never => {
    const params = new URLSearchParams({
      [key]: value,
      feedback_page: String(feedbackPage),
      feedback_status: feedbackStatus,
      tab: "feedback"
    });
    redirect(`/admin?${params.toString()}`);
  };

  if (!feedbackId || !["new", "in_review", "resolved"].includes(status)) {
    redirectWithFeedbackState("error", "Select a valid feedback status.");
  }

  const { data: existing, error: existingError } = await supabase
    .from("feedback_items")
    .select("id,status")
    .eq("id", feedbackId)
    .maybeSingle<{ id: number; status: string }>();
  if (existingError || !existing) {
    redirectWithFeedbackState(
      "error",
      existingError?.message ?? "Feedback submission was not found."
    );
  }

  const { error } = await supabase
    .from("feedback_items")
    .update({
      resolved_at: status === "resolved" ? new Date().toISOString() : null,
      status
    })
    .eq("id", feedbackId);
  if (error) {
    redirectWithFeedbackState(
      "error",
      withMigrationHint(error.message, SEASON_RECOVERY_MIGRATION_FILE)
    );
  }

  await recordAdminAudit(supabase, {
    action: "update_feedback_status",
    afterState: { status },
    beforeState: { status: existing!.status },
    entityId: String(feedbackId),
    entityType: "feedback",
    summary: `Marked feedback #${feedbackId} as ${status.replace("_", " ")}.`
  });

  revalidatePath("/admin");
  redirectWithFeedbackState("message", "Feedback status updated.");
}

export async function cleanupTestFlowDataAction(formData: FormData) {
  await requireAdmin();
  const tab = parseAdminTab(asText(formData.get("tab"))) ?? "feedback";
  const redirectWithTab = (key: "error" | "message", value: string): never => {
    invalidateScoringCache();
    return adminRedirect(key, value, tab);
  };

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

  const { data: deletedFeedbackRows, error: deleteFeedbackError } = await serviceRoleSupabase
    .from("feedback_items")
    .delete()
    .ilike("details", `${TEST_FLOW_PREFIX}%`)
    .select("id");
  if (deleteFeedbackError) {
    redirectWithTab("error", deleteFeedbackError.message);
  }
  const deletedFeedbackCount = (deletedFeedbackRows ?? []).length;

  let deletedAuthUserCount = 0;
  const failedAuthDeletes: string[] = [];
  for (const profileRow of profileRows) {
    const { error: deleteUserError } = await serviceRoleSupabase.auth.admin.deleteUser(profileRow.id);
    if (deleteUserError) {
      failedAuthDeletes.push(`${profileRow.team_name}: ${deleteUserError.message}`);
    } else {
      deletedAuthUserCount += 1;
    }
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
