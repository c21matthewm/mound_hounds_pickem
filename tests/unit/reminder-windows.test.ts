import { describe, expect, it } from "vitest";
import { DAY_MS, HOUR_MS, getReminderWindow } from "@/lib/reminder-windows";

describe("pick reminder windows", () => {
  it("opens the five-day notification window at exactly five days", () => {
    expect(getReminderWindow(5 * DAY_MS)?.key).toBe("5d_open");
  });

  it("moves to the two-day window at exactly two days", () => {
    expect(getReminderWindow(2 * DAY_MS)?.key).toBe("2d");
  });

  it("moves to the final window at exactly four hours", () => {
    expect(getReminderWindow(4 * HOUR_MS)?.key).toBe("4h");
  });

  it("does not schedule a window after the deadline or too early", () => {
    expect(getReminderWindow(0)).toBeNull();
    expect(getReminderWindow(5 * DAY_MS + 1)).toBeNull();
  });
});
