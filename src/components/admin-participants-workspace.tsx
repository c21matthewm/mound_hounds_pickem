"use client";

import { useMemo, useState } from "react";
import { updateParticipantAction } from "@/app/admin/season-actions";
import { AdminParticipantRoleControls } from "@/components/admin-participant-role-controls";
import { AdminParticipantBulkControls } from "@/components/admin-participant-bulk-controls";
import type { ParticipantEnrollmentStatus } from "@/lib/admin-participant-bulk";
import { SubmitButton } from "@/components/submit-button";
import {
  ContentPanel,
  Disclosure,
  EmptyState,
  FormField,
  Pagination,
  SectionHeader,
  StatusChip,
  actionControlClassName,
  fieldControlClassName
} from "@/components/ui-primitives";

export type AdminParticipantRow = {
  email?: string | null;
  /** Decision for selectedParticipantSeasonId; registered/pickCount remain active-season fields. */
  enrollmentStatus?: ParticipantEnrollmentStatus;
  fullName: string | null;
  id: string;
  isActive: boolean;
  pickCount: number;
  registered: boolean;
  role: "admin" | "participant";
  teamName: string;
};

type ParticipantStatus = "all" | "disabled" | "not_registered" | "registered" | "declined";

type AdminParticipantsWorkspaceProps = {
  activeSeasonYear: number | null;
  activeSeasonId?: number | null;
  currentAdminId: string;
  emailWarning?: string | null;
  initialQuery?: string;
  initialStatus?: string;
  participants: AdminParticipantRow[];
  participantSeasons?: { id: number; seasonYear: number; status: "active" | "upcoming" }[];
  selectedParticipantSeasonId?: number | null;
};

const PAGE_SIZE = 25;

const normalizeStatus = (status: string | undefined): ParticipantStatus =>
  status === "registered" || status === "not_registered" || status === "disabled" || status === "declined"
    ? status
    : "all";

