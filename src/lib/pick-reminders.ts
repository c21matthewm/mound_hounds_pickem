import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { pickLockAtForRace } from "@/lib/race-format";
import { getPreviousRaceResultsGate } from "@/lib/pickem-results-gate";
import {
  getReminderWindow,
  type ReminderType,
  type ReminderWindow
} from "@/lib/reminder-windows";
import { loadActiveLeagueSeason } from "@/lib/seasons";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/service-role";
import { formatLeagueDateTime, LEAGUE_TIME_ZONE } from "@/lib/timezone";

type ReminderChannel = "email" | "sms";

type UpcomingRace = {
  id: number;
  pick_format: string | null;
  qualifying_start_at: string;
  race_date: string;
  race_name: string;
  round_number: number;
  season_id: number;
};

type ProfileForReminder = {
  full_name: string | null;
  id: string;
  phone_carrier: string | null;
  phone_number: string | null;
  team_name: string | null;
};

type PickUserRow = {
  user_id: string;
};

type SendResult = {
  id: string | null;
};

type PickReminderSummary = {
  emailDeliveryEnabled: boolean;
  emailFailed: number;
  emailSent: number;
  emailSkippedNoAddress: number;
  emailSkippedAlreadySent: number;
  pendingParticipants: number;
  raceId: number | null;
  raceName: string | null;
  reason:
    | "delivery_disabled"
    | "no_upcoming_race"
    | "waiting_previous_results"
    | "no_window_due"
    | "no_missing_participants"
    | "reminders_sent";
  reminderType: ReminderType | null;
  smsDeliveryEnabled: boolean;
  smsFailed: number;
  smsSent: number;
  smsSkippedAlreadySent: number;
  smsSkippedNoGatewayAddress: number;
};

const SMS_GATEWAY_DOMAIN_BY_CARRIER: Record<string, string | null> = {
  att: "txt.att.net",
  cricket: "sms.cricketwireless.net",
  googlefi: "msg.fi.google.com",
  other: null,
  tmobile: "tmomail.net",
  uscellular: "email.uscc.net",
  verizon: "vtext.com"
};

const getSiteUrl = (): string => {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (!configured) {
    return "http://localhost:3000";
  }

  return configured.endsWith("/") ? configured.slice(0, -1) : configured;
};

const normalizePhoneToTenDigits = (raw: string | null): string | null => {
  if (!raw) {
    return null;
  }

  const digitsOnly = raw.replace(/\D/g, "");

  if (digitsOnly.length === 10) {
    return digitsOnly;
  }

  if (digitsOnly.length === 11 && digitsOnly.startsWith("1")) {
    return digitsOnly.slice(1);
  }

  return null;
};

const toSmsGatewayAddress = (
  phoneNumber: string | null,
  carrier: string | null
): string | null => {
  if (!carrier) {
    return null;
  }

  const normalizedPhone = normalizePhoneToTenDigits(phoneNumber);
  if (!normalizedPhone) {
    return null;
  }

  const gatewayDomain = SMS_GATEWAY_DOMAIN_BY_CARRIER[carrier];
  if (!gatewayDomain) {
    return null;
  }

  return `${normalizedPhone}@${gatewayDomain}`;
};

const loadAuthEmailsByUserId = async (
  supabase: SupabaseClient,
  userIds: string[]
): Promise<Map<string, string>> => {
  const targetIds = new Set(userIds);
  const emailByUserId = new Map<string, string>();

  let page = 1;
  const perPage = 200;

  while (targetIds.size > 0) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
    if (error) {
      throw new Error(`Failed loading auth users for reminders: ${error.message}`);
    }

    const users = data?.users ?? [];
    if (users.length === 0) {
      break;
    }

    users.forEach((user) => {
      const userId = user.id;
      const email = user.email?.trim();
      if (!targetIds.has(userId)) {
        return;
      }

      if (email) {
        emailByUserId.set(userId, email);
      }
      targetIds.delete(userId);
    });

    if (targetIds.size === 0 || users.length < perPage) {
      break;
    }

    page += 1;
  }

  return emailByUserId;
};

