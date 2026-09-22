import type { AdminCapabilities } from "@/lib/admin-capabilities";
import { AdminAuditLog } from "@/components/admin-audit-log";
import type { AdminAuditLogData } from "@/lib/admin-audit-log";
import { SubmitButton } from "@/components/submit-button";
import { triggerFantasyWinnerJobAction } from "@/app/admin/race-week-actions";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import {
  AdminWorkspaceHeader,
  CompactNotice,
  Disclosure,
  StatusChip,
  actionControlClassName
} from "@/components/ui-primitives";
import { formatLeagueDateTime } from "@/lib/timezone";
import { EXPECTED_SCHEMA_VERSION } from "@/lib/supabase/schema-version";

export type AdminReminderHealthRow = {
  attempt_count: number;
  delivery_status: "failed" | "pending" | "sent";
  last_error: string | null;
  reminder_type: string;
  updated_at: string;
};

export type AdminJobRunHealthRow = {
  completed_at: string | null;
  error_message: string | null;
  job_name: "fantasy-winner" | "pick-reminders";
  started_at: string;
  status: "degraded" | "failed" | "running" | "succeeded";
  summary: Record<string, unknown>;
};

export type AdminReminderQueueHealth = {
  pending: number;
  permanentFailed: number;
  raceId: number;
  raceName: string;
  reminderType: string;
  retrying: number;
  sent: number;
};

export type AdminReminderPreview = {
  from: string | null;
  html: string;
  missingParticipantCount: number;
  raceId: number;
  raceName: string;
  recipientEmail: string | null;
  reminderType: "2d" | "4h";
  schedule: Array<{
    key: "2d" | "4h";
    label: string;
    sendAt: string;
    sentCount: number;
    status: "due" | "passed" | "scheduled" | "sent";
  }>;
  subject: string;
  text: string;
};

export type AdminAppErrorRow = {
  correlation_id: string;
  error_code: string;
  first_seen_at: string;
  id: number;
  last_seen_at: string;
  occurrence_count: number;
  route: string;
  severity: "warning" | "error" | "critical";
  subsystem: string;
  technical_summary: string;
};

type AdminSystemHealthProps = {
  activeSeasonYear?: number | null;
  capabilities?: AdminCapabilities;
  appErrorInboxReady: boolean;
  appErrorInboxIssue: string | null;
  appErrors: AdminAppErrorRow[];
  auditLog: AdminAuditLogData;
  cleanupTestFlowDataAction: (formData: FormData) => void | Promise<void>;
  currentTime: number;
  emailEnabled: boolean;
  healthContract: {
    healthy: boolean;
    missing: string[];
    version: string;
  } | null;
  jobEvents: AdminJobRunHealthRow[];
  jobRuns: AdminJobRunHealthRow[];
  openAppErrorCount: number;
  reminderRows: AdminReminderHealthRow[];
  resolveAppErrorAction: (formData: FormData) => void | Promise<void>;
  schemaVersion: string | null;
};

const formatHealthTime = (value: string): string =>
  formatLeagueDateTime(value, { dateStyle: "medium", timeStyle: "short" });

