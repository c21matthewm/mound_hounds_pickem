"use client";

import { useMemo, useState } from "react";
import { updateParticipantAction } from "@/app/admin/season-actions";
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
  fullName: string | null;
  id: string;
  isActive: boolean;
  pickCount: number;
  registered: boolean;
  role: "admin" | "participant";
  teamName: string;
};

type ParticipantStatus = "all" | "disabled" | "not_registered" | "registered";

type AdminParticipantsWorkspaceProps = {
  activeSeasonYear: number | null;
  initialQuery?: string;
  initialStatus?: string;
  participants: AdminParticipantRow[];
};

const PAGE_SIZE = 25;

const normalizeStatus = (status: string | undefined): ParticipantStatus =>
  status === "registered" || status === "not_registered" || status === "disabled"
    ? status
    : "all";

export function AdminParticipantsWorkspace({
  activeSeasonYear,
  initialQuery = "",
  initialStatus,
  participants
}: AdminParticipantsWorkspaceProps) {
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState(initialQuery);
  const [status, setStatus] = useState<ParticipantStatus>(normalizeStatus(initialStatus));

  const filteredParticipants = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return participants.filter((participant) => {
      const matchesQuery =
        !normalizedQuery ||
        participant.teamName.toLowerCase().includes(normalizedQuery) ||
        (participant.fullName ?? "").toLowerCase().includes(normalizedQuery);
      const matchesStatus =
        status === "registered"
          ? participant.registered
          : status === "not_registered"
            ? !participant.registered
            : status === "disabled"
              ? !participant.isActive
              : true;
      return matchesQuery && matchesStatus;
    });
  }, [participants, query, status]);

  const pageCount = Math.max(1, Math.ceil(filteredParticipants.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const rangeStart = filteredParticipants.length === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1;
  const rangeEnd = Math.min(currentPage * PAGE_SIZE, filteredParticipants.length);
  const visibleParticipants = filteredParticipants.slice(rangeStart === 0 ? 0 : rangeStart - 1, rangeEnd);
  const registeredCount = participants.filter((participant) => participant.registered).length;

  return (
    <ContentPanel className="mt-6">
      <SectionHeader
        action={
          <p className="text-sm font-semibold text-slate-700">
            {registeredCount} registered / {participants.length} accounts
          </p>
        }
        description="Manage permanent account eligibility separately from registration for the active season."
        title="Participants"
      />

      <div className="mt-4 grid gap-3 rounded-md ui-panel-muted border border-slate-200 bg-slate-50 p-3 sm:grid-cols-[minmax(0,1fr)_14rem]">
        <FormField label="Search accounts">
          <input
            className={fieldControlClassName()}
            onChange={(event) => {
              setPage(1);
              setQuery(event.target.value);
            }}
            placeholder="Name or team"
            type="search"
            value={query}
          />
        </FormField>
        <FormField label="Participation status">
          <select
            className={fieldControlClassName()}
            onChange={(event) => {
              setPage(1);
              setStatus(event.target.value as ParticipantStatus);
            }}
            value={status}
          >
            <option value="all">All accounts</option>
            <option value="registered">Registered</option>
            <option value="not_registered">Not registered</option>
            <option value="disabled">Participation disabled</option>
          </select>
        </FormField>
      </div>

      <p className="mt-3 text-xs text-slate-500" aria-live="polite">
        Showing {rangeStart}-{rangeEnd} of {filteredParticipants.length} matching accounts.
      </p>

      <div className="mt-4 grid gap-2">
        {visibleParticipants.length === 0 ? (
          <EmptyState
            description="Try a different name, team, or participation status."
            title="No matching participant accounts"
          />
        ) : (
          visibleParticipants.map((participant) => (
            <Disclosure
              description={`${participant.fullName || "Name not set"} · ${participant.role} · ${participant.pickCount} submitted race${participant.pickCount === 1 ? "" : "s"}`}
              key={participant.id}
              meta={
                <span className="flex flex-wrap justify-end gap-1.5">
                  <StatusChip tone={participant.isActive ? "info" : "danger"}>
                    {participant.isActive ? "Enabled" : "Disabled"}
                  </StatusChip>
                  <StatusChip tone={participant.registered ? "success" : "neutral"}>
                    {participant.registered ? "Registered" : "Not registered"}
                  </StatusChip>
                </span>
              }
              summary={participant.teamName}
            >
              <form
                action={updateParticipantAction}
                className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_auto_auto_auto]"
              >
                <input name="profile_id" type="hidden" value={participant.id} />
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
                    defaultChecked={participant.registered}
                    name="season_registered"
                    type="checkbox"
                  />
                  Registered {activeSeasonYear ?? "this season"}
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
            </Disclosure>
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
