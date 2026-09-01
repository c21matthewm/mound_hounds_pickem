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
import { errorReference, reportAppError } from "@/lib/app-error-reporter";
import { adminSafeErrorMessage } from "@/lib/app-error-safety";
import { SEASON_RECOVERY_MIGRATION_FILE } from "@/lib/season-recovery";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/service-role";
import { withMigrationHint } from "@/lib/supabase/migration-errors";
import {
  adminRedirect,
  asText,
  parseAdminTab,
  parsePositiveInteger,
  withResultPublicationMigrationHint
} from "@/app/admin/action-runtime";

const TEST_FLOW_PREFIX = "[TEST FLOW ";

export async function resolveAppErrorAction(formData: FormData) {
  const eventId = parsePositiveInteger(asText(formData.get("event_id")));
  if (!eventId) {
    return adminRedirect("error", "Select a valid application error.", "health");
  }

  const { supabase, user } = await requireAdmin();
  const { error } = await supabase.rpc("resolve_app_error_event", {
    p_event_id: eventId
  });
  if (error) {
    const reported = await reportAppError({
      actorProfileId: user.id,
      code: "resolve-error-event-failed",
      context: { entityId: eventId, entityType: "app_error_event", operation: "resolve" },
      error,
      route: "/admin?tab=health",
      subsystem: "admin"
    });
    adminRedirect(
      "error",
      `${adminSafeErrorMessage(error, "The application error could not be resolved.")}${errorReference(reported)}`,
      "health"
    );
  }

  await recordAdminAudit(supabase, {
    action: "resolve_application_error",
    afterState: { status: "resolved" },
    entityId: String(eventId),
    entityType: "app_error_event",
    summary: `Resolved application error #${eventId}.`
  });

  revalidatePath("/admin");
  adminRedirect("message", "Application error marked resolved.", "health");
}