const buildReminderMessage = (
  race: UpcomingRace,
  reminderWindow: ReminderWindow
): { smsText: string; subject: string; text: string } => {
  const pickLockAt = pickLockAtForRace(race);
  const pickDeadlineText = formatLeagueDateTime(pickLockAt, {
    dateStyle: "full",
    timeStyle: "short"
  });
  const siteUrl = getSiteUrl();
  const picksUrl = `${siteUrl}/picks`;

  const isFormOpenNotice = reminderWindow.key === "5d_open";
  const isFinalReminder = reminderWindow.key === "4h";
  const subject = isFormOpenNotice
    ? `[Mound Hounds Pick'em] Picks are open: ${race.race_name}`
    : isFinalReminder
      ? `[Mound Hounds Pick'em] Final reminder: ${race.race_name}`
      : `[Mound Hounds Pick'em] 2-day reminder: ${race.race_name}`;
  const text = [
    isFormOpenNotice
      ? "The pick form is open and ready for the next race."
      : isFinalReminder
        ? "Final reminder from the Mound Hounds Pick'em League."
        : "Reminder from the Mound Hounds Pick'em League.",
    "",
    `Race: ${race.race_name}`,
    `Pick deadline: ${pickDeadlineText} (${LEAGUE_TIME_ZONE})`,
    "",
    isFormOpenNotice
      ? "The form is available now for your race selections."
      : "You have not submitted picks yet for this race.",
    `Submit your picks here: ${picksUrl}`,
    "",
    isFormOpenNotice
      ? "Make your selections when you are ready. Good luck and enjoy the race weekend!"
      : "Get your lineup locked before the pick deadline. Good luck and enjoy the race weekend!"
  ].join("\n");

  const smsText = [
    isFormOpenNotice
      ? "Mound Hounds Pick'em: picks are open."
      : `Mound Hounds Pick'em reminder (${reminderWindow.label}):`,
    `${race.race_name}`,
    `Pick deadline: ${pickDeadlineText} (${LEAGUE_TIME_ZONE})`,
    `Submit picks: ${picksUrl}`
  ].join(" ");

  return { smsText, subject, text };
};

const sendWithResend = async (
  to: string,
  subject: string,
  text: string,
  idempotencyKey: string
): Promise<SendResult> => {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.RESEND_FROM_EMAIL?.trim();
  const replyTo = process.env.RESEND_REPLY_TO?.trim();

  if (!apiKey) {
    throw new Error("Missing RESEND_API_KEY for pick reminder notifications.");
  }
  if (!from) {
    throw new Error("Missing RESEND_FROM_EMAIL for pick reminder notifications.");
  }

  const payload: {
    from: string;
    reply_to?: string;
    subject: string;
    text: string;
    to: string[];
  } = {
    from,
    subject,
    text,
    to: [to]
  };

  if (replyTo) {
    payload.reply_to = replyTo;
  }

  const response = await fetch("https://api.resend.com/emails", {
    body: JSON.stringify(payload),
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey
    },
    method: "POST"
  });

  const body = (await response.json().catch(() => null)) as { id?: string; message?: string } | null;
  if (!response.ok) {
    throw new Error(
      `Resend API error (${response.status}) while sending to ${to}: ${body?.message ?? response.statusText}`
    );
  }

  return { id: body?.id ?? null };
};

const claimReminderSlot = async (
  supabase: SupabaseClient,
  raceId: number,
  userId: string,
  reminderType: ReminderType,
  channel: ReminderChannel,
  recipient: string
): Promise<number | null> => {
  const { data, error } = await supabase.rpc("claim_pick_reminder_delivery", {
    p_channel: channel,
    p_race_id: raceId,
    p_recipient: recipient,
    p_reminder_type: reminderType,
    p_user_id: userId
  });

  if (error) {
    throw new Error(`Failed claiming reminder slot (${channel}) for user ${userId}: ${error.message}`);
  }

  return typeof data === "number" ? data : null;
};

