export const ADMIN_WORKSPACE_TABS = [
  "race-week", "seasons", "participants", "drivers", "races", "health", "recovery", "feedback",
  // Keep existing results bookmarks and server-action return URLs working.
  "results"
] as const;
export type AdminWorkspaceTab = (typeof ADMIN_WORKSPACE_TABS)[number];
export const isAdminWorkspaceTab = (value: string): value is AdminWorkspaceTab =>
  ADMIN_WORKSPACE_TABS.some((tab) => tab === value);
export const parseAdminWorkspaceTab = (
  value: string | undefined,
  fallback: AdminWorkspaceTab = "race-week"
): AdminWorkspaceTab => value && isAdminWorkspaceTab(value) ? value : fallback;
export const visibleAdminWorkspaceTab = (tab: AdminWorkspaceTab): Exclude<AdminWorkspaceTab, "results"> =>
  tab === "results" ? "race-week" : tab;
