export const ADMIN_WORKSPACE_TABS = [
  "drivers",
  "participants",
  "races",
  "results",
  "feedback",
  "health",
  "recovery"
] as const;

export type AdminWorkspaceTab = (typeof ADMIN_WORKSPACE_TABS)[number];

export const isAdminWorkspaceTab = (value: string): value is AdminWorkspaceTab =>
  ADMIN_WORKSPACE_TABS.some((tab) => tab === value);

export const parseAdminWorkspaceTab = (
  value: string | undefined,
  fallback: AdminWorkspaceTab = "health"
): AdminWorkspaceTab =>
  value && isAdminWorkspaceTab(value) ? value : fallback;
