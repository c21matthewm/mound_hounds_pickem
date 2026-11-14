import { ActionLink } from "@/components/ui-primitives";
import { formatLeagueDateTime } from "@/lib/timezone";

type SavedPickItem = {
  driverName: string;
  groupNumber: number;
};

type Props = {
  latestSavedAt: string | null;
  lockedRaceId?: number;
  savedAverageSpeed: string | null;
  savedPicks: SavedPickItem[];
};

export function PickSubmissionSnapshot({
  latestSavedAt,
  lockedRaceId,
  savedAverageSpeed,
  savedPicks
}: Props) {
  const latestSavedText = latestSavedAt
    ? formatLeagueDateTime(latestSavedAt, { dateStyle: "medium", timeStyle: "short" })
    : null;
  const isLocked = lockedRaceId !== undefined;
  const driverList = (
    <ul className="mt-2 grid gap-1.5 sm:grid-cols-2" aria-label="Saved drivers">
      {savedPicks.map((item) => (
        <li key={item.groupNumber} className="flex min-w-0 items-baseline gap-2 rounded-md ui-panel-muted border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-sm">
          <span className="shrink-0 text-xs font-semibold text-slate-600">G{item.groupNumber}</span>
          <span className="min-w-0 font-medium text-slate-900 [overflow-wrap:anywhere]">{item.driverName}</span>
        </li>
      ))}
    </ul>
  );

  if (isLocked) {
    return (
      <section className="ui-panel mt-5 rounded-lg border border-slate-200 bg-white p-4 sm:p-5" aria-labelledby="locked-submission-title">
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <div>
            <h3 className="text-lg font-semibold text-slate-950" id="locked-submission-title">
              {latestSavedText ? "Picks saved and locked" : "No picks submitted"}
            </h3>
            <p className="mt-1 text-sm text-slate-600">
              {latestSavedText ? "Saved " + latestSavedText : "No picks were submitted before the deadline."}
            </p>
          </div>
          {savedAverageSpeed !== null ? (
            <dl>
              <dt className="text-xs font-semibold text-slate-600">Average speed guess</dt>
              <dd className="text-sm font-semibold tabular-nums text-slate-950">{savedAverageSpeed} MPH</dd>
            </dl>
          ) : null}
        </div>
        {savedPicks.length > 0 ? driverList : null}
        <ActionLink className="mt-4" href={"/leaderboard?tab=picks&race_id=" + lockedRaceId} variant="secondary">
          View Picks by Race
        </ActionLink>
      </section>
    );
  }

  return (
    <section className="mt-5 border-y border-slate-200 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-slate-900">Saved submission</h3>
          <p className="mt-0.5 text-xs text-slate-500">{latestSavedText ?? "No submission yet"}</p>
        </div>
        <dl className="flex items-center gap-4 text-right">
          <div>
            <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              Groups
            </dt>
            <dd className="text-sm font-semibold text-slate-900">{savedPicks.length}</dd>
          </div>
          <div>
            <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              Avg Speed (MPH)
            </dt>
            <dd className="text-sm font-semibold text-slate-900">
              {savedAverageSpeed ?? "-"}
            </dd>
          </div>
        </dl>
      </div>

      {savedPicks.length > 0 ? (
        <details className="mt-2">
          <summary className="w-fit cursor-pointer text-xs font-semibold text-blue-800">
            View saved drivers
          </summary>
          {driverList}
        </details>
      ) : (
        <p className="mt-2 text-xs text-amber-800">
          No picks are saved yet. Picks become official only after you press Save.
        </p>
      )}
    </section>
  );
}
