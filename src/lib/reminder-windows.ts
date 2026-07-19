export type ReminderType = "5d_open" | "2d" | "4h";

export type ReminderWindow = {
  key: ReminderType;
  label: string;
  maxMsUntilDeadline: number;
  minExclusiveMsUntilDeadline: number;
};

export const HOUR_MS = 60 * 60 * 1000;
export const DAY_MS = 24 * HOUR_MS;

export const REMINDER_WINDOWS: ReminderWindow[] = [
  {
    key: "4h",
    label: "4 hours",
    maxMsUntilDeadline: 4 * HOUR_MS,
    minExclusiveMsUntilDeadline: 0
  },
  {
    key: "2d",
    label: "2 days",
    maxMsUntilDeadline: 2 * DAY_MS,
    minExclusiveMsUntilDeadline: 4 * HOUR_MS
  },
  {
    key: "5d_open",
    label: "5 days",
    maxMsUntilDeadline: 5 * DAY_MS,
    minExclusiveMsUntilDeadline: 2 * DAY_MS
  }
];

export const getReminderWindow = (msUntilDeadline: number): ReminderWindow | null => {
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
