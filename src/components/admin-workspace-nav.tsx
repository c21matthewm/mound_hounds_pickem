"use client";

import { useRouter } from "next/navigation";
import { RouteTabs } from "@/components/ui-primitives";
import { visibleAdminWorkspaceTab, type AdminWorkspaceTab } from "@/lib/admin-tabs";

export type { AdminWorkspaceTab } from "@/lib/admin-tabs";

const ADMIN_WORKSPACES: Array<{
  label: string;
  tab: AdminWorkspaceTab;
  testId?: string;
}> = [
  { label: "Race Week", tab: "race-week", testId: "admin-tab-race-week" },
  { label: "Seasons & League", tab: "seasons", testId: "admin-tab-seasons" },
  { label: "Participants", tab: "participants", testId: "admin-tab-participants" },
  { label: "Drivers & Groups", tab: "drivers", testId: "admin-tab-drivers" },
  { label: "Race Calendar", tab: "races", testId: "admin-tab-races" },
  { label: "System Health", tab: "health", testId: "admin-tab-health" },
  { label: "Recovery", tab: "recovery" },
  { label: "Feedback", tab: "feedback", testId: "admin-tab-feedback" }
];

type AdminWorkspaceNavProps = {
  activeTab: AdminWorkspaceTab;
  openErrorCount?: number | null;
  unpublishedRaceCount?: number | null;
};

export function AdminWorkspaceNav({ activeTab, openErrorCount, unpublishedRaceCount }: AdminWorkspaceNavProps) {
  const router = useRouter();
  const badgeFor = (tab: AdminWorkspaceTab) => {
    const badge = tab === "health" ? {count:openErrorCount ?? 0,label:"open application errors"}
      : tab === "race-week" ? {count:unpublishedRaceCount ?? 0,label:"completed races awaiting published results"} : undefined;
    return badge && badge.count > 0 ? badge : undefined;
  };

  return (
    <div className="mt-6">
      <label className="block md:hidden">
        <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">
          Admin workspace
        </span>
        <select
          className="w-full rounded-md ui-control-border border border-slate-300 bg-white px-3 py-2.5 text-base font-semibold text-slate-900"
          onChange={(event) => router.push(`/admin?tab=${event.target.value}`)}
          value={visibleAdminWorkspaceTab(activeTab)}
        >
          {ADMIN_WORKSPACES.map((workspace) => (
            <option key={workspace.tab} value={workspace.tab}>
              {workspace.label}{badgeFor(workspace.tab) ? ` · ${badgeFor(workspace.tab)!.count} need attention` : ""}
            </option>
          ))}
        </select>
      </label>

      <div className="hidden overflow-x-auto pb-1 md:block">
        <RouteTabs
          ariaLabel="Admin workspaces"
          items={ADMIN_WORKSPACES.map((workspace) => ({
            badge: badgeFor(workspace.tab),
            active: workspace.tab === visibleAdminWorkspaceTab(activeTab),
            href: `/admin?tab=${workspace.tab}`,
            label: workspace.label,
            testId: workspace.testId
          }))}
          layout="scroll"
        />
      </div>
    </div>
  );
}
