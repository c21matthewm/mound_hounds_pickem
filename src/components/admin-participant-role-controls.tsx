"use client";

import { updateParticipantRoleAction } from "@/app/admin/role-actions";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { StatusChip, actionControlClassName } from "@/components/ui-primitives";

type AdminParticipantRoleControlsProps = {
  currentRole: "admin" | "participant";
  hasOtherEligibleAdmin: boolean;
  isCurrentAdmin: boolean;
  profileComplete: boolean;
  profileId: string;
  teamName: string;
};

export function AdminParticipantRoleControls({
  currentRole,
  hasOtherEligibleAdmin,
  isCurrentAdmin,
  profileComplete,
  profileId,
  teamName
}: AdminParticipantRoleControlsProps) {
  const isAdmin = currentRole === "admin";
  const disabledReason = isAdmin && isCurrentAdmin ? "You cannot remove your own admin access."
    : isAdmin && !hasOtherEligibleAdmin ? "Another admin with participation enabled is required before removing this admin."
      : !isAdmin && !profileComplete ? "Save this participant’s name and team before granting admin access."
        : null;
  const permissionSummary = "Admins can manage races, drivers, participants, results, season archives, and recovery.";
  const confirmMessage = isAdmin
    ? `Remove admin access for ${teamName}? They will keep their account and season registration, but will no longer be able to use the Admin workspace.`
    : `Grant admin access to ${teamName}? ${permissionSummary} Only grant these permissions to someone you trust to run the league.`;

  return (
    <div className="mt-4 flex flex-col gap-3 rounded-md border border-slate-200 bg-slate-50 p-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-semibold text-slate-900">Admin access</p>
          <StatusChip tone={isAdmin ? "info" : "neutral"}>{isAdmin ? "Admin" : "Participant"}</StatusChip>
        </div>
        <p className="mt-1 max-w-xl text-xs text-slate-600">{permissionSummary} Participation eligibility and season registration are separate from admin access.</p>
        {disabledReason ? <p className="mt-2 text-xs font-medium text-slate-700">{disabledReason}</p> : null}
      </div>
      <form action={updateParticipantRoleAction} className="shrink-0">
        <input name="profile_id" type="hidden" value={profileId} />
        <input name="expected_role" type="hidden" value={currentRole} />
        <input name="role" type="hidden" value={isAdmin ? "participant" : "admin"} />
        <ConfirmSubmitButton
          className={actionControlClassName("secondary", "w-full sm:w-auto")}
          confirmMessage={confirmMessage}
          disabled={Boolean(disabledReason)}
          pendingLabel="Updating role..."
        >
          {isAdmin ? "Demote to Participant" : "Promote to Admin"}
        </ConfirmSubmitButton>
      </form>
    </div>
  );
}