const markReminderSent = async (
  supabase: SupabaseClient,
  reminderId: number,
  deliveryId: string | null
) => {
  const { error } = await supabase
    .from("pick_reminders")
    .update({
      delivery_id: deliveryId,
      delivery_status: "sent",
      last_error: null,
      lease_expires_at: null,
      sent_at: new Date().toISOString()
    })
    .eq("id", reminderId);

  if (error) {
    throw new Error(`Failed finalizing reminder log row ${reminderId}: ${error.message}`);
  }
};

const markReminderFailed = async (
  supabase: SupabaseClient,
  reminderId: number,
  reason: string
) => {
  const { error } = await supabase
    .from("pick_reminders")
    .update({
      delivery_status: "failed",
      last_error: reason.slice(0, 1000),
      lease_expires_at: null
    })
    .eq("id", reminderId);
  if (error) {
    throw new Error(`Failed recording reminder failure ${reminderId}: ${error.message}`);
  }
};

const mapWithConcurrency = async <T, R>(
  items: T[],
  concurrency: number,
  task: (item: T) => Promise<R>
): Promise<R[]> => {
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  const worker = async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await task(items[index]);
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker())
  );
  return results;
};

export async function sendDuePickReminders(): Promise<PickReminderSummary> {
  const supabase = createServiceRoleSupabaseClient();
  const now = new Date();
  const emailDeliveryEnabled = process.env.PICK_EMAILS_ENABLED?.trim().toLowerCase() === "true";
  const smsDeliveryEnabled = process.env.REMINDER_SMS_ENABLED?.trim().toLowerCase() === "true";

  if (!emailDeliveryEnabled) {
    return {
      emailDeliveryEnabled,
      emailFailed: 0,
      emailSent: 0,
      emailSkippedAlreadySent: 0,
      emailSkippedNoAddress: 0,
      pendingParticipants: 0,
      raceId: null,
      raceName: null,
      reason: "delivery_disabled",
      reminderType: null,
      smsDeliveryEnabled,
      smsFailed: 0,
      smsSent: 0,
      smsSkippedAlreadySent: 0,
      smsSkippedNoGatewayAddress: 0
    };
  }

  const activeSeason = await loadActiveLeagueSeason(supabase);
  const { data: upcomingRaces, error: raceError } = activeSeason
    ? await supabase
        .from("races")
        .select("id,race_name,pick_format,qualifying_start_at,race_date,season_id,round_number")
        .eq("is_archived", false)
        .eq("season_id", activeSeason.id)
        .gt("race_date", now.toISOString())
        .order("round_number", { ascending: true })
        .limit(20)
    : { data: [], error: null };

  if (raceError) {
    throw new Error(`Failed loading upcoming race for reminders: ${raceError.message}`);
  }

  const upcomingRace =
    ((upcomingRaces ?? []) as UpcomingRace[])
      .filter((race) => Date.parse(pickLockAtForRace(race)) > now.getTime())
      .sort(
        (a, b) =>
          Date.parse(pickLockAtForRace(a)) - Date.parse(pickLockAtForRace(b))
      )[0] ?? null;

  if (!upcomingRace) {
    return {
      emailDeliveryEnabled,
      emailFailed: 0,
      emailSent: 0,
      emailSkippedAlreadySent: 0,
      emailSkippedNoAddress: 0,
      pendingParticipants: 0,
      raceId: null,
      raceName: null,
      reason: "no_upcoming_race",
      reminderType: null,
      smsDeliveryEnabled,
      smsFailed: 0,
      smsSent: 0,
      smsSkippedAlreadySent: 0,
      smsSkippedNoGatewayAddress: 0
    };
  }

  const previousResultsGate = await getPreviousRaceResultsGate(supabase, upcomingRace);
  if (previousResultsGate.status === "blocked") {
    return {
      emailDeliveryEnabled,
      emailFailed: 0,
      emailSent: 0,
      emailSkippedAlreadySent: 0,
      emailSkippedNoAddress: 0,
      pendingParticipants: 0,
      raceId: upcomingRace.id,
      raceName: upcomingRace.race_name,
      reason: "waiting_previous_results",
      reminderType: null,
      smsDeliveryEnabled,
      smsFailed: 0,
      smsSent: 0,
      smsSkippedAlreadySent: 0,
      smsSkippedNoGatewayAddress: 0
    };
  }

  const msUntilDeadline = Date.parse(pickLockAtForRace(upcomingRace)) - now.getTime();
  const reminderWindow = getReminderWindow(msUntilDeadline);
  if (!reminderWindow) {
    return {
      emailDeliveryEnabled,
      emailFailed: 0,
      emailSent: 0,
      emailSkippedAlreadySent: 0,
      emailSkippedNoAddress: 0,
      pendingParticipants: 0,
      raceId: upcomingRace.id,
      raceName: upcomingRace.race_name,
      reason: "no_window_due",
      reminderType: null,
      smsDeliveryEnabled,
      smsFailed: 0,
      smsSent: 0,
      smsSkippedAlreadySent: 0,
      smsSkippedNoGatewayAddress: 0
    };
  }

  const [registrationResponse, { data: pickRows, error: picksError }] =
    await Promise.all([
      supabase
        .from("season_participants")
        .select("profile_id")
        .eq("season_id", upcomingRace.season_id)
        .eq("status", "registered"),
      supabase.from("picks").select("user_id").eq("race_id", upcomingRace.id)
    ]);

  if (registrationResponse.error) {
    throw new Error(
      `Failed loading season registrations for reminders: ${registrationResponse.error.message}`
    );
  }
  if (picksError) {
    throw new Error(`Failed loading picks for reminders: ${picksError.message}`);
  }

  const registeredProfileIds = ((registrationResponse.data ?? []) as Array<{ profile_id: string }>).map(
    (row) => row.profile_id
  );
  const { data: participants, error: participantsError } = registeredProfileIds.length
    ? await supabase
        .from("profiles")
        .select("id,full_name,team_name,phone_number,phone_carrier")
        .in("id", registeredProfileIds)
        .eq("is_active", true)
    : { data: [], error: null };

  if (participantsError) {
    throw new Error(`Failed loading participant profiles for reminders: ${participantsError.message}`);
  }

  const pickedUserIds = new Set(((pickRows ?? []) as PickUserRow[]).map((row) => row.user_id));
  const participantsMissingPicks = ((participants ?? []) as ProfileForReminder[]).filter(
    (participant) => !pickedUserIds.has(participant.id)
  );

  if (participantsMissingPicks.length === 0) {
    return {
      emailDeliveryEnabled,
      emailFailed: 0,
      emailSent: 0,
      emailSkippedAlreadySent: 0,
      emailSkippedNoAddress: 0,
      pendingParticipants: 0,
      raceId: upcomingRace.id,
      raceName: upcomingRace.race_name,
      reason: "no_missing_participants",
      reminderType: reminderWindow.key,
      smsDeliveryEnabled,
      smsFailed: 0,
      smsSent: 0,
      smsSkippedAlreadySent: 0,
      smsSkippedNoGatewayAddress: 0
    };
  }

  const emailByUserId = await loadAuthEmailsByUserId(
    supabase,
    participantsMissingPicks.map((participant) => participant.id)
  );
  const message = buildReminderMessage(upcomingRace, reminderWindow);

  const deliveryResults = await mapWithConcurrency(
    participantsMissingPicks,
    5,
    async (participant) => {
      const counts = {
        emailFailed: 0,
        emailSent: 0,
        emailSkippedAlreadySent: 0,
        emailSkippedNoAddress: 0,
        smsFailed: 0,
        smsSent: 0,
        smsSkippedAlreadySent: 0,
        smsSkippedNoGatewayAddress: 0
      };
      const recipientEmail = emailByUserId.get(participant.id) ?? null;

      if (!recipientEmail) {
        counts.emailSkippedNoAddress = 1;
      } else {
        let reminderId: number | null = null;
        try {
          reminderId = await claimReminderSlot(
            supabase,
            upcomingRace.id,
            participant.id,
            reminderWindow.key,
            "email",
            recipientEmail
          );

          if (!reminderId) {
            counts.emailSkippedAlreadySent = 1;
          } else {
            const sendResult = await sendWithResend(
              recipientEmail,
              message.subject,
              message.text,
              `pick-${upcomingRace.id}-${participant.id}-${reminderWindow.key}-email`
            );
            await markReminderSent(supabase, reminderId, sendResult.id);
            counts.emailSent = 1;
          }
        } catch (error) {
          const reason =
            error instanceof Error ? error.message : "Unknown email reminder send failure.";
          counts.emailFailed = 1;
          console.error(`[pick-reminders] Email failed for profile ${participant.id}: ${reason}`);
          if (reminderId) {
            await markReminderFailed(supabase, reminderId, reason).catch((markError) => {
              console.error("[pick-reminders] Failed recording email error:", markError);
            });
          }
        }
      }

      if (!smsDeliveryEnabled) {
        return counts;
      }

      const smsAddress = toSmsGatewayAddress(participant.phone_number, participant.phone_carrier);
      if (!smsAddress) {
        counts.smsSkippedNoGatewayAddress = 1;
        return counts;
      }

      let smsReminderId: number | null = null;
      try {
        smsReminderId = await claimReminderSlot(
          supabase,
          upcomingRace.id,
          participant.id,
          reminderWindow.key,
          "sms",
          smsAddress
        );

        if (!smsReminderId) {
          counts.smsSkippedAlreadySent = 1;
        } else {
          const sendResult = await sendWithResend(
            smsAddress,
            message.subject,
            message.smsText,
            `pick-${upcomingRace.id}-${participant.id}-${reminderWindow.key}-sms`
          );
          await markReminderSent(supabase, smsReminderId, sendResult.id);
          counts.smsSent = 1;
        }
      } catch (error) {
        const reason = error instanceof Error ? error.message : "Unknown SMS reminder send failure.";
        counts.smsFailed = 1;
        console.error(`[pick-reminders] SMS failed for profile ${participant.id}: ${reason}`);
        if (smsReminderId) {
          await markReminderFailed(supabase, smsReminderId, reason).catch((markError) => {
            console.error("[pick-reminders] Failed recording SMS error:", markError);
          });
        }
      }

      return counts;
    }
  );

  const totals = deliveryResults.reduce(
    (sum, row) => ({
      emailFailed: sum.emailFailed + row.emailFailed,
      emailSent: sum.emailSent + row.emailSent,
      emailSkippedAlreadySent: sum.emailSkippedAlreadySent + row.emailSkippedAlreadySent,
      emailSkippedNoAddress: sum.emailSkippedNoAddress + row.emailSkippedNoAddress,
      smsFailed: sum.smsFailed + row.smsFailed,
      smsSent: sum.smsSent + row.smsSent,
      smsSkippedAlreadySent: sum.smsSkippedAlreadySent + row.smsSkippedAlreadySent,
      smsSkippedNoGatewayAddress:
        sum.smsSkippedNoGatewayAddress + row.smsSkippedNoGatewayAddress
    }),
    {
      emailFailed: 0,
      emailSent: 0,
      emailSkippedAlreadySent: 0,
      emailSkippedNoAddress: 0,
      smsFailed: 0,
      smsSent: 0,
      smsSkippedAlreadySent: 0,
      smsSkippedNoGatewayAddress: 0
    }
  );

  return {
    emailDeliveryEnabled,
    ...totals,
    pendingParticipants: participantsMissingPicks.length,
    raceId: upcomingRace.id,
    raceName: upcomingRace.race_name,
    reason: "reminders_sent",
    reminderType: reminderWindow.key,
    smsDeliveryEnabled
  };
}
