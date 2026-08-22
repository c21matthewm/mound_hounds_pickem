import { describe, expect, it } from "vitest";
import {
  DAY_MS,
  HOUR_MS,
  getReminderWindow,
  reminderScheduleForDeadline
} from "@/lib/reminder-windows";

describe("pick reminder windows", () => {
  it("does not open an application email window before two days", () => {
    expect(getReminderWindow(5 * DAY_MS)).toBeNull();
    expect(getReminderWindow(2 * DAY_MS + 1)).toBeNull();
  });

  it("moves to the two-day window at exactly two days", () => {
    expect(getReminderWindow(2 * DAY_MS)?.key).toBe("2d");
  });

  it("moves to the final window at exactly four hours", () => {
    expect(getReminderWindow(4 * HOUR_MS)?.key).toBe("4h");
  });

  it("does not schedule a window after the deadline or too early", () => {
    expect(getReminderWindow(0)).toBeNull();
    expect(getReminderWindow(2 * DAY_MS + 1)).toBeNull();
  });

  it("derives all delivery times from the current qualifying deadline", () => {
    expect(reminderScheduleForDeadline("2027-07-24T14:00:00.000Z")).toEqual([
      {
        key: "2d",
        label: "Two-day reminder",
        sendAt: "2027-07-22T14:00:00.000Z"
      },
      {
        key: "4h",
        label: "Final reminder",
        sendAt: "2027-07-24T10:00:00.000Z"
      }
    ]);
  });

  it("moves only the future schedule when qualifying is delayed", () => {
    const original = reminderScheduleForDeadline("2027-07-24T14:00:00.000Z");
    const delayed = reminderScheduleForDeadline("2027-07-24T17:30:00.000Z");

    expect(
      delayed.map(
        (item, index) => Date.parse(item.sendAt) - Date.parse(original[index].sendAt)
      )
    ).toEqual([3.5 * HOUR_MS, 3.5 * HOUR_MS]);
    expect(delayed.map((item) => item.key)).toEqual(["2d", "4h"]);
  });

  it("returns no schedule for malformed deadlines", () => {
    expect(reminderScheduleForDeadline("not-a-date")).toEqual([]);
  });
});
