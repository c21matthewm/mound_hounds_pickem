export type FeedbackType = "bug" | "improvement";

export const FEEDBACK_TYPE_OPTIONS: Array<{ label: string; value: FeedbackType }> = [
  { label: "Bug report", value: "bug" },
  { label: "Improvement idea", value: "improvement" }
];

const FEEDBACK_CATEGORY_VALUES = [
  "weekly_picks",
  "leaderboard",
  "login",
  "notifications",
  "user_interface",
  "data_accuracy",
  "other"
] as const;

export type FeedbackCategory = (typeof FEEDBACK_CATEGORY_VALUES)[number];

export const FEEDBACK_CATEGORY_OPTIONS: Array<{ label: string; value: FeedbackCategory }> = [
  { label: "Weekly Picks", value: "weekly_picks" },
  { label: "Leaderboard", value: "leaderboard" },
  { label: "Login", value: "login" },
  { label: "Notifications", value: "notifications" },
  { label: "User Interface", value: "user_interface" },
  { label: "Data Accuracy", value: "data_accuracy" },
  { label: "Other", value: "other" }
];

export const isFeedbackType = (value: string): value is FeedbackType =>
  FEEDBACK_TYPE_OPTIONS.some((option) => option.value === value);

export const isFeedbackCategory = (value: string): value is FeedbackCategory =>
  FEEDBACK_CATEGORY_VALUES.some((allowed) => allowed === value);

export const feedbackTypeLabel = (value: string): string =>
  FEEDBACK_TYPE_OPTIONS.find((option) => option.value === value)?.label ?? value;

export const feedbackCategoryLabel = (value: string): string =>
  FEEDBACK_CATEGORY_OPTIONS.find((option) => option.value === value)?.label ?? value;
