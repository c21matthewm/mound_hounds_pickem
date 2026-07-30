export const REMINDER_BATCH_SIZE = 25;
export const REMINDER_SEND_CONCURRENCY = 5;
export const REMINDER_MAX_ATTEMPTS = 3;
export const REMINDER_RETRY_DELAY_MS = 10 * 60 * 1000;

export type ReminderQueueStatus = "failed" | "pending" | "sent";

export type ReminderQueueRow = {
  attempt_count: number;
  channel: "email" | "sms";
  delivery_status: ReminderQueueStatus;
  id: number;
  last_attempt_at: string | null;
  lease_expires_at: string | null;
  recipient: string;
  user_id: string;
};

export type ReminderQueueSummary = {
  pending: number;
  permanentFailed: number;
  retrying: number;
  sent: number;
};

const isAtOrBefore = (value: string | null, timestamp: number): boolean =>
  value === null || Date.parse(value) <= timestamp;

export const isReminderDeliveryEligible = (
  row: ReminderQueueRow,
  now: Date
): boolean => {
  if (row.delivery_status === "sent" || row.attempt_count >= REMINDER_MAX_ATTEMPTS) {
    return false;
  }

  if (row.delivery_status === "pending") {
    return isAtOrBefore(row.lease_expires_at, now.getTime());
  }

  return isAtOrBefore(
    row.last_attempt_at,
    now.getTime() - REMINDER_RETRY_DELAY_MS
  );
};

export const selectReminderDeliveryBatch = (
  rows: ReminderQueueRow[],
  now: Date,
  batchSize = REMINDER_BATCH_SIZE
): ReminderQueueRow[] =>
  [...rows]
    .filter((row) => isReminderDeliveryEligible(row, now))
    .sort((left, right) => left.id - right.id)
    .slice(0, Math.max(0, batchSize));

export const summarizeReminderQueue = (
  rows: ReminderQueueRow[]
): ReminderQueueSummary =>
  rows.reduce<ReminderQueueSummary>(
    (summary, row) => {
      if (row.delivery_status === "sent") {
        summary.sent += 1;
      } else if (
        row.delivery_status === "failed" &&
        row.attempt_count >= REMINDER_MAX_ATTEMPTS
      ) {
        summary.permanentFailed += 1;
      } else if (row.attempt_count > 0) {
        summary.retrying += 1;
      } else {
        summary.pending += 1;
      }
      return summary;
    },
    {
      pending: 0,
      permanentFailed: 0,
      retrying: 0,
      sent: 0
    }
  );
