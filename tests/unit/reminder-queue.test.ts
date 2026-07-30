import { describe, expect, it } from "vitest";
import {
  REMINDER_BATCH_SIZE,
  isReminderDeliveryEligible,
  selectReminderDeliveryBatch,
  summarizeReminderQueue,
  type ReminderQueueRow
} from "@/lib/reminder-queue";

const now = new Date("2027-05-01T12:00:00.000Z");

const row = (
  id: number,
  overrides: Partial<ReminderQueueRow> = {}
): ReminderQueueRow => ({
  attempt_count: 0,
  channel: "email",
  delivery_status: "pending",
  id,
  last_attempt_at: null,
  lease_expires_at: null,
  recipient: `team-${id}@example.com`,
  user_id: `user-${id}`,
  ...overrides
});

describe("reminder delivery queue", () => {
  it("caps a cron batch at 25 deterministic deliveries", () => {
    const rows = Array.from({ length: 90 }, (_, index) => row(index + 1));
    const batch = selectReminderDeliveryBatch(rows.reverse(), now);

    expect(batch).toHaveLength(REMINDER_BATCH_SIZE);
    expect(batch.map((delivery) => delivery.id)).toEqual(
      Array.from({ length: REMINDER_BATCH_SIZE }, (_, index) => index + 1)
    );
  });

  it("waits for leases and retry delays before reclaiming deliveries", () => {
    expect(
      isReminderDeliveryEligible(
        row(1, {
          attempt_count: 1,
          lease_expires_at: "2027-05-01T12:05:00.000Z"
        }),
        now
      )
    ).toBe(false);
    expect(
      isReminderDeliveryEligible(
        row(2, {
          attempt_count: 1,
          delivery_status: "failed",
          last_attempt_at: "2027-05-01T11:55:00.000Z"
        }),
        now
      )
    ).toBe(false);
    expect(
      isReminderDeliveryEligible(
        row(3, {
          attempt_count: 1,
          delivery_status: "failed",
          last_attempt_at: "2027-05-01T11:49:59.000Z"
        }),
        now
      )
    ).toBe(true);
  });

  it("never retries sent or permanently failed deliveries", () => {
    const sent = row(1, { attempt_count: 1, delivery_status: "sent" });
    const permanentlyFailed = row(2, {
      attempt_count: 3,
      delivery_status: "failed"
    });

    expect(selectReminderDeliveryBatch([sent, permanentlyFailed], now)).toEqual([]);
    expect(summarizeReminderQueue([sent, permanentlyFailed])).toEqual({
      pending: 0,
      permanentFailed: 1,
      retrying: 0,
      sent: 1
    });
  });

  it("reports fresh, retrying, sent, and terminal states separately", () => {
    expect(
      summarizeReminderQueue([
        row(1),
        row(2, { attempt_count: 1 }),
        row(3, { attempt_count: 2, delivery_status: "failed" }),
        row(4, { attempt_count: 1, delivery_status: "sent" }),
        row(5, { attempt_count: 3, delivery_status: "failed" })
      ])
    ).toEqual({
      pending: 1,
      permanentFailed: 1,
      retrying: 2,
      sent: 1
    });
  });
});
