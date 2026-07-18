import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { pickLockAtForRace } from "@/lib/race-format";
import { getPreviousRaceResultsGate } from "@/lib/pickem-results-gate";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/service-role";
import { isMissingColumnError } from "@/lib/supabase/schema-compat";
import { formatLeagueDateTime, LEAGUE_TIME_ZONE } from "@/lib/timezone";

type ReminderType = "5d_open" | "2d" | "4h";
type ReminderChannel = "email" | "sms";

type ReminderWindow = {
  key: ReminderType;
  label: string;
  maxMsUntilDeadline: number;
  minExclusiveMsUntilDeadline: number;
};

type UpcomingRace = {
  id: number;
  pick_format: string | null;
  qualifying_start_at: string;
  race_date: string;
  race_name: string;
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

type ReminderSlotRow = {
  id: number;
};

type SendResult = {
  id: string | null;
};

type PickReminderSummary = {
  emailDeliveryEnabled: boolean;
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
  smsSent: number;
  smsSkippedAlreadySent: number;
  smsSkippedNoGatewayAddress: number;
};

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

const REMINDER_WINDOWS: ReminderWindow[] = [
  { key: "4h", label: "4 hours", maxMsUntilDeadline: 4 * HOUR_MS, minExclusiveMsUntilDeadline: 0 },
  { key: "2d", label: "2 days", maxMsUntilDeadline: 2 * DAY_MS, minExclusiveMsUntilDeadline: 4 * HOUR_MS },
  { key: "5d_open", label: "5 days", maxMsUntilDeadline: 5 * DAY_MS, minExclusiveMsUntilDeadline: 2 * DAY_MS }
];

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

const getReminderWindow = (msUntilDeadline: number): ReminderWindow | null => {
  for (const window of REMINDER_WINDOWS) {
    if (
      msUntilDeadline <= window.maxMsUntilDeadline &&
      msUntilDeadline > window.minExclusiveMsUntilDeadline
    ) {
      return window;
    }
  }

  return null;
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

const sendWithResend = async (to: string, subject: string, text: string): Promise<SendResult> => {
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
      "Content-Type": "application/json"
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

const reserveReminderSlot = async (
  supabase: SupabaseClient,
  raceId: number,
  userId: string,
  reminderType: ReminderType,
  channel: ReminderChannel,
  recipient: string
): Promise<number | null> => {
  const { data, error } = await supabase
    .from("pick_reminders")
    .insert({
      channel,
      delivery_status: "pending",
      race_id: raceId,
      recipient,
      reminder_type: reminderType,
      user_id: userId
    })
    .select("id")
    .maybeSingle<ReminderSlotRow>();

  if (!error) {
    return data?.id ?? null;
  }

  // Unique violation means this reminder was already queued/sent.
  if (error.code === "23505") {
    return null;
  }

  throw new Error(`Failed reserving reminder slot (${channel}) for user ${userId}: ${error.message}`);
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
      sent_at: new Date().toISOString()
    })
    .eq("id", reminderId);

  if (error) {
    throw new Error(`Failed finalizing reminder log row ${reminderId}: ${error.message}`);
  }
};

const releaseReminderSlot = async (supabase: SupabaseClient, reminderId: number) => {
  const { error } = await supabase.from("pick_reminders").delete().eq("id", reminderId);
  if (error) {
    throw new Error(`Failed releasing reminder log row ${reminderId}: ${error.message}`);
  }
};

export async function sendDuePickReminders(): Promise<PickReminderSummary> {
  const supabase = createServiceRoleSupabaseClient();
  const now = new Date();
  const emailDeliveryEnabled = process.env.PICK_EMAILS_ENABLED?.trim().toLowerCase() === "true";
  const smsDeliveryEnabled = process.env.REMINDER_SMS_ENABLED?.trim().toLowerCase() === "true";

  if (!emailDeliveryEnabled) {
    return {
      emailDeliveryEnabled,
      emailSent: 0,
      emailSkippedAlreadySent: 0,
      emailSkippedNoAddress: 0,
      pendingParticipants: 0,
      raceId: null,
      raceName: null,
      reason: "delivery_disabled",
      reminderType: null,
      smsDeliveryEnabled,
      smsSent: 0,
      smsSkippedAlreadySent: 0,
      smsSkippedNoGatewayAddress: 0
    };
  }

  let { data: upcomingRaces, error: raceError } = await supabase
    .from("races")
    .select("id,race_name,pick_format,qualifying_start_at,race_date")
    .eq("is_archived", false)
    .gt("race_date", now.toISOString())
    .order("race_date", { ascending: true })
    .limit(20);

  if (raceError && isMissingColumnError(raceError, "pick_format")) {
    const legacyRaceResponse = await supabase
      .from("races")
      .select("id,race_name,qualifying_start_at,race_date")
      .eq("is_archived", false)
      .gt("race_date", now.toISOString())
      .order("race_date", { ascending: true })
      .limit(20);

    upcomingRaces = (legacyRaceResponse.data ?? []).map((race) => ({
      ...race,
      pick_format: "standard"
    }));
    raceError = legacyRaceResponse.error;
  }

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
      emailSent: 0,
      emailSkippedAlreadySent: 0,
      emailSkippedNoAddress: 0,
      pendingParticipants: 0,
      raceId: null,
      raceName: null,
      reason: "no_upcoming_race",
      reminderType: null,
      smsDeliveryEnabled,
      smsSent: 0,
      smsSkippedAlreadySent: 0,
      smsSkippedNoGatewayAddress: 0
    };
  }

  const previousResultsGate = await getPreviousRaceResultsGate(supabase, upcomingRace);
  if (previousResultsGate.status === "blocked") {
    return {
      emailDeliveryEnabled,
      emailSent: 0,
      emailSkippedAlreadySent: 0,
      emailSkippedNoAddress: 0,
      pendingParticipants: 0,
      raceId: upcomingRace.id,
      raceName: upcomingRace.race_name,
      reason: "waiting_previous_results",
      reminderType: null,
      smsDeliveryEnabled,
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
      emailSent: 0,
      emailSkippedAlreadySent: 0,
      emailSkippedNoAddress: 0,
      pendingParticipants: 0,
      raceId: upcomingRace.id,
      raceName: upcomingRace.race_name,
      reason: "no_window_due",
      reminderType: null,
      smsDeliveryEnabled,
      smsSent: 0,
      smsSkippedAlreadySent: 0,
      smsSkippedNoGatewayAddress: 0
    };
  }

  const [{ data: participants, error: participantsError }, { data: pickRows, error: picksError }] =
    await Promise.all([
      supabase
        .from("profiles")
        .select("id,full_name,team_name,phone_number,phone_carrier")
        .in("role", ["participant", "admin"]),
      supabase.from("picks").select("user_id").eq("race_id", upcomingRace.id)
    ]);

  if (participantsError) {
    throw new Error(`Failed loading participant profiles for reminders: ${participantsError.message}`);
  }
  if (picksError) {
    throw new Error(`Failed loading picks for reminders: ${picksError.message}`);
  }

  const pickedUserIds = new Set(((pickRows ?? []) as PickUserRow[]).map((row) => row.user_id));
  const participantsMissingPicks = ((participants ?? []) as ProfileForReminder[]).filter(
    (participant) => !pickedUserIds.has(participant.id)
  );

  if (participantsMissingPicks.length === 0) {
    return {
      emailDeliveryEnabled,
      emailSent: 0,
      emailSkippedAlreadySent: 0,
      emailSkippedNoAddress: 0,
      pendingParticipants: 0,
      raceId: upcomingRace.id,
      raceName: upcomingRace.race_name,
      reason: "no_missing_participants",
      reminderType: reminderWindow.key,
      smsDeliveryEnabled,
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

  let emailSent = 0;
  let smsSent = 0;
  let emailSkippedAlreadySent = 0;
  let smsSkippedAlreadySent = 0;
  let emailSkippedNoAddress = 0;
  let smsSkippedNoGatewayAddress = 0;

  for (const participant of participantsMissingPicks) {
    const recipientEmail = emailByUserId.get(participant.id) ?? null;
    if (!recipientEmail) {
      emailSkippedNoAddress += 1;
    } else {
      const reminderId = await reserveReminderSlot(
        supabase,
        upcomingRace.id,
        participant.id,
        reminderWindow.key,
        "email",
        recipientEmail
      );

      if (!reminderId) {
        emailSkippedAlreadySent += 1;
      } else {
        try {
          const sendResult = await sendWithResend(recipientEmail, message.subject, message.text);
          await markReminderSent(supabase, reminderId, sendResult.id);
          emailSent += 1;
        } catch (error) {
          await releaseReminderSlot(supabase, reminderId);
          const reason =
            error instanceof Error ? error.message : "Unknown email reminder send failure.";
          throw new Error(reason);
        }
      }
    }

    if (!smsDeliveryEnabled) {
      continue;
    }

    const smsAddress = toSmsGatewayAddress(participant.phone_number, participant.phone_carrier);
    if (!smsAddress) {
      smsSkippedNoGatewayAddress += 1;
      continue;
    }

    const smsReminderId = await reserveReminderSlot(
      supabase,
      upcomingRace.id,
      participant.id,
      reminderWindow.key,
      "sms",
      smsAddress
    );

    if (!smsReminderId) {
      smsSkippedAlreadySent += 1;
      continue;
    }

    try {
      const sendResult = await sendWithResend(smsAddress, message.subject, message.smsText);
      await markReminderSent(supabase, smsReminderId, sendResult.id);
      smsSent += 1;
    } catch (error) {
      await releaseReminderSlot(supabase, smsReminderId);
      const reason = error instanceof Error ? error.message : "Unknown SMS reminder send failure.";
      throw new Error(reason);
    }
  }

  return {
    emailDeliveryEnabled,
    emailSent,
    emailSkippedAlreadySent,
    emailSkippedNoAddress,
    pendingParticipants: participantsMissingPicks.length,
    raceId: upcomingRace.id,
    raceName: upcomingRace.race_name,
    reason: "reminders_sent",
    reminderType: reminderWindow.key,
    smsDeliveryEnabled,
    smsSent,
    smsSkippedAlreadySent,
    smsSkippedNoGatewayAddress
  };
}
