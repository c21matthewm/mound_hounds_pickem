"use client";

type Props = {
  selectedYear: number;
  years: number[];
};

export function HallOfFameYearSelect({ selectedYear, years }: Props) {
  return (
    <form action="/leaderboard" method="get">
      <input name="tab" type="hidden" value="hall" />
      <label className="block">
        <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">
          Season
        </span>
        <select
          className="rounded-md ui-control-border border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-900"
          defaultValue={String(selectedYear)}
          name="year"
          onChange={(event) => event.currentTarget.form?.requestSubmit()}
        >
          {years.map((year) => (
            <option key={year} value={year}>
              {year}
            </option>
          ))}
        </select>
      </label>
    </form>
  );
}
