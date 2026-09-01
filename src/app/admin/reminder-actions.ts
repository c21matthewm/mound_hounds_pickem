"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin";
import { recordAdminAudit } from "@/lib/admin-audit";
import { errorReference, reportAppError } from "@/lib/app-error-reporter";
import {
  buildPickReminderMessage,
  type PickReminderRace
} from "@/lib/pick-reminder-message";
import { racesInPickWindow } from "@/lib/pick-windows";
import { getReminderWindowByType, type ReminderType } from "@/lib/reminder-windows";
import { sendResendEmail } from "@/lib/resend-email";
import { canonicalSiteOrigin } from "@/lib/site-url";
import {
  adminMutationRedirect,
  asText,
  parsePositiveInteger
} from "@/app/admin/action-runtime";

const isReminderType = (value: string): value is ReminderType =>
  value === "2d" || value === "4h";

export async function sendPickReminderTestAction(formData: FormData) {
  const { profile, supabase, user } = await requireAdmin();
  const raceId = parsePositiveInteger(asText(formData.get("race_id")));
  const reminderTypeInput = asText(formData.get("reminder_type"));

  if (!raceId || !isReminderType(reminderTypeInput)) {
    return adminMutationRedirect(
      "error",
      "Select a valid race and reminder type for the test email.",
      "health"
    );
  }
  if (!user.email) {
    adminMutationRedirect(
      "error",
      "Your administrator account does not have an email address.",
      "health"
    );
  }

  const { data: race, error: raceError } = await supabase
    .from("races")
    .select(
      "id,race_name,pick_format,pick_window_key,qualifying_start_at,race_date,season_id,round_number,is_archived"
    )
    .eq("id", raceId)
    .maybeSingle<PickReminderRace & { is_archived: boolean }>();

  if (raceError || !race || race.is_archived) {
    adminMutationRedirect(
      "error",
      raceError
        ? "The reminder test race could not be loaded."
        : "Select an active race for the reminder test.",
      "health"
    );
  }
  const reminderRace = race as PickReminderRace & { is_archived: boolean };
  const reminderType = reminderTypeInput as ReminderType;
  const recipientEmail = user.email as string;

  const { data: raceRows, error: racesError } = await supabase
    .from("races")
    .select(
      "id,race_name,pick_format,pick_window_key,qualifying_start_at,race_date,season_id,round_number"
    )
    .eq("season_id", reminderRace.season_id)
    .eq("pick_window_key", reminderRace.pick_window_key)
    .eq("is_archived", false)
    .order("round_number", { ascending: true })
    .returns<PickReminderRace[]>();

  if (racesError) {
    adminMutationRedirect(
      "error",
      "The reminder test pick window could not be loaded.",
      "health"
    );
  }

  const races = racesInPickWindow(raceRows ?? [], reminderRace);
  if (races.length === 0) {
    adminMutationRedirect("error", "No race is available for the test email.", "health");
  }

  try {
    const message = buildPickReminderMessage({
      missingRaces: races,
      races,
      recipientName: profile.full_name,
      reminderWindow: getReminderWindowByType(reminderType),
      siteUrl: canonicalSiteOrigin(),
      testMode: true
    });
    const delivery = await sendResendEmail({
      html: message.html,
      idempotencyKey: `reminder-test-${user.id}-${crypto.randomUUID()}`,
      subject: message.subject,
      text: message.text,
      to: recipientEmail
    });

    await recordAdminAudit(supabase, {
      action: "send_reminder_test",
      afterState: {
        delivery_id: delivery.id,
        race_id: reminderRace.id,
        reminder_type: reminderType
      },
      entityId: String(reminderRace.id),
      entityType: "race",
      summary: `Sent a ${reminderType} reminder test to the signed-in administrator.`
    });
  } catch (error) {
    const reported = await reportAppError({
      actorProfileId: user.id,
      code: "send-reminder-test-failed",
      context: {
        entityId: reminderRace.id,
        entityType: "race",
        operation: "send_reminder_test"
      },
      error,
      route: "/admin?tab=health",
      subsystem: "reminders"
    });
    adminMutationRedirect(
      "error",
      `The test email could not be sent.${errorReference(reported)}`,
      "health"
    );
  }

  revalidatePath("/admin");
  adminMutationRedirect(
    "message",
    `Test email sent to ${recipientEmail}. Participant reminder history was not changed.`,
    "health"
  );
}
