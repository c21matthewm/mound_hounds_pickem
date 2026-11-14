import { LeaderboardViewSelect } from "@/components/leaderboard-view-select";

type Props = {
  selectedYear: number;
  years: number[];
};

export function HallOfFameYearSelect({ selectedYear, years }: Props) {
  return (
    <div className="min-w-0">
      <label
        className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600"
        htmlFor="leaderboard-year-select"
      >
        Season
      </label>
      <LeaderboardViewSelect
        className="min-h-11 max-w-full rounded-md ui-control-border border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-900"
        id="leaderboard-year-select"
        name="year"
        tab="hall"
        value={String(selectedYear)}
      >
        {years.map((year) => (
          <option key={year} value={year}>
            {year}
          </option>
        ))}
      </LeaderboardViewSelect>
    </div>
  );
}
