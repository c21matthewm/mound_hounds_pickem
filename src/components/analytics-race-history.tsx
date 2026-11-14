import { formatLeagueDateTime } from "@/lib/timezone";

type RaceRow = {
  averageSpeedGuess: number | null;
  cumulativePoints: number;
  fieldSize: number;
  officialRaceAverageSpeed: number | null;
  pointsVsRaceAverage: number;
  raceDate: string;
  raceId: number;
  raceName: string;
  submittedPick: boolean;
  tiebreakDelta: number | null;
  weeklyFinish: number | null;
  weeklyPoints: number;
};

type Props = {
  rows: RaceRow[];
};

const formatRaceDate = (value: string): string =>
  formatLeagueDateTime(value, { dateStyle: "medium" });

const formatSpeed = (value: number | null): string =>
  value === null ? "-" : value.toFixed(3);

const formatSigned = (value: number): string => `${value >= 0 ? "+" : ""}${value.toFixed(1)}`;

function RaceHistoryRow({ row }: { row: RaceRow }) {
  return (
    <details className="group border-b border-slate-100 px-3 last:border-b-0 sm:px-4">
      <summary className="min-h-12 cursor-pointer list-none py-2 [&::-webkit-details-marker]:hidden">
        <div className="grid grid-cols-[minmax(0,1fr)_auto_auto_auto] items-center gap-2 sm:gap-3">
          <div className="min-w-0">
            <p className="[overflow-wrap:anywhere] text-sm font-semibold text-slate-900">{row.raceName}</p>
            <p className="text-xs text-slate-500">{formatRaceDate(row.raceDate)}</p>
          </div>
          <div className="text-right">
            <p className="text-sm font-semibold tabular-nums text-slate-900">{row.weeklyPoints}</p>
            <p className="text-[10px] uppercase text-slate-500">Points</p>
          </div>
          <div className="w-12 text-right">
            <p className="text-sm font-semibold tabular-nums text-slate-900">
              {row.weeklyFinish === null ? "—" : row.weeklyFinish + "/" + row.fieldSize}
            </p>
            <p className="text-[10px] uppercase text-slate-500">Finish</p>
          </div>
          <span aria-hidden="true" className="text-slate-600 group-open:rotate-180">⌄</span>
        </div>
      </summary>
      <dl className="grid grid-cols-2 pb-3 sm:grid-cols-3 gap-x-4 gap-y-2 border-t border-slate-100 pt-3 text-xs">
        <div><dt className="text-slate-500">Vs league average</dt><dd className="font-semibold text-slate-800">{formatSigned(row.pointsVsRaceAverage)}</dd></div>
        <div><dt className="text-slate-500">Season total</dt><dd className="font-semibold text-slate-800">{row.cumulativePoints}</dd></div>
        <div><dt className="text-slate-500">Scored as</dt><dd className="font-semibold text-slate-800">{row.submittedPick ? "Submitted picks" : "Lowest fallback"}</dd></div>
        <div><dt className="text-slate-500">Speed guess</dt><dd className="font-semibold text-slate-800">{formatSpeed(row.averageSpeedGuess)}</dd></div>
        <div><dt className="text-slate-500">Official speed</dt><dd className="font-semibold text-slate-800">{formatSpeed(row.officialRaceAverageSpeed)}</dd></div>
        <div><dt className="text-slate-500">Tiebreak delta</dt><dd className="font-semibold text-slate-800">{formatSpeed(row.tiebreakDelta)}</dd></div>
      </dl>
    </details>
  );
}

export function AnalyticsRaceHistory({ rows }: Props) {
  const newestFirst = [...rows].reverse();
  const recentRows = newestFirst.slice(0, 3);
  const olderRows = newestFirst.slice(3);

  return (
    <section className="ui-panel mt-5 overflow-hidden rounded-lg border border-slate-200 bg-white" aria-labelledby="race-history-title">
      <div className="border-b border-slate-200 px-3 py-3 sm:px-4">
        <h3 className="font-semibold text-slate-950" id="race-history-title">Recent results</h3>
      </div>
      {recentRows.map(row => <RaceHistoryRow key={row.raceId} row={row} />)}
      {olderRows.length > 0 ? (
        <details className="border-t border-slate-200">
          <summary className="min-h-11 cursor-pointer px-3 py-3 text-sm font-semibold text-blue-800 sm:px-4">
            Older results ({olderRows.length})
          </summary>
          <div className="border-t border-slate-200">
            {olderRows.map(row => <RaceHistoryRow key={row.raceId} row={row} />)}
          </div>
        </details>
      ) : null}
    </section>
  );
}
