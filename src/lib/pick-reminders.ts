import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/service-role";
import { formatLeagueDateTime, LEAGUE_TIME_ZONE } from "@/lib/timezone";

type ReminderType = "4d" | "2d" | "2h";
type ReminderChannel = "email" | "sms";

type ReminderWindow = {
  key: ReminderType;
  label: string;
  maxMsUntilDeadline: number;
  minExclusiveMsUntilDeadline: number;
};

type UpcomingRace = {
  id: number;
  qualifying_start_at: string;
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
  emailSent: number;
  emailSkippedNoAddress: number;
  emailSkippedAlreadySent: number;
  pendingParticipants: number;
  raceId: number | null;
  raceName: string | null;
  reason:
    | "no_upcoming_race"
    | "no_window_due"
    | "no_missing_participants"
    | "reminders_sent";
  reminderType: ReminderType | null;
  smsSent: number;
  smsSkippedAlreadySent: number;
  smsSkippedNoGatewayAddress: number;
};

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

const REMINDER_WINDOWS: ReminderWindow[] = [
  { key: "2h", label: "2 hours", maxMsUntilDeadline: 2 * HOUR_MS, minExclusiveMsUntilDeadline: 0 },
  { key: "2d", label: "2 days", maxMsUntilDeadline: 2 * DAY_MS, minExclusiveMsUntilDeadline: 2 * HOUR_MS },
  { key: "4d", label: "4 days", maxMsUntilDeadline: 4 * DAY_MS, minExclusiveMsUntilDeadline: 2 * DAY_MS }
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
      if (targetIds.has(userId) && email) {
        emailByUserId.set(userId, email);
      }
    });

    if (users.length < perPage) {
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
  const pickDeadlineText = formatLeagueDateTime(race.qualifying_start_at, {
    dateStyle: "full",
    timeStyle: "short"
  });
  const siteUrl = getSiteUrl();
  const picksUrl = `${siteUrl}/picks`;

  const subject = `[Mound Hounds Pick'em] ${reminderWindow.label} reminder: ${race.race_name}`;
  const text = [
    "Pit lane reminder from the Mound Hounds Pick'em League.",
    "",
    `Race: ${race.race_name}`,
    `Pick deadline (qualifying): ${pickDeadlineText} (${LEAGUE_TIME_ZONE})`,
    "",
    "You have not submitted picks yet for this race.",
    `Submit your picks here: ${picksUrl}`,
    "",
    "Get your lineup locked before qualifying starts. Good luck and enjoy the race weekend!"
  ].join("\n");

  const smsText = [
    `Mound Hounds Pick'em reminder (${reminderWindow.label}):`,
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

  const { data: upcomingRace, error: raceError } = await supabase
    .from("races")
    .select("id,race_name,qualifying_start_at")
    .eq("is_archived", false)
    .gt("qualifying_start_at", now.toISOString())
    .order("qualifying_start_at", { ascending: true })
    .limit(1)
    .maybeSingle<UpcomingRace>();

  if (raceError) {
    throw new Error(`Failed loading upcoming race for reminders: ${raceError.message}`);
  }

  if (!upcomingRace) {
    return {
      emailSent: 0,
      emailSkippedAlreadySent: 0,
      emailSkippedNoAddress: 0,
      pendingParticipants: 0,
      raceId: null,
      raceName: null,
      reason: "no_upcoming_race",
      reminderType: null,
      smsSent: 0,
      smsSkippedAlreadySent: 0,
      smsSkippedNoGatewayAddress: 0
    };
  }

  const msUntilDeadline = Date.parse(upcomingRace.qualifying_start_at) - now.getTime();
  const reminderWindow = getReminderWindow(msUntilDeadline);
  if (!reminderWindow) {
    return {
      emailSent: 0,
      emailSkippedAlreadySent: 0,
      emailSkippedNoAddress: 0,
      pendingParticipants: 0,
      raceId: upcomingRace.id,
      raceName: upcomingRace.race_name,
      reason: "no_window_due",
      reminderType: null,
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
        .eq("role", "participant"),
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
      emailSent: 0,
      emailSkippedAlreadySent: 0,
      emailSkippedNoAddress: 0,
      pendingParticipants: 0,
      raceId: upcomingRace.id,
      raceName: upcomingRace.race_name,
      reason: "no_missing_participants",
      reminderType: reminderWindow.key,
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
    emailSent,
    emailSkippedAlreadySent,
    emailSkippedNoAddress,
    pendingParticipants: participantsMissingPicks.length,
    raceId: upcomingRace.id,
    raceName: upcomingRace.race_name,
    reason: "reminders_sent",
    reminderType: reminderWindow.key,
    smsSent,
    smsSkippedAlreadySent,
    smsSkippedNoGatewayAddress
  };
}