export async function retryFailedPickRemindersAction(formData: FormData) {
  const { supabase, user } = await requireAdmin();
  const raceId = parsePositiveInteger(asText(formData.get("race_id")));
  const reminderType = asText(formData.get("reminder_type"));

  if (!raceId || !["2d", "4h"].includes(reminderType)) {
    return adminRedirect("error", "Select a valid reminder queue before retrying.", "health");
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
    if (raceError) {
      const reported = await reportAppError({
        actorProfileId: user.id,
        code: "load-reminder-retry-race-failed",
        context: { entityId: raceId, entityType: "race", operation: "retry_reminders" },
        error: raceError,
        route: "/admin?tab=health",
        subsystem: "reminders"
      });
      adminRedirect(
        "error",
        `The selected reminder race could not be loaded.${errorReference(reported)}`,
        "health"
      );
    }
    adminRedirect(
      "error",
      "The selected reminder race was not found.",
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
    const reported = await reportAppError({
      actorProfileId: user.id,
      code: "reset-reminder-retries-failed",
      context: { entityId: raceId, entityType: "race", operation: "retry_reminders" },
      error: resetError,
      route: "/admin?tab=health",
      subsystem: "reminders"
    });
    adminRedirect(
      "error",
      `The failed reminder queue could not be reset.${errorReference(reported)}`,
      "health"
    );
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
  const { supabase, user } = await requireAdmin();
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
    return redirectWithFeedbackState("error", "Select a valid feedback status.");
  }

  const { data: existing, error: existingError } = await supabase
    .from("feedback_items")
    .select("id,status")
    .eq("id", feedbackId)
    .maybeSingle<{ id: number; status: string }>();
  if (existingError) {
    const reported = await reportAppError({
      actorProfileId: user.id,
      code: "load-feedback-for-update-failed",
      context: { entityId: feedbackId, entityType: "feedback", operation: "update_status" },
      error: existingError,
      route: "/admin?tab=feedback",
      subsystem: "admin"
    });
    redirectWithFeedbackState(
      "error",
      `The feedback submission could not be loaded.${errorReference(reported)}`
    );
  }
  if (!existing) {
    redirectWithFeedbackState("error", "Feedback submission was not found.");
  }

  const { error } = await supabase
    .from("feedback_items")
    .update({
      resolved_at: status === "resolved" ? new Date().toISOString() : null,
      status
    })
    .eq("id", feedbackId);
  if (error) {
    const reported = await reportAppError({
      actorProfileId: user.id,
      code: "update-feedback-status-failed",
      context: { entityId: feedbackId, entityType: "feedback", operation: "update_status" },
      error: withMigrationHint(error.message, SEASON_RECOVERY_MIGRATION_FILE),
      route: "/admin?tab=feedback",
      subsystem: "admin"
    });
    redirectWithFeedbackState(
      "error",
      `The feedback status could not be updated.${errorReference(reported)}`
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
  const { user } = await requireAdmin();
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
    const reported = await reportAppError({
      actorProfileId: user.id,
      code: "load-test-races-failed",
      context: { entityType: "test_flow", operation: "cleanup" },
      error: testRacesResponse.error,
      route: "/admin?tab=health",
      subsystem: "maintenance"
    });
    redirectWithTab("error", `Test races could not be loaded.${errorReference(reported)}`);
  }
  if (testProfilesResponse.error) {
    const reported = await reportAppError({
      actorProfileId: user.id,
      code: "load-test-profiles-failed",
      context: { entityType: "test_flow", operation: "cleanup" },
      error: testProfilesResponse.error,
      route: "/admin?tab=health",
      subsystem: "maintenance"
    });
    redirectWithTab("error", `Test profiles could not be loaded.${errorReference(reported)}`);
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
      const reported = await reportAppError({
        actorProfileId: user.id,
        code: "delete-test-races-failed",
        context: { entityType: "test_flow", operation: "cleanup" },
        error: deleteRacesError,
        route: "/admin?tab=health",
        subsystem: "maintenance"
      });
      redirectWithTab("error", `Test races could not be deleted.${errorReference(reported)}`);
    }
    deletedRaceCount = (deletedRaces ?? []).length;
  }

  const { data: deletedFeedbackRows, error: deleteFeedbackError } = await serviceRoleSupabase
    .from("feedback_items")
    .delete()
    .ilike("details", `${TEST_FLOW_PREFIX}%`)
    .select("id");
  if (deleteFeedbackError) {
    const reported = await reportAppError({
      actorProfileId: user.id,
      code: "delete-test-feedback-failed",
      context: { entityType: "test_flow", operation: "cleanup" },
      error: deleteFeedbackError,
      route: "/admin?tab=health",
      subsystem: "maintenance"
    });
    redirectWithTab("error", `Test feedback could not be deleted.${errorReference(reported)}`);
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
    const reported = await reportAppError({
      actorProfileId: user.id,
      code: "refresh-after-test-cleanup-failed",
      context: { entityType: "test_flow", operation: "cleanup" },
      error: withResultPublicationMigrationHint(refreshDriverError.message),
      route: "/admin?tab=health",
      subsystem: "maintenance"
    });
    redirectWithTab(
      "error",
      `Test artifacts were deleted, but driver standings could not be refreshed.${errorReference(reported)}`
    );
  }

  revalidatePath("/admin");
  revalidatePath("/leaderboard");
  revalidatePath("/picks");
  revalidatePath("/feedback");
  revalidatePath("/dashboard");

  if (failedAuthDeletes.length > 0) {
    const reported = await reportAppError({
      actorProfileId: user.id,
      code: "delete-test-users-failed",
      context: { entityType: "test_flow", operation: "cleanup" },
      error: failedAuthDeletes.join(" | "),
      route: "/admin?tab=health",
      subsystem: "maintenance"
    });
    redirectWithTab(
      "error",
      `Cleanup partly completed. Deleted ${deletedRaceCount} race(s), ${deletedFeedbackCount} feedback row(s), ${deletedAuthUserCount} auth user(s). Some test users could not be deleted.${errorReference(reported)}`
    );
  }

  redirectWithTab(
    "message",
    `Cleanup completed. Deleted ${deletedRaceCount} race(s), ${deletedFeedbackCount} feedback row(s), and ${deletedAuthUserCount} test auth user(s).`
  );
}
