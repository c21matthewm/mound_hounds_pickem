export type AdminReminderHealthRow = {
  attempt_count: number;
  delivery_status: "failed" | "pending" | "sent";
  last_error: string | null;
  reminder_type: string;
  updated_at: string;
};

type AdminSystemHealthProps = {
  activeSeasonName: string | null;
  emailEnabled: boolean;
  nextRace: {
    pickCount: number;
    previousResultsStatus: string;
    raceName: string;
    roundNumber: number;
  } | null;
  registeredTeamCount: number;
  reminderRows: AdminReminderHealthRow[];
  schemaVersion: string | null;
  smsEnabled: boolean;
};

const EXPECTED_SCHEMA_VERSION = "20260718_season_enrollment_v1";

export function AdminSystemHealth({
  activeSeasonName,
  emailEnabled,
  nextRace,
  registeredTeamCount,
  reminderRows,
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
            schemaVersion === EXPECTED_SCHEMA_VERSION
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
            {nextRace ? `R${nextRace.roundNumber} / ${nextRace.raceName}` : "No upcoming race is scheduled."}
          </p>
          {nextRace ? (
            <p className="mt-1 text-xs text-slate-500">
              {nextRace.pickCount} submitted team{nextRace.pickCount === 1 ? "" : "s"} / {nextRace.previousResultsStatus}
            </p>
          ) : null}
        </div>

        <div className="border-t border-slate-200 pt-4">
          <h3 className="font-semibold text-slate-900">Recent reminder delivery</h3>
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
    </section>
  );
}
