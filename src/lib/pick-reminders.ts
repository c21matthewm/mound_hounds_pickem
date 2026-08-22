import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildPickReminderMessage,
  type PickReminderRace
} from "@/lib/pick-reminder-message";
import { pickWindowDisplayName, racesInPickWindow } from "@/lib/pick-windows";
import { pickLockAtForRace } from "@/lib/race-format";
import { getPreviousRaceResultsGate } from "@/lib/pickem-results-gate";
import {
  REMINDER_BATCH_SIZE,
  REMINDER_SEND_CONCURRENCY,
  selectReminderDeliveryBatch,
  summarizeReminderQueue,
  type ReminderQueueRow
} from "@/lib/reminder-queue";
import {
  getReminderWindow,
  type ReminderType,
} from "@/lib/reminder-windows";
import { sendResendEmail } from "@/lib/resend-email";
import { loadActiveLeagueSeason } from "@/lib/seasons";
import { canonicalSiteOrigin } from "@/lib/site-url";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/service-role";

type ReminderChannel = "email" | "sms";

type UpcomingRace = PickReminderRace;

type ProfileForReminder = {
  full_name: string | null;
  id: string;
  phone_carrier: string | null;
  phone_number: string | null;
  team_name: string | null;
};

type PickUserRow = {
  race_id: number;
  user_id: string;
};