export function AdminSystemHealth({
  activeSeasonYear = null,
  capabilities = {items:[],issue:"Admin capability checks are unavailable."},
  appErrorInboxReady,
  appErrorInboxIssue,
  appErrors,
  auditLog,
  cleanupTestFlowDataAction,
  currentTime,
  emailEnabled,
  healthContract,
  jobEvents,
  jobRuns,
  openAppErrorCount,
  reminderRows,
  resolveAppErrorAction,
  schemaVersion
}: AdminSystemHealthProps) {
  const schemaReady = Boolean(
    healthContract?.healthy &&
      healthContract.version === EXPECTED_SCHEMA_VERSION &&
      schemaVersion === EXPECTED_SCHEMA_VERSION
  );
  const schemaIssue = !healthContract
    ? "The database health contract could not be loaded."
    : healthContract.missing.length > 0
      ? `Missing: ${healthContract.missing.join(", ")}.`
      : healthContract.version !== EXPECTED_SCHEMA_VERSION
        ? `The app expects ${EXPECTED_SCHEMA_VERSION}, but the database contract reports ${healthContract.version}.`
        : `The app expects ${EXPECTED_SCHEMA_VERSION}, but database metadata reports ${schemaVersion ?? "no version"}.`;
  const latestJobRunByName = new Map<AdminJobRunHealthRow["job_name"], AdminJobRunHealthRow>();
  jobRuns.forEach((run) => {
    const currentLatest = latestJobRunByName.get(run.job_name);
    if (!currentLatest || Date.parse(run.started_at) > Date.parse(currentLatest.started_at)) {
      latestJobRunByName.set(run.job_name, run);
    }
  });
  const latestJobRuns = Array.from(latestJobRunByName.values()).sort(
    (left, right) => Date.parse(right.started_at) - Date.parse(left.started_at)
  );
  const failedJobCount = latestJobRuns.filter((run) => run.status === "failed").length;
  const degradedJobCount = latestJobRuns.filter((run) => run.status === "degraded").length;
  const heartbeatAgeLimitMs: Record<AdminJobRunHealthRow["job_name"], number> = {
    "fantasy-winner": 3 * 60 * 60 * 1000,
    "pick-reminders": 20 * 60 * 1000
  };
  const expectedJobNames: AdminJobRunHealthRow["job_name"][] = !activeSeasonYear ? [] : emailEnabled
    ? ["fantasy-winner", "pick-reminders"]
    : ["fantasy-winner"];
  const staleJobNames = expectedJobNames.filter((jobName) => {
    const run = latestJobRunByName.get(jobName);
    return (
      !run ||
      !Number.isFinite(Date.parse(run.started_at)) ||
      currentTime - Date.parse(run.started_at) > heartbeatAgeLimitMs[jobName]
    );
  });
  const actionNeeded = Boolean(capabilities.issue) || capabilities.items.some(item=>!item.installed) || !schemaReady || failedJobCount > 0 || degradedJobCount > 0 || staleJobNames.length > 0 || !appErrorInboxReady || openAppErrorCount > 0;

  return (
    <section className="mt-6">
      <AdminWorkspaceHeader
        description="Monitor scheduled jobs, investigate application errors, and review administrative changes."
        meta={
          <StatusChip tone={actionNeeded ? "danger" : "success"}>
            {actionNeeded ? "Action needed" : "System ready"}
          </StatusChip>
        }
        title="System Health"
      />

      <section className="mt-4 rounded-lg border border-slate-200 bg-white p-4">
        <h3 className="font-semibold">Admin capabilities</h3>
        <p className="mt-1 text-sm text-slate-600">These checks confirm the installed controls separately from the base database schema.</p>
        {capabilities.issue ? <CompactNotice tone="warning" className="mt-3">{capabilities.issue}</CompactNotice> : <ul className="mt-3 grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
          {capabilities.items.map(item=><li className="flex min-w-0 flex-wrap justify-between gap-2" key={item.name}><span>{item.name}</span><StatusChip tone={item.installed ? "success" : "warning"}>{item.installed ? "Installed" : "Missing"}</StatusChip></li>)}
        </ul>}
      </section>
      {!activeSeasonYear ? <CompactNotice className="mt-3">The league is between seasons. Scheduled race jobs have no active season to process; past job history remains available below.</CompactNotice> : null}
      <form action={triggerFantasyWinnerJobAction} className="mt-4">
        <ConfirmSubmitButton className={actionControlClassName("secondary")} confirmMessage="Run the fantasy-winner recovery check for races awaiting calculation? Existing manual overrides are preserved." pendingLabel="Checking winners...">Run fantasy winner check now</ConfirmSubmitButton>
      </form>
      {!schemaReady ? (
        <CompactNotice className="mt-4" tone="danger">
          <span className="font-semibold">Database contract needs attention.</span>{" "}
          {schemaIssue}
        </CompactNotice>
      ) : null}

      {!appErrorInboxReady ? (
        <CompactNotice className="mt-3" tone="warning">
          {appErrorInboxIssue ?? "Application error tracking is unavailable."}
        </CompactNotice>
      ) : null}

      {appErrorInboxReady && appErrors.length > 0 ? (
        <section className="mt-5 rounded-lg border border-red-200 bg-white p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="font-semibold text-slate-950">Application errors</h3>
              <p className="mt-1 text-xs leading-5 text-slate-600">
                Repeated occurrences are grouped. Resolve an incident after verifying the affected
                workflow.
              </p>
            </div>
            <StatusChip tone="danger">
              {openAppErrorCount} open
            </StatusChip>
          </div>
          <div className="mt-3 divide-y divide-slate-200 border-y border-slate-200">
            {appErrors.map((event) => (
              <article className="py-3" key={event.id}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusChip tone={event.severity === "warning" ? "warning" : "danger"}>
                        {event.severity}
                      </StatusChip>
                      <span className="text-xs font-semibold text-slate-700">
                        {event.subsystem} · {event.error_code}
                      </span>
                      {event.occurrence_count > 1 ? (
                        <span className="text-xs text-slate-500">
                          {event.occurrence_count} occurrences
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-1 break-words text-sm font-medium text-slate-900">
                      {event.technical_summary}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      {event.route} · Last seen {formatHealthTime(event.last_seen_at)} · Ref {event.correlation_id.slice(0, 8).toUpperCase()}
                    </p>
                  </div>
                  <form action={resolveAppErrorAction}>
                    <input name="event_id" type="hidden" value={event.id} />
                    <SubmitButton
                      className={actionControlClassName("secondary", "min-h-9 px-3 py-1.5 text-xs")}
                      pendingLabel="Resolving..."
                    >
                      Mark resolved
                    </SubmitButton>
                  </form>
                </div>
              </article>
            ))}
          </div>
          {openAppErrorCount > appErrors.length ? (
            <p className="mt-2 text-xs text-slate-500">
              Showing the {appErrors.length} most recent open incidents.
            </p>
          ) : null}
        </section>
      ) : appErrorInboxReady ? (
        <CompactNotice className="mt-4" tone="success">
          No open application errors.
        </CompactNotice>
      ) : null}

      {failedJobCount > 0 ? (
        <CompactNotice className="mt-3" tone="danger">
          {failedJobCount} scheduled job{failedJobCount === 1 ? " has" : "s have"} failed.
          Review Technical details below.
        </CompactNotice>
      ) : null}

      {staleJobNames.length > 0 ? (
        <CompactNotice className="mt-3" tone="warning">
          {staleJobNames.includes("fantasy-winner") ? (
            <span>
              The hourly fantasy-winner recovery job has not checked in within three hours. Race
              result publication still recalculates the winner immediately; verify the Supabase
              fallback cron so a failed calculation can recover automatically.
            </span>
          ) : null}
          {staleJobNames.includes("pick-reminders") ? (
            <span className={staleJobNames.includes("fantasy-winner") ? "mt-1 block" : undefined}>
              The pick-reminder job has not checked in within 20 minutes. Verify the Supabase cron
              before the next reminder delivery window.
            </span>
          ) : null}
        </CompactNotice>
      ) : null}

      <Disclosure
        className="mt-5"
        description="Schema versions, delivery attempts, scheduled jobs, and the admin audit log."
        meta={
          failedJobCount > 0 || degradedJobCount > 0 || staleJobNames.length > 0 ? (
            <StatusChip tone="warning">
              {failedJobCount + degradedJobCount + staleJobNames.length} job issue
              {failedJobCount + degradedJobCount + staleJobNames.length === 1 ? "" : "s"}
            </StatusChip>
          ) : null
        }
        id="technical-details"
        summary="System diagnostics"
        open
      >
        <dl className="grid gap-3 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Schema</dt>
            <dd className="mt-1 break-all font-medium text-slate-900">{schemaVersion ?? "Missing"}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Health contract</dt>
            <dd className="mt-1 font-medium text-slate-900">{healthContract?.version ?? "Unavailable"}</dd>
          </div>
        </dl>

        <div className="mt-5 grid gap-5 border-t border-slate-200 pt-5 lg:grid-cols-2">
          <section>
            <h3 className="font-semibold text-slate-900">Scheduled job heartbeat</h3>
            {latestJobRuns.length === 0 ? (
              <p className="mt-2 text-sm text-amber-700">{activeSeasonYear ? "No cron heartbeat is recorded." : "No job heartbeat is recorded. A fresh race-job heartbeat is not required between seasons."}</p>
            ) : (
              <div className="mt-2 grid gap-2">
                {latestJobRuns.map((run) => (
                  <div className="flex items-start justify-between gap-3 text-sm" key={`${run.job_name}-${run.started_at}`}>
                    <div>
                      <p className="font-medium text-slate-800">{run.job_name}</p>
                      <p className="text-xs text-slate-500">{formatHealthTime(run.started_at)}</p>
                      {run.error_message ? <p className="mt-0.5 line-clamp-2 text-xs text-red-700">{run.error_message}</p> : null}
                    </div>
                    <StatusChip tone={run.status === "failed" ? "danger" : run.status === "degraded" ? "warning" : "neutral"}>
                      {run.status}
                    </StatusChip>
                  </div>
                ))}
              </div>
            )}
            {jobEvents.length > 0 ? (
              <div className="mt-4 border-t border-slate-200 pt-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Recent work and exceptions
                </p>
                <div className="mt-2 grid gap-2">
                  {jobEvents.slice(0, 5).map((run) => (
                    <div
                      className="flex items-start justify-between gap-3 text-sm"
                      key={`event-${run.job_name}-${run.started_at}`}
                    >
                      <div>
                        <p className="font-medium text-slate-800">{run.job_name}</p>
                        <p className="text-xs text-slate-500">{formatHealthTime(run.started_at)}</p>
                        {run.error_message ? (
                          <p className="mt-0.5 line-clamp-2 text-xs text-red-700">
                            {run.error_message}
                          </p>
                        ) : null}
                      </div>
                      <StatusChip
                        tone={
                          run.status === "failed"
                            ? "danger"
                            : run.status === "degraded"
                              ? "warning"
                              : "success"
                        }
                      >
                        {run.status}
                      </StatusChip>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </section>

          <section>
            <h3 className="font-semibold text-slate-900">Recent email attempts</h3>
            {reminderRows.length === 0 ? (
              <p className="mt-2 text-sm text-slate-600">No delivery attempts recorded.</p>
            ) : (
              <div className="mt-2 grid gap-2">
                {reminderRows.slice(0, 6).map((row, index) => (
                  <div className="flex items-start justify-between gap-3 text-sm" key={`${row.updated_at}-${index}`}>
                    <div>
                      <p className="font-medium text-slate-800">{row.reminder_type} · attempt {row.attempt_count}</p>
                      {row.last_error ? <p className="mt-0.5 line-clamp-2 text-xs text-red-700">{row.last_error}</p> : null}
                    </div>
                    <StatusChip tone={row.delivery_status === "failed" ? "danger" : row.delivery_status === "sent" ? "success" : "neutral"}>
                      {row.delivery_status}
                    </StatusChip>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        <AdminAuditLog auditLog={auditLog} />

        <section className="mt-5 border-t border-amber-200 pt-5">
          <h3 className="text-sm font-semibold text-amber-900">Test-data maintenance</h3>
          <p className="mt-1 text-xs text-slate-600">
            Use only after an authorized end-to-end test run creates labeled test-flow records.
          </p>
          <form action={cleanupTestFlowDataAction} className="mt-3">
            <input name="tab" type="hidden" value="health" />
            <ConfirmSubmitButton
              className="rounded-md border border-amber-300 bg-white px-3 py-2 text-sm font-semibold text-amber-800 hover:bg-amber-50"
              confirmMessage="Delete all [TEST FLOW ...] seeded races, test users, and test feedback?"
              data-testid="admin-feedback-cleanup-test-data"
              formNoValidate
              type="submit"
            >
              Cleanup labeled test data
            </ConfirmSubmitButton>
          </form>
        </section>
      </Disclosure>
    </section>
  );
}
