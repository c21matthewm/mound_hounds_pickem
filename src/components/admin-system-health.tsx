import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { SubmitButton } from "@/components/submit-button";
import {
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

type AdminSystemHealthProps = {
  activeSeasonName: string | null;
  auditRows: AdminAuditHealthRow[];
  cleanupTestFlowDataAction: (formData: FormData) => void | Promise<void>;
  emailEnabled: boolean;
  healthContract: {
    healthy: boolean;
    missing: string[];
    version: string;
  } | null;
  jobRuns: AdminJobRunHealthRow[];
  nextRace: {
    expectedPickCount: number;
    pickCount: number;
    previousResultsStatus: string;
    raceName: string;
    roundLabel: string;
    roundNumber: number;
  } | null;
  registeredTeamCount: number;
  reminderQueue: AdminReminderQueueHealth | null;
  reminderRows: AdminReminderHealthRow[];
  retryFailedRemindersAction: (formData: FormData) => void | Promise<void>;
  schemaVersion: string | null;
  smsEnabled: boolean;
};

const EXPECTED_SCHEMA_VERSION = "20260730_atomic_picks_recovery_v1";

const formatHealthTime = (value: string): string =>
  formatLeagueDateTime(value, { dateStyle: "medium", timeStyle: "short" });

export function AdminSystemHealth({
  activeSeasonName,
  auditRows,
  cleanupTestFlowDataAction,
  emailEnabled,
  healthContract,
  jobRuns,
  nextRace,
  registeredTeamCount,
  reminderQueue,
  reminderRows,
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
  const permanentReminderFailures = reminderQueue?.permanentFailed ?? 0;
  const actionNeeded = !schemaReady || failedJobCount > 0 || permanentReminderFailures > 0;

  return (
    <section className="mt-6">
      <AdminWorkspaceHeader
        description="Current-season readiness and exceptions that need attention."
        meta={
          <StatusChip tone={actionNeeded ? "danger" : "success"}>
            {actionNeeded ? "Action needed" : "System ready"}
          </StatusChip>
        }
        title="System Health"
      />

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

      {failedJobCount > 0 ? (
        <CompactNotice className="mt-3" tone="danger">
          {failedJobCount} scheduled job{failedJobCount === 1 ? " has" : "s have"} failed.
          Review Technical details below.
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
          failedJobCount > 0 || degradedJobCount > 0 ? (
            <StatusChip tone="warning">
              {failedJobCount + degradedJobCount} job exception
              {failedJobCount + degradedJobCount === 1 ? "" : "s"}
            </StatusChip>
          ) : null
        }
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