type PickReminderSummary = {
  batchDeliveryCount: number;
  emailDeliveryEnabled: boolean;
  emailFailed: number;
  emailSent: number;
  emailSkippedNoAddress: number;
  emailSkippedAlreadySent: number;
  pendingParticipants: number;
  queuePending: number;
  queuePermanentFailed: number;
  queueRetrying: number;
  queueSent: number;
  raceId: number | null;
  raceName: string | null;
  remainingDeliveries: number;
  reason:
    | "delivery_disabled"
    | "no_upcoming_race"
    | "waiting_previous_results"
    | "no_window_due"
    | "no_missing_participants"
    | "delivery_batch_processed";
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

type FreshReminderContext = {
  missingRaces: UpcomingRace[];
  races: UpcomingRace[];
};

const reminderContextsMatch = (
  expected: FreshReminderContext,
  current: FreshReminderContext | null
): boolean => {
  if (!current || expected.races.length !== current.races.length) {
    return false;
  }

  const expectedRaceState = expected.races.map((race) =>
    [race.id, pickLockAtForRace(race)].join(":")
  );
  const currentRaceState = current.races.map((race) =>
    [race.id, pickLockAtForRace(race)].join(":")
  );
  const expectedMissingIds = expected.missingRaces.map((race) => race.id);
  const currentMissingIds = current.missingRaces.map((race) => race.id);

  return (
    expectedRaceState.join("|") === currentRaceState.join("|") &&
    expectedMissingIds.join("|") === currentMissingIds.join("|")
  );
};

const discardUnsentReminder = async (
  supabase: SupabaseClient,
  reminderId: number
): Promise<void> => {
  const { error } = await supabase
    .from("pick_reminders")
    .delete()
    .eq("id", reminderId)
    .neq("delivery_status", "sent");

  if (error) {
    throw new Error(`Failed discarding obsolete reminder ${reminderId}: ${error.message}`);
  }
};

const loadFreshReminderContext = async (
  supabase: SupabaseClient,
  reminderId: number
): Promise<FreshReminderContext | null> => {
  const { data, error } = await supabase.rpc(
    "validate_pick_reminder_delivery",
    { p_reminder_id: reminderId }
  );

  if (error) {
    throw new Error(`Failed rechecking reminder eligibility: ${error.message}`);
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("Reminder eligibility check returned an invalid response.");
  }

  const payload = data as Record<string, unknown>;
  if (payload.valid !== true) {
    return null;
  }

  const isUpcomingRace = (value: unknown): value is UpcomingRace => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return false;
    }

    const race = value as Record<string, unknown>;
    return (
      typeof race.id === "number" &&
      (typeof race.pick_format === "string" || race.pick_format === null) &&
      typeof race.pick_window_key === "string" &&
      typeof race.qualifying_start_at === "string" &&
      typeof race.race_date === "string" &&
      typeof race.race_name === "string" &&
      typeof race.round_number === "number" &&
      typeof race.season_id === "number"
    );
  };

  if (!Array.isArray(payload.races) || !Array.isArray(payload.missingRaces)) {
    throw new Error("Reminder eligibility check omitted its race context.");
  }

  const races = payload.races.filter(isUpcomingRace);
  const missingRaces = payload.missingRaces.filter(isUpcomingRace);
  if (
    races.length !== payload.races.length ||
    missingRaces.length !== payload.missingRaces.length ||
    races.length === 0 ||
    missingRaces.length === 0
  ) {
    throw new Error("Reminder eligibility check returned malformed race data.");
  }

  return { missingRaces, races };
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
  const emptySummary = (
    reason: PickReminderSummary["reason"],
    raceId: number | null = null,
    raceName: string | null = null,
    reminderType: ReminderType | null = null
  ): PickReminderSummary => ({
    batchDeliveryCount: 0,
    emailDeliveryEnabled,
    emailFailed: 0,
    emailSent: 0,
    emailSkippedAlreadySent: 0,
    emailSkippedNoAddress: 0,
    pendingParticipants: 0,
    queuePending: 0,
    queuePermanentFailed: 0,
    queueRetrying: 0,
    queueSent: 0,
    raceId,
    raceName,
    reason,
    remainingDeliveries: 0,
    reminderType,
    smsDeliveryEnabled,
    smsFailed: 0,
    smsSent: 0,
    smsSkippedAlreadySent: 0,
    smsSkippedNoGatewayAddress: 0
  });

  if (!emailDeliveryEnabled) {
    return emptySummary("delivery_disabled");
  }

  const siteUrl = canonicalSiteOrigin();

  const activeSeason = await loadActiveLeagueSeason(supabase);
  const { data: upcomingRaces, error: raceError } = activeSeason
    ? await supabase
        .from("races")
        .select(
          "id,race_name,pick_format,pick_window_key,qualifying_start_at,race_date,season_id,round_number"
        )
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
  const upcomingRaceWindow = upcomingRace
    ? racesInPickWindow((upcomingRaces ?? []) as UpcomingRace[], upcomingRace)
    : [];
  const upcomingRaceName = upcomingRace
    ? pickWindowDisplayName(upcomingRaceWindow, upcomingRace.race_name)
    : null;

  if (!upcomingRace) {
    return emptySummary("no_upcoming_race");
  }

  const previousResultsGate = await getPreviousRaceResultsGate(supabase, upcomingRace);
  if (previousResultsGate.status === "blocked") {
    return emptySummary(
      "waiting_previous_results",
      upcomingRace.id,
      upcomingRaceName
    );
  }

  const msUntilDeadline = Date.parse(pickLockAtForRace(upcomingRace)) - now.getTime();
  const reminderWindow = getReminderWindow(msUntilDeadline);
  if (!reminderWindow) {
    return emptySummary("no_window_due", upcomingRace.id, upcomingRaceName);
  }

  const { error: fieldFreezeError } = await supabase.rpc(
    "ensure_race_pick_field_snapshot",
    { p_race_id: upcomingRace.id }
  );
  if (fieldFreezeError) {
    throw new Error(
      `Reminder delivery stopped because the race field is not ready: ${fieldFreezeError.message}`
    );
  }

  const [registrationResponse, { data: pickRows, error: picksError }] =
    await Promise.all([
      supabase
        .from("season_participants")
        .select("profile_id")
        .eq("season_id", upcomingRace.season_id)
        .eq("status", "registered"),
      supabase
        .from("picks")
        .select("race_id,user_id")
        .in("race_id", upcomingRaceWindow.map((race) => race.id))
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

  const pickedRaceIdsByUser = new Map<string, Set<number>>();
  ((pickRows ?? []) as PickUserRow[]).forEach((row) => {
    const raceIds = pickedRaceIdsByUser.get(row.user_id) ?? new Set<number>();
    raceIds.add(row.race_id);
    pickedRaceIdsByUser.set(row.user_id, raceIds);
  });
  const participantsMissingPicks = ((participants ?? []) as ProfileForReminder[]).filter(
    (participant) =>
      (pickedRaceIdsByUser.get(participant.id)?.size ?? 0) < upcomingRaceWindow.length
  );

  if (participantsMissingPicks.length === 0) {
    const { error: clearQueueError } = await supabase
      .from("pick_reminders")
      .delete()
      .eq("race_id", upcomingRace.id)
      .eq("reminder_type", reminderWindow.key)
      .in("delivery_status", ["pending", "failed"]);
    if (clearQueueError) {
      throw new Error(`Failed clearing obsolete reminder queue rows: ${clearQueueError.message}`);
    }
    return emptySummary(
      "no_missing_participants",
      upcomingRace.id,
      upcomingRaceName,
      reminderWindow.key
    );
  }

  const emailByUserId = await loadAuthEmailsByUserId(
    supabase,
    participantsMissingPicks.map((participant) => participant.id)
  );
  const participantById = new Map(
    participantsMissingPicks.map((participant) => [participant.id, participant])
  );
  const desiredDeliveryByKey = new Map<
    string,
    {
      channel: ReminderChannel;
      participant: ProfileForReminder;
      recipient: string;
    }
  >();
  let emailSkippedNoAddress = 0;
  let smsSkippedNoGatewayAddress = 0;

  [...participantsMissingPicks]
    .sort((left, right) => left.id.localeCompare(right.id))
    .forEach((participant) => {
      const recipientEmail = emailByUserId.get(participant.id) ?? null;
      if (recipientEmail) {
        desiredDeliveryByKey.set(`${participant.id}:email`, {
          channel: "email",
          participant,
          recipient: recipientEmail
        });
      } else {
        emailSkippedNoAddress += 1;
      }

      if (!smsDeliveryEnabled) {
        return;
      }
      const smsAddress = toSmsGatewayAddress(
        participant.phone_number,
        participant.phone_carrier
      );
      if (smsAddress) {
        desiredDeliveryByKey.set(`${participant.id}:sms`, {
          channel: "sms",
          participant,
          recipient: smsAddress
        });
      } else {
        smsSkippedNoGatewayAddress += 1;
      }
    });

  const queueFields =
    "id,user_id,channel,recipient,delivery_status,attempt_count,last_attempt_at,lease_expires_at";
  const { data: existingQueueData, error: existingQueueError } = await supabase
    .from("pick_reminders")
    .select(queueFields)
    .eq("race_id", upcomingRace.id)
    .eq("reminder_type", reminderWindow.key);
  if (existingQueueError) {
    throw new Error(`Failed loading reminder delivery queue: ${existingQueueError.message}`);
  }

  const existingQueueRows = (existingQueueData ?? []) as ReminderQueueRow[];
  const staleQueueIds = existingQueueRows
    .filter(
      (row) =>
        row.delivery_status !== "sent" &&
        !desiredDeliveryByKey.has(`${row.user_id}:${row.channel}`)
    )
    .map((row) => row.id);
  if (staleQueueIds.length > 0) {
    const { error: staleDeleteError } = await supabase
      .from("pick_reminders")
      .delete()
      .in("id", staleQueueIds);
    if (staleDeleteError) {
      throw new Error(`Failed removing obsolete reminder deliveries: ${staleDeleteError.message}`);
    }
  }

  const preparedRows = Array.from(desiredDeliveryByKey.values()).map((delivery) => ({
    attempt_count: 0,
    channel: delivery.channel,
    delivery_status: "pending" as const,
    lease_expires_at: "1970-01-01T00:00:00.000Z",
    race_id: upcomingRace.id,
    recipient: delivery.recipient,
    reminder_type: reminderWindow.key,
    user_id: delivery.participant.id
  }));
  if (preparedRows.length > 0) {
    const { error: prepareQueueError } = await supabase
      .from("pick_reminders")
      .upsert(preparedRows, {
        ignoreDuplicates: true,
        onConflict: "race_id,user_id,reminder_type,channel"
      });
    if (prepareQueueError) {
      throw new Error(`Failed preparing reminder delivery queue: ${prepareQueueError.message}`);
    }
  }

  const { data: queuedData, error: queuedError } = await supabase
    .from("pick_reminders")
    .select(queueFields)
    .eq("race_id", upcomingRace.id)
    .eq("reminder_type", reminderWindow.key);
  if (queuedError) {
    throw new Error(`Failed refreshing reminder delivery queue: ${queuedError.message}`);
  }

  const queueRows = ((queuedData ?? []) as ReminderQueueRow[]).filter((row) =>
    desiredDeliveryByKey.has(`${row.user_id}:${row.channel}`)
  );
  const deliveryBatch = selectReminderDeliveryBatch(
    queueRows,
    now,
    REMINDER_BATCH_SIZE
  );
  const deliveryResults = await mapWithConcurrency(
    deliveryBatch,
    REMINDER_SEND_CONCURRENCY,
    async (queueRow) => {
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
      const participant = participantById.get(queueRow.user_id);
      const desiredDelivery = desiredDeliveryByKey.get(
        `${queueRow.user_id}:${queueRow.channel}`
      );
      if (!participant || !desiredDelivery) {
        return counts;
      }
      const recipient = desiredDelivery.recipient;

      if (queueRow.channel === "email") {
        let reminderId: number | null = null;
        try {
          reminderId = await claimReminderSlot(
            supabase,
            upcomingRace.id,
            participant.id,
            reminderWindow.key,
            "email",
            recipient
          );

          if (!reminderId) {
            counts.emailSkippedAlreadySent = 1;
          } else {
            const claimedReminderId = reminderId;
            const freshContext = await loadFreshReminderContext(supabase, claimedReminderId);
            if (!freshContext) {
              await discardUnsentReminder(supabase, claimedReminderId);
              return counts;
            }
            const message = buildPickReminderMessage({
              missingRaces: freshContext.missingRaces,
              races: freshContext.races,
              recipientName: participant.full_name,
              reminderWindow,
              siteUrl
            });
            const sendResult = await sendResendEmail({
              beforeSend: async () =>
                reminderContextsMatch(
                  freshContext,
                  await loadFreshReminderContext(supabase, claimedReminderId)
                ),
              html: message.html,
              idempotencyKey: `pick-${upcomingRace.id}-${participant.id}-${reminderWindow.key}-email`,
              subject: message.subject,
              text: message.text,
              to: recipient
            });
            if (sendResult.skipped) {
              await discardUnsentReminder(supabase, claimedReminderId);
              return counts;
            }
            await markReminderSent(supabase, claimedReminderId, sendResult.id);
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
          recipient
        );

        if (!smsReminderId) {
          counts.smsSkippedAlreadySent = 1;
        } else {
          const claimedReminderId = smsReminderId;
          const freshContext = await loadFreshReminderContext(supabase, claimedReminderId);
          if (!freshContext) {
            await discardUnsentReminder(supabase, claimedReminderId);
            return counts;
          }
          const message = buildPickReminderMessage({
            missingRaces: freshContext.missingRaces,
            races: freshContext.races,
            recipientName: participant.full_name,
            reminderWindow,
            siteUrl
          });
          const sendResult = await sendResendEmail({
            beforeSend: async () =>
              reminderContextsMatch(
                freshContext,
                await loadFreshReminderContext(supabase, claimedReminderId)
              ),
            idempotencyKey: `pick-${upcomingRace.id}-${participant.id}-${reminderWindow.key}-sms`,
            subject: message.subject,
            text: message.smsText,
            to: recipient
          });
          if (sendResult.skipped) {
            await discardUnsentReminder(supabase, claimedReminderId);
            return counts;
          }
          await markReminderSent(supabase, claimedReminderId, sendResult.id);
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

  const { data: finalQueueData, error: finalQueueError } = await supabase
    .from("pick_reminders")
    .select(queueFields)
    .eq("race_id", upcomingRace.id)
    .eq("reminder_type", reminderWindow.key);
  if (finalQueueError) {
    throw new Error(`Failed summarizing reminder delivery queue: ${finalQueueError.message}`);
  }
  const finalQueueRows = ((finalQueueData ?? []) as ReminderQueueRow[]).filter((row) =>
    desiredDeliveryByKey.has(`${row.user_id}:${row.channel}`)
  );
  const queueSummary = summarizeReminderQueue(finalQueueRows);

  return {
    batchDeliveryCount: deliveryBatch.length,
    emailDeliveryEnabled,
    ...totals,
    emailSkippedAlreadySent:
      totals.emailSkippedAlreadySent +
      queueRows.filter(
        (row) => row.channel === "email" && row.delivery_status === "sent"
      ).length,
    emailSkippedNoAddress,
    pendingParticipants: participantsMissingPicks.length,
    queuePending: queueSummary.pending,
    queuePermanentFailed: queueSummary.permanentFailed,
    queueRetrying: queueSummary.retrying,
    queueSent: queueSummary.sent,
    raceId: upcomingRace.id,
    raceName: upcomingRaceName,
    reason: "delivery_batch_processed",
    remainingDeliveries: queueSummary.pending + queueSummary.retrying,
    reminderType: reminderWindow.key,
    smsDeliveryEnabled,
    smsSkippedAlreadySent:
      totals.smsSkippedAlreadySent +
      queueRows.filter(
        (row) => row.channel === "sms" && row.delivery_status === "sent"
      ).length,
    smsSkippedNoGatewayAddress:
      totals.smsSkippedNoGatewayAddress + smsSkippedNoGatewayAddress
  };
}