export function AdminParticipantsWorkspace({
  activeSeasonYear,
  activeSeasonId = null,
  currentAdminId,
  emailWarning,
  initialQuery = "",
  initialStatus,
  participants,
  participantSeasons = [],
  selectedParticipantSeasonId = null
}: AdminParticipantsWorkspaceProps) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const selectedSeason = participantSeasons.find(season => season.id === selectedParticipantSeasonId) ?? null;
  const enrollmentOf = (participant: AdminParticipantRow) => selectedSeason ? participant.enrollmentStatus ?? null : participant.registered ? "registered" : null;
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState(initialQuery);
  const [status, setStatus] = useState<ParticipantStatus>(normalizeStatus(initialStatus));

  const filteredParticipants = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return participants.filter((participant) => {
      const matchesQuery =
        !normalizedQuery ||
        participant.teamName.toLowerCase().includes(normalizedQuery) ||
        (participant.fullName ?? "").toLowerCase().includes(normalizedQuery) ||
        (participant.email ?? "").toLowerCase().includes(normalizedQuery);
      const matchesStatus =
        status === "registered"
          ? (selectedSeason ? participant.enrollmentStatus === "registered" : participant.registered)
          : status === "not_registered"
            ? (selectedSeason ? participant.enrollmentStatus !== "registered" : !participant.registered)
            : status === "declined"
              ? Boolean(selectedSeason && participant.enrollmentStatus === "declined")
            : status === "disabled"
              ? !participant.isActive
              : true;
      return matchesQuery && matchesStatus;
    });
  }, [participants, query, status, selectedSeason]);

  const pageCount = Math.max(1, Math.ceil(filteredParticipants.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const rangeStart = filteredParticipants.length === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1;
  const rangeEnd = Math.min(currentPage * PAGE_SIZE, filteredParticipants.length);
  const visibleParticipants = filteredParticipants.slice(rangeStart === 0 ? 0 : rangeStart - 1, rangeEnd);
  const registeredCount = participants.filter((participant) => enrollmentOf(participant) === "registered").length;
  const selectedParticipants = participants.filter(participant => selectedIds.has(participant.id));
  const allVisibleSelected = visibleParticipants.length > 0 && visibleParticipants.every(participant => selectedIds.has(participant.id));

  return (
    <ContentPanel className="mt-6">
      <SectionHeader
        action={
          <p className="text-sm font-semibold text-slate-700">
            {registeredCount} registered / {participants.length} accounts
          </p>
        }
        description="Manage account eligibility and registration for a selected active or upcoming season. Admin access is managed separately."
        title="Participants"
      />

      {participantSeasons.length > 0 ? <form action="/admin" className="mt-4 flex flex-wrap items-end gap-3" method="get">
        <input name="tab" type="hidden" value="participants" />
        <FormField label="Season enrollment view">
          <select className={fieldControlClassName()} name="participant_season_id" defaultValue={selectedParticipantSeasonId ?? ""} required>
            <option value="" disabled>Choose season</option>
            {participantSeasons.map(season => <option key={season.id} value={season.id}>{season.seasonYear} · {season.status}</option>)}
          </select>
        </FormField>
        <button className={actionControlClassName("secondary")} type="submit">View season</button>
      </form> : null}
      <p className="mt-3 text-sm text-slate-600">{selectedSeason || activeSeasonYear ? `Registration badges and filters show ${selectedSeason?.seasonYear ?? activeSeasonYear}. Individual profile edits retain their active-season registration controls.` : "No season is open for registration. You can still manage participant accounts and administrator access."}</p>

      {emailWarning ? (
        <p className="mt-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900" role="status">{emailWarning}</p>
      ) : null}

      <div className="mt-4 grid gap-3 rounded-md ui-panel-muted border border-slate-200 bg-slate-50 p-3 sm:grid-cols-[minmax(0,1fr)_14rem]">
        <FormField label="Search accounts">
          <input
            className={fieldControlClassName()}
            onChange={(event) => {
              setSelectedIds(new Set());
              setPage(1);
              setQuery(event.target.value);
            }}
            placeholder="Name, team, or email"
            type="search"
            value={query}
          />
        </FormField>
        <FormField label="Participation status">
          <select
            className={fieldControlClassName()}
            onChange={(event) => {
              setSelectedIds(new Set());
              setPage(1);
              setStatus(event.target.value as ParticipantStatus);
            }}
            value={status}
          >
            <option value="all">All accounts</option>
            <option value="registered">Registered</option>
            <option value="not_registered">Not registered</option>
            {selectedSeason ? <option value="declined">Declined</option> : null}
            <option value="disabled">Participation disabled</option>
          </select>
        </FormField>
      </div>

      <p className="mt-3 text-xs text-slate-500" aria-live="polite">
        Showing {rangeStart}-{rangeEnd} of {filteredParticipants.length} matching accounts.
      </p>

      <AdminParticipantBulkControls
        key={selectedParticipantSeasonId ?? "eligibility"}
        selectedSeason={selectedSeason}
        participants={selectedParticipants.map(participant => ({profile_id: participant.id, expected_is_active: participant.isActive, expected_status: participant.enrollmentStatus ?? null}))}
        onComplete={() => setSelectedIds(new Set())}
        onClear={() => setSelectedIds(new Set())}
      />
      <label className="mt-4 flex min-h-11 items-center gap-2 text-sm font-medium text-slate-700">
        <input type="checkbox" checked={allVisibleSelected} disabled={visibleParticipants.length === 0}
          onChange={() => setSelectedIds(previous => {
            const next = new Set(previous);
            if (allVisibleSelected) visibleParticipants.forEach(participant => next.delete(participant.id));
            else visibleParticipants.forEach(participant => { if (next.size < 100) next.add(participant.id); });
            return next;
          })} />
        Select accounts on this page
      </label>
      {selectedIds.size >= 100 ? <p role="status" className="text-xs text-slate-600">100 accounts selected. Apply this batch or clear the selection before selecting more.</p> : null}
      <div className="mt-2 grid gap-2">
        {visibleParticipants.length === 0 ? (
          <EmptyState
            description="Try a different name, team, email, or participation status."
            title="No matching participant accounts"
          />
        ) : (
          visibleParticipants.map((participant) => (
            <div key={participant.id}>
              <label className="mb-1 flex min-h-11 items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" aria-label={`Select ${participant.teamName}`} checked={selectedIds.has(participant.id)} disabled={!selectedIds.has(participant.id) && selectedIds.size >= 100}
                  onChange={() => setSelectedIds(previous => { const next = new Set(previous); if (next.has(participant.id)) next.delete(participant.id); else if (next.size < 100) next.add(participant.id); return next; })} />
                <span className="min-w-0 break-words">Select {participant.teamName}</span>
              </label>
            <Disclosure
              description={
                <>
                  <span className="block">{participant.fullName || "Name not set"} · {participant.role} · {participant.pickCount} submitted race{participant.pickCount === 1 ? "" : "s"}</span>
                  <span className="block break-all">Email: {participant.email ?? "Unavailable"}</span>
                </>
              }
              meta={
                <span className="flex flex-wrap justify-end gap-1.5">
                  {participant.role === "admin" ? <StatusChip tone="info">Admin</StatusChip> : null}
                  <StatusChip tone={participant.isActive ? "info" : "danger"}>
                    {participant.isActive ? "Enabled" : "Disabled"}
                  </StatusChip>
                  <StatusChip tone={enrollmentOf(participant) === "registered" ? "success" : "neutral"}>
                    {!selectedSeason && !activeSeasonYear ? "Between seasons" : enrollmentOf(participant) === "registered" ? "Registered" : enrollmentOf(participant) === "declined" ? "Declined" : "Not registered"}
                  </StatusChip>
                </span>
              }
              summary={participant.teamName}
            >
              <p className="mb-3 text-xs text-slate-600">{activeSeasonYear ? `Profile and participation edits below include ${activeSeasonYear} registration. Use the selection actions above to update another season.` : "Between seasons, you can edit names and participation eligibility. Historical season registrations remain unchanged."}</p>
              <form
                action={updateParticipantAction}
                className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_auto_auto_auto]"
              >
                <input name="profile_id" type="hidden" value={participant.id} />
                <input name="expected_season_id" type="hidden" value={activeSeasonId ?? ""} />
                <FormField label="Name">
                  <input
                    className={fieldControlClassName()}
                    defaultValue={participant.fullName ?? ""}
                    maxLength={100}
                    name="full_name"
                    required
                  />
                </FormField>
                <FormField label="Team name">
                  <input
                    className={fieldControlClassName()}
                    defaultValue={participant.teamName}
                    maxLength={100}
                    name="team_name"
                    required
                  />
                </FormField>
                <label className="flex min-h-11 items-center gap-2 self-end rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700">
                  <input
                    defaultChecked={participant.isActive}
                    name="account_eligible"
                    type="checkbox"
                  />
                  Participation enabled
                </label>
                <label className="flex min-h-11 items-center gap-2 self-end rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700">
                  <input
                    disabled={!activeSeasonId}
                    defaultChecked={participant.registered}
                    name="season_registered"
                    type="checkbox"
                  />
                  {activeSeasonYear ? `Registered ${activeSeasonYear}` : "No active season"}
                </label>
                {participant.pickCount > 0 ? (
                  <label className="flex items-start gap-2 rounded-md border ui-status-danger border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-800 sm:col-span-2 lg:col-span-5">
                    <input className="mt-0.5" name="force_removal" type="checkbox" />
                    Allow forced removal from scoring despite {participant.pickCount} submitted race
                    {participant.pickCount === 1 ? "" : "s"}. Leave unchecked for normal edits.
                  </label>
                ) : null}
                <SubmitButton
                  className={actionControlClassName("primary", "self-end")}
                  pendingLabel="Saving..."
                >
                  Save participant
                </SubmitButton>
              </form>
              <AdminParticipantRoleControls
                currentRole={participant.role}
                hasOtherEligibleAdmin={participants.some((candidate) => candidate.id !== participant.id && candidate.role === "admin" && candidate.isActive)}
                isCurrentAdmin={participant.id === currentAdminId}
                profileComplete={Boolean(participant.fullName?.trim() && participant.teamName.trim())}
                profileId={participant.id}
                teamName={participant.teamName}
              />
            </Disclosure>
            </div>
          ))
        )}
      </div>

      {filteredParticipants.length > PAGE_SIZE ? (
        <Pagination
          className="mt-4 -mx-4 -mb-4 sm:-mx-5 sm:-mb-5"
          currentPage={currentPage}
          itemLabel="accounts"
          onNext={() => setPage((previous) => Math.min(pageCount, previous + 1))}
          onPrevious={() => setPage((previous) => Math.max(1, previous - 1))}
          pageCount={pageCount}
          rangeEnd={rangeEnd}
          rangeStart={rangeStart}
          totalItems={filteredParticipants.length}
        />
      ) : null}
    </ContentPanel>
  );
}
