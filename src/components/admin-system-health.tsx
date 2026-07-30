import { SubmitButton } from "@/components/submit-button";
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

const EXPECTED_SCHEMA_VERSION = "20260729_weekly_scale_v1";

export function AdminSystemHealth({
  activeSeasonName,
  auditRows,
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
  return (
    <section className="mt-6 border-y border-slate-200 py-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-slate-900">System Health</h2>
          <p className="mt-1 text-sm text-slate-600">
            Current season readiness, notification state, and deployment contract.
          </p>
        </div>
        <span
          className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${
            healthContract?.healthy && schemaVersion === EXPECTED_SCHEMA_VERSION
              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
              : "border-red-200 bg-red-50 text-red-700"
          }`}
        >
          {schemaVersion ? `Schema ${schemaVersion}` : "Schema update required"}
        </span>
      </div>

      <dl className="mt-5 grid gap-x-6 gap-y-4 border-t border-slate-200 pt-4 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Active season
          </dt>
          <dd className="mt-1 font-semibold text-slate-900">{activeSeasonName ?? "None"}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Registered teams
          </dt>
          <dd className="mt-1 font-semibold text-slate-900">{registeredTeamCount}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Pick emails
          </dt>
          <dd className="mt-1 font-semibold text-slate-900">
            {emailEnabled ? "Enabled" : "Disabled"}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            SMS delivery
          </dt>
          <dd className="mt-1 font-semibold text-slate-900">
            {smsEnabled ? "Enabled" : "Disabled"}
          </dd>
        </div>
      </dl>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <div className="border-t border-slate-200 pt-4">
          <h3 className="font-semibold text-slate-900">Next race</h3>
          <p className="mt-2 text-sm text-slate-700">
            {nextRace
              ? `${nextRace.roundLabel || `R${nextRace.roundNumber}`} / ${nextRace.raceName}`
              : "No upcoming race is scheduled."}
          </p>
          {nextRace ? (
            <p className="mt-1 text-xs text-slate-500">
              {nextRace.pickCount}/{nextRace.expectedPickCount} submissions /{" "}
              {nextRace.previousResultsStatus}
            </p>
          ) : null}
        </div>

        <div className="border-t border-slate-200 pt-4">
          <h3 className="font-semibold text-slate-900">Reminder delivery queue</h3>
          {reminderQueue ? (
            <>
              <p className="mt-1 text-xs text-slate-500">
                {reminderQueue.raceName} / {reminderQueue.reminderType}
              </p>
              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-4">
                <div>
                  <dt className="text-xs font-medium text-slate-500">Sent</dt>
                  <dd className="font-semibold text-emerald-700">{reminderQueue.sent}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-slate-500">Pending</dt>
                  <dd className="font-semibold text-slate-900">{reminderQueue.pending}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-slate-500">Retrying</dt>
                  <dd className="font-semibold text-amber-700">{reminderQueue.retrying}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-slate-500">Failed</dt>
                  <dd className="font-semibold text-red-700">
                    {reminderQueue.permanentFailed}
                  </dd>
                </div>
              </dl>
              {reminderQueue.permanentFailed > 0 ? (
                <form action={retryFailedRemindersAction} className="mt-3">
                  <input name="race_id" type="hidden" value={reminderQueue.raceId} />
                  <input
                    name="reminder_type"
                    type="hidden"
                    value={reminderQueue.reminderType}
                  />
                  <SubmitButton
                    className="rounded-md border border-red-200 bg-white px-3 py-2 text-xs font-semibold text-red-700 hover:bg-red-50"
                    pendingLabel="Queueing..."
                  >
                    Retry permanent failures
                  </SubmitButton>
                </form>
              ) : null}
            </>
          ) : (
            <p className="mt-2 text-sm text-slate-600">
              No reminder window is currently due.
            </p>
          )}

          <h4 className="mt-4 border-t border-slate-200 pt-3 text-sm font-semibold text-slate-800">
            Recent attempts
          </h4>
          {reminderRows.length === 0 ? (
            <p className="mt-2 text-sm text-slate-600">No reminder delivery attempts recorded.</p>
          ) : (
            <div className="mt-2 grid gap-2">
              {reminderRows.slice(0, 5).map((row, index) => (
                <div
                  className="flex items-start justify-between gap-3 text-sm"
                  key={`${row.updated_at}-${index}`}
                >
                  <div>
                    <p className="font-medium text-slate-800">
                      {row.reminder_type} / attempt {row.attempt_count}
                    </p>
                    {row.last_error ? (
                      <p className="mt-0.5 line-clamp-2 text-xs text-red-700">{row.last_error}</p>
                    ) : null}
                  </div>
                  <span className="shrink-0 text-xs font-semibold uppercase text-slate-600">
                    {row.delivery_status}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="mt-5 grid gap-5 border-t border-slate-200 pt-4 lg:grid-cols-2">
        <div>
          <h3 className="font-semibold text-slate-900">Scheduled job heartbeat</h3>
          {jobRuns.length === 0 ? (
            <p className="mt-2 text-sm text-amber-700">
              No cron heartbeat is recorded. Run each configured cron once after applying the
              operations migration.
            </p>
          ) : (
            <div className="mt-2 grid gap-2">
              {jobRuns.slice(0, 4).map((run) => (
                <div
                  className="flex items-start justify-between gap-3 text-sm"
                  key={`${run.job_name}-${run.started_at}`}
                >
                  <div>
                    <p className="font-medium text-slate-800">{run.job_name}</p>
                    <p className="text-xs text-slate-500">
                      {formatLeagueDateTime(run.started_at, {
                        dateStyle: "medium",
                        timeStyle: "short"
                      })}
                    </p>
                    {run.error_message ? (
                      <p
                        className={`mt-0.5 line-clamp-2 text-xs ${
                          run.status === "degraded" ? "text-amber-700" : "text-red-700"
                        }`}
                      >
                        {run.error_message}
                      </p>
                    ) : null}
                  </div>
                  <span
                    className={`shrink-0 text-xs font-semibold uppercase ${
                      run.status === "failed"
                        ? "text-red-700"
                        : run.status === "degraded"
                          ? "text-amber-700"
                          : "text-slate-600"
                    }`}
                  >
                    {run.status}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div>
          <h3 className="font-semibold text-slate-900">Recent admin changes</h3>
          {auditRows.length === 0 ? (
            <p className="mt-2 text-sm text-slate-600">No hardened admin events recorded yet.</p>
          ) : (
            <div className="mt-2 grid gap-2">
              {auditRows.slice(0, 5).map((event, index) => (
                <div className="text-sm" key={`${event.created_at}-${index}`}>
                  <p className="font-medium text-slate-800">{event.summary}</p>
                  <p className="text-xs text-slate-500">
                    {event.entity_type} / {event.action} /{" "}
                    {formatLeagueDateTime(event.created_at, {
                      dateStyle: "medium",
                      timeStyle: "short"
                    })}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {!healthContract?.healthy ? (
        <p className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          Database contract is incomplete
          {healthContract?.missing.length
            ? `: ${healthContract.missing.join(", ")}`
            : ". Apply the latest operations migration."}
        </p>
      ) : null}
    </section>
  );
}
