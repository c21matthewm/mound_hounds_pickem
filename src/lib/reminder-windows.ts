export type ReminderType = "2d" | "4h";

export type ReminderWindow = {
  key: ReminderType;
  label: string;
  maxMsUntilDeadline: number;
  minExclusiveMsUntilDeadline: number;
};

export type ReminderScheduleItem = {
  key: ReminderType;
  label: string;
  sendAt: string;
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

export const getReminderWindowByType = (
  reminderType: ReminderType
): ReminderWindow => {
  const window = REMINDER_WINDOWS.find((candidate) => candidate.key === reminderType);
  if (!window) {
    throw new Error(`Unsupported reminder type: ${reminderType}`);
  }
  return window;
};

export const reminderScheduleForDeadline = (
  deadline: string
): ReminderScheduleItem[] => {
  const deadlineMs = Date.parse(deadline);
  if (!Number.isFinite(deadlineMs)) {
    return [];
  }

  return [...REMINDER_WINDOWS]
    .reverse()
    .map((window) => ({
      key: window.key,
      label: window.key === "2d" ? "Two-day reminder" : "Final reminder",
      sendAt: new Date(deadlineMs - window.maxMsUntilDeadline).toISOString()
    }));
};
