import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { SubmitButton } from "@/components/submit-button";
import {
  ActionLink,
  AdminWorkspaceHeader,
  CompactNotice,
  Disclosure,
  MetricStrip,
  StatusChip,
  actionControlClassName
} from "@/components/ui-primitives";
import { formatLeagueDateTime } from "@/lib/timezone";

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

export type AdminAuditHealthRow = {
  action: string;
  created_at: string;
  entity_type: string;
  summary: string;
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
  activeSeasonName: string | null;
  appErrorInboxReady: boolean;
  appErrorInboxIssue: string | null;
  appErrors: AdminAppErrorRow[];
  auditRows: AdminAuditHealthRow[];
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
  nextRace: {
    expectedPickCount: number;
    fieldFrozen: boolean;
    pickLockAt: string;
    pickCount: number;
    previousResultsStatus: string;
    raceName: string;
    roundLabel: string;
    roundNumber: number;
  } | null;
  openAppErrorCount: number;
  registeredTeamCount: number;
  reminderQueue: AdminReminderQueueHealth | null;
  reminderRows: AdminReminderHealthRow[];
  resolveAppErrorAction: (formData: FormData) => void | Promise<void>;
  retryFailedRemindersAction: (formData: FormData) => void | Promise<void>;
  schemaVersion: string | null;
  smsEnabled: boolean;
};

const EXPECTED_SCHEMA_VERSION = "20260818_recovery_jobs_security_v1";

const formatHealthTime = (value: string): string =>
  formatLeagueDateTime(value, { dateStyle: "medium", timeStyle: "short" });

