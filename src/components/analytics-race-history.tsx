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

export function AnalyticsRaceHistory({ rows }: Props) {
  return (
    <details className="mt-6 border-y border-slate-200 bg-white">
      <summary className="cursor-pointer px-1 py-4 marker:text-slate-400 sm:px-2">
        <span className="ml-2 font-semibold text-slate-900">Race-by-race history</span>
        <span className="ml-2 text-sm text-slate-500">{rows.length} completed races</span>
      </summary>

      <div className="border-t border-slate-200 py-3 md:hidden">
        {rows.map((row) => (
          <details className="border-b border-slate-100 px-2 py-2 last:border-b-0" key={row.raceId}>
            <summary className="cursor-pointer list-none marker:hidden">
              <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-slate-900">{row.raceName}</p>
                  <p className="text-xs text-slate-500">{formatRaceDate(row.raceDate)}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold tabular-nums text-slate-900">{row.weeklyPoints}</p>
                  <p className="text-[10px] uppercase text-slate-500">Points</p>
                </div>
                <div className="w-12 text-right">
                  <p className="text-sm font-semibold tabular-nums text-slate-900">
                    {row.weeklyFinish ?? "-"}/{row.fieldSize}
                  </p>
                  <p className="text-[10px] uppercase text-slate-500">Finish</p>
                </div>
              </div>
            </summary>
            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-slate-100 pt-3 text-xs">
              <div><dt className="text-slate-500">Vs league average</dt><dd className="font-semibold text-slate-800">{formatSigned(row.pointsVsRaceAverage)}</dd></div>
              <div><dt className="text-slate-500">Season total</dt><dd className="font-semibold text-slate-800">{row.cumulativePoints}</dd></div>
              <div><dt className="text-slate-500">Scored as</dt><dd className="font-semibold text-slate-800">{row.submittedPick ? "Submitted picks" : "Lowest fallback"}</dd></div>
              <div><dt className="text-slate-500">Speed guess</dt><dd className="font-semibold text-slate-800">{formatSpeed(row.averageSpeedGuess)}</dd></div>
              <div><dt className="text-slate-500">Official speed</dt><dd className="font-semibold text-slate-800">{formatSpeed(row.officialRaceAverageSpeed)}</dd></div>
              <div><dt className="text-slate-500">Tiebreak delta</dt><dd className="font-semibold text-slate-800">{formatSpeed(row.tiebreakDelta)}</dd></div>
            </dl>
          </details>
        ))}
      </div>

      <div className="hidden overflow-x-auto border-t border-slate-200 md:block">
        <table className="min-w-full text-left text-sm">
          <caption className="sr-only">Race-by-race personal analytics</caption>
          <thead className="ui-table-head bg-slate-50 text-slate-700">
            <tr>
              <th className="px-3 py-2 font-semibold">Race</th>
              <th className="px-3 py-2 text-right font-semibold">Finish</th>
              <th className="px-3 py-2 text-right font-semibold">Points</th>
              <th className="px-3 py-2 text-right font-semibold">Vs Avg</th>
              <th className="px-3 py-2 text-right font-semibold">Total</th>
              <th className="px-3 py-2 font-semibold">Scored As</th>
              <th className="px-3 py-2 text-right font-semibold">Guess</th>
              <th className="px-3 py-2 text-right font-semibold">Official</th>
              <th className="px-3 py-2 text-right font-semibold">Delta</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr className="border-t border-slate-200" key={row.raceId}>
                <td className="px-3 py-2"><div className="font-medium text-slate-900">{row.raceName}</div><div className="text-xs text-slate-500">{formatRaceDate(row.raceDate)}</div></td>
                <td className="px-3 py-2 text-right tabular-nums">{row.weeklyFinish ?? "-"}/{row.fieldSize}</td>
                <td className="px-3 py-2 text-right font-semibold tabular-nums">{row.weeklyPoints}</td>
                <td className="px-3 py-2 text-right font-medium tabular-nums">{formatSigned(row.pointsVsRaceAverage)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{row.cumulativePoints}</td>
                <td className="px-3 py-2 text-xs font-medium">{row.submittedPick ? "Submitted" : "Lowest fallback"}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatSpeed(row.averageSpeedGuess)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatSpeed(row.officialRaceAverageSpeed)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatSpeed(row.tiebreakDelta)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
