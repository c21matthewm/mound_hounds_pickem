"use client";

import { useRouter } from "next/navigation";
import { RouteTabs } from "@/components/ui-primitives";
import type { AdminWorkspaceTab } from "@/lib/admin-tabs";

export type { AdminWorkspaceTab } from "@/lib/admin-tabs";

const ADMIN_WORKSPACES: Array<{
  label: string;
  tab: AdminWorkspaceTab;
  testId?: string;
}> = [
  { label: "Race Week", tab: "health" },
  { label: "Participants", tab: "participants", testId: "admin-tab-participants" },
  { label: "Races", tab: "races", testId: "admin-tab-races" },
  { label: "Drivers", tab: "drivers", testId: "admin-tab-drivers" },
  { label: "Race Results", tab: "results", testId: "admin-tab-results" },
  { label: "Recovery", tab: "recovery" },
  { label: "Feedback", tab: "feedback", testId: "admin-tab-feedback" }
];

type AdminWorkspaceNavProps = {
  activeTab: AdminWorkspaceTab;
};

export function AdminWorkspaceNav({ activeTab }: AdminWorkspaceNavProps) {
  const router = useRouter();

  return (
    <div className="mt-6">
      <label className="block md:hidden">
        <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">
          Admin workspace
        </span>
        <select
          className="w-full rounded-md ui-control-border border border-slate-300 bg-white px-3 py-2.5 text-base font-semibold text-slate-900"
          onChange={(event) => router.push(`/admin?tab=${event.target.value}`)}
          value={activeTab}
        >
          {ADMIN_WORKSPACES.map((workspace) => (
            <option key={workspace.tab} value={workspace.tab}>
              {workspace.label}
            </option>
          ))}
        </select>
      </label>

      <div className="hidden overflow-x-auto pb-1 md:block">
        <RouteTabs
          ariaLabel="Admin workspaces"
          items={ADMIN_WORKSPACES.map((workspace) => ({
            active: workspace.tab === activeTab,
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