export function AdminSystemHealth({
  activeSeasonName,
  appErrorInboxReady,
  appErrorInboxIssue,
  appErrors,
  auditRows,
  cleanupTestFlowDataAction,
  currentTime,
  emailEnabled,
  healthContract,
  jobEvents,
  jobRuns,
  nextRace,
  openAppErrorCount,
  registeredTeamCount,
  reminderQueue,
  reminderRows,
  resolveAppErrorAction,
  retryFailedRemindersAction,
  schemaVersion,
  smsEnabled
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
  const expectedJobNames: AdminJobRunHealthRow["job_name"][] = emailEnabled
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
  const permanentReminderFailures = reminderQueue?.permanentFailed ?? 0;
  const previousResultsReady = nextRace?.previousResultsStatus.startsWith("Ready:") ?? false;
  const submissionsComplete = Boolean(
    nextRace && nextRace.expectedPickCount > 0 && nextRace.pickCount >= nextRace.expectedPickCount
  );
  const actionNeeded =
    !schemaReady ||
    !activeSeasonName ||
    failedJobCount > 0 ||
    degradedJobCount > 0 ||
    staleJobNames.length > 0 ||
    !appErrorInboxReady ||
    openAppErrorCount > 0 ||
    Boolean(nextRace && !previousResultsReady) ||
    permanentReminderFailures > 0;
  const raceWeekSteps = [
    {
      detail: activeSeasonName ?? "Activate or create a season.",
      href: "/admin?tab=races",
      label: "Active season",
      ready: Boolean(activeSeasonName)
    },
    {
      detail: nextRace?.fieldFrozen
        ? "The driver field is frozen for this pick window."
        : "Open the form or reminder workflow to freeze the field.",
      href: "/admin?tab=races",
      label: "Race field",
      ready: Boolean(nextRace?.fieldFrozen)
    },
    {
      detail: nextRace?.previousResultsStatus ?? "No upcoming race is scheduled.",
      href: "/admin?tab=results",
      label: "Previous results",
      ready: previousResultsReady || !nextRace
    },
    {
      detail: nextRace
        ? `${nextRace.pickCount}/${nextRace.expectedPickCount} race submissions saved.`
        : "No active pick window.",
      href: "/admin?tab=participants",
      label: "Participant picks",
      ready: submissionsComplete || !nextRace
    },
    {
      detail: emailEnabled
        ? permanentReminderFailures > 0
          ? `${permanentReminderFailures} delivery failure(s) need attention.`
          : "Email delivery is enabled with no permanent failure."
        : "Email delivery is currently disabled.",
      href: "/admin?tab=health#technical-details",
      label: "Reminders",
      ready: emailEnabled && permanentReminderFailures === 0
    }
  ];

  return (
    <section className="mt-6">
      <AdminWorkspaceHeader
        description="A single checklist for picks, reminders, results, and system readiness."
        meta={
          <StatusChip tone={actionNeeded ? "danger" : "success"}>
            {actionNeeded ? "Action needed" : "System ready"}
          </StatusChip>
        }
        title="Race Week Operations"
      />

      <div className="mt-5 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        {raceWeekSteps.map((step, index) => (
          <ActionLink
            className="min-h-0 items-start justify-start gap-3 px-3 py-3 text-left"
            href={step.href}
            key={step.label}
            variant="secondary"
          >
            <span
              className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                step.ready
                  ? "bg-emerald-100 text-emerald-800"
                  : "bg-amber-100 text-amber-800"
              }`}
            >
              {step.ready ? "OK" : index + 1}
            </span>
            <span className="min-w-0">
              <span className="block font-semibold text-slate-950">{step.label}</span>
              <span className="mt-0.5 block text-xs font-normal leading-5 text-slate-600">
                {step.detail}
              </span>
            </span>
          </ActionLink>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <ActionLink href="/admin?tab=results" variant="primary">
          Open race results
        </ActionLink>
        <ActionLink href="/admin?tab=recovery" variant="secondary">
          Create safety backup
        </ActionLink>
      </div>

      <MetricStrip
        className="mt-4 sm:grid-cols-2 lg:grid-cols-4"
        items={[
          { label: "Active season", value: activeSeasonName ?? "None" },
          { label: "Registered teams", value: registeredTeamCount },
          { label: "Pick emails", value: emailEnabled ? "Enabled" : "Disabled" },
          {
            label: "Next submissions",
            value: nextRace ? `${nextRace.pickCount}/${nextRace.expectedPickCount}` : "No race"
          }
        ]}
      />

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
          Missing or stale heartbeat: {staleJobNames.join(", ")}. Verify the Supabase cron job
          before the next race deadline.
        </CompactNotice>
      ) : null}

      <div className="mt-5 grid gap-5 border-y border-slate-200 py-5 lg:grid-cols-2 lg:divide-x lg:divide-slate-200">
        <section className="lg:pr-5">
          <h3 className="font-semibold text-slate-900">Next race</h3>
          <p className="mt-2 text-sm text-slate-700">
            {nextRace
              ? `${nextRace.roundLabel || `R${nextRace.roundNumber}`} · ${nextRace.raceName}`
              : "No upcoming race is scheduled."}
          </p>
          {nextRace ? (
            <>
              <p className="mt-1 text-xs text-slate-500">
                {nextRace.pickCount}/{nextRace.expectedPickCount} submitted
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Locks {formatHealthTime(nextRace.pickLockAt)}
              </p>
              <p className="mt-2 text-sm font-medium text-slate-700">
                {nextRace.previousResultsStatus}
              </p>
            </>
          ) : null}
        </section>

        <section className="lg:pl-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-semibold text-slate-900">Reminder queue</h3>
            {reminderQueue ? (
              <span className="text-xs font-medium text-slate-500">
                {reminderQueue.reminderType}
              </span>
            ) : null}
          </div>
          {reminderQueue ? (
            <>
              <p className="mt-1 truncate text-xs text-slate-500">{reminderQueue.raceName}</p>
              <dl className="mt-3 grid grid-cols-4 gap-2 text-sm">
                <div><dt className="text-xs text-slate-500">Sent</dt><dd className="font-semibold text-emerald-700">{reminderQueue.sent}</dd></div>
                <div><dt className="text-xs text-slate-500">Pending</dt><dd className="font-semibold">{reminderQueue.pending}</dd></div>
                <div><dt className="text-xs text-slate-500">Retrying</dt><dd className="font-semibold text-amber-700">{reminderQueue.retrying}</dd></div>
                <div><dt className="text-xs text-slate-500">Failed</dt><dd className="font-semibold text-red-700">{permanentReminderFailures}</dd></div>
              </dl>
              {permanentReminderFailures > 0 ? (
                <form action={retryFailedRemindersAction} className="mt-3">
                  <input name="race_id" type="hidden" value={reminderQueue.raceId} />
                  <input name="reminder_type" type="hidden" value={reminderQueue.reminderType} />
                  <SubmitButton
                    className={actionControlClassName("secondary", "text-red-700")}
                    pendingLabel="Queueing..."
                  >
                    Retry failed emails
                  </SubmitButton>
                </form>
              ) : null}
            </>
          ) : (
            <p className="mt-2 text-sm text-slate-600">No reminder window is currently due.</p>
          )}
        </section>
      </div>

      <Disclosure
        className="mt-5"
        description="Schema versions, delivery attempts, scheduled jobs, and recent admin events."
        meta={
          failedJobCount > 0 || degradedJobCount > 0 || staleJobNames.length > 0 ? (
            <StatusChip tone="warning">
              {failedJobCount + degradedJobCount + staleJobNames.length} job issue
              {failedJobCount + degradedJobCount + staleJobNames.length === 1 ? "" : "s"}
            </StatusChip>
          ) : null
        }
        id="technical-details"
        summary="Technical details"
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
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">SMS</dt>
            <dd className="mt-1 font-medium text-slate-900">{smsEnabled ? "Enabled" : "Not enabled"}</dd>
          </div>
        </dl>

        <div className="mt-5 grid gap-5 border-t border-slate-200 pt-5 lg:grid-cols-2">
          <section>
            <h3 className="font-semibold text-slate-900">Scheduled job heartbeat</h3>
            {latestJobRuns.length === 0 ? (
              <p className="mt-2 text-sm text-amber-700">No cron heartbeat is recorded.</p>
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

        <section className="mt-5 border-t border-slate-200 pt-5">
          <h3 className="font-semibold text-slate-900">Recent admin changes</h3>
          {auditRows.length === 0 ? (
            <p className="mt-2 text-sm text-slate-600">No hardened admin events recorded yet.</p>
          ) : (
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {auditRows.slice(0, 6).map((event, index) => (
                <div className="text-sm" key={`${event.created_at}-${index}`}>
                  <p className="font-medium text-slate-800">{event.summary}</p>
                  <p className="text-xs text-slate-500">
                    {event.entity_type} · {event.action} · {formatHealthTime(event.created_at)}
                  </p>
                </div>
              ))}
            </div>
          )}
        </section>

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
