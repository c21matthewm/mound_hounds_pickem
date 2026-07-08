"use client";

import { useMemo, useState } from "react";
import {
  compareNullableNumber,
  compareText,
  numericMatch,
  sortIndicator,
  textMatch,
  type SortDirection
} from "@/lib/table-utils";

export type StandingsTableRaceColumn = {
  raceId: number;
  raceName: string;
};

export type StandingsTableRow = {
  change: number;
  currentStanding: number;
  racePointsByRaceId: Record<number, number>;
  teamName: string;
  totalPoints: number;
  userId: string;
};

type Props = {
  raceColumns: StandingsTableRaceColumn[];
  rows: StandingsTableRow[];
};

type BaseSortKey = "change" | "currentStanding" | "teamName" | "totalPoints";
type SortKey = BaseSortKey | `race-${number}`;
type ColumnFilters = Record<string, string>;

const defaultSortDirection = (key: SortKey): SortDirection => {
  if (key === "teamName" || key === "currentStanding") {
    return "asc";
  }

  return "desc";
};

const filterInputClassName =
  "w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-[11px] leading-tight text-slate-700 placeholder:text-slate-400 focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500";

const createDefaultFilters = (raceColumns: StandingsTableRaceColumn[]): ColumnFilters => {
  const defaults: ColumnFilters = {
    change: "",
    currentStanding: "",
    teamName: "",
    totalPoints: ""
  };

  raceColumns.forEach((column) => {
    defaults[`race-${column.raceId}`] = "";
  });

  return defaults;
};

const formatChange = (value: number): string => {
  if (value > 0) {
    return `+${value}`;
  }

  return String(value);
};

const changeClassName = (value: number): string => {
  if (value > 0) {
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  }
  if (value < 0) {
    return "border-amber-200 bg-amber-50 text-amber-700";
  }

  return "border-slate-200 bg-slate-50 text-slate-600";
};

export function StandingsTable({ raceColumns, rows }: Props) {
  const defaultFilters = useMemo(() => createDefaultFilters(raceColumns), [raceColumns]);
  const [filters, setFilters] = useState<ColumnFilters>(defaultFilters);
  const [showFilters, setShowFilters] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("currentStanding");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");

  const onSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDirection((previous) => (previous === "asc" ? "desc" : "asc"));
      return;
    }

    setSortKey(key);
    setSortDirection(defaultSortDirection(key));
  };

  const updateFilter = (key: SortKey, value: string) => {
    setFilters((previous) => ({ ...previous, [key]: value }));
  };

  const resetView = () => {
    setFilters(createDefaultFilters(raceColumns));
    setSortKey("currentStanding");
    setSortDirection("asc");
  };

  const filteredAndSortedRows = useMemo(() => {
    const filtered = rows.filter((row) => {
      if (
        !numericMatch(row.change, filters.change ?? "") ||
        !numericMatch(row.currentStanding, filters.currentStanding ?? "") ||
        !textMatch(row.teamName, filters.teamName ?? "") ||
        !numericMatch(row.totalPoints, filters.totalPoints ?? "")
      ) {
        return false;
      }

      for (const raceColumn of raceColumns) {
        const raceFilterKey = `race-${raceColumn.raceId}`;
        const raceFilter = filters[raceFilterKey] ?? "";
        if (!numericMatch(row.racePointsByRaceId[raceColumn.raceId] ?? 0, raceFilter)) {
          return false;
        }
      }

      return true;
    });

    return [...filtered].sort((a, b) => {
      if (sortKey === "change") {
        return compareNullableNumber(a.change, b.change, sortDirection);
      }
      if (sortKey === "currentStanding") {
        return compareNullableNumber(a.currentStanding, b.currentStanding, sortDirection);
      }
      if (sortKey === "teamName") {
        return compareText(a.teamName, b.teamName, sortDirection);
      }
      if (sortKey === "totalPoints") {
        return compareNullableNumber(a.totalPoints, b.totalPoints, sortDirection);
      }
      if (sortKey.startsWith("race-")) {
        const raceId = Number(sortKey.replace("race-", ""));
        const aPoints = a.racePointsByRaceId[raceId] ?? 0;
        const bPoints = b.racePointsByRaceId[raceId] ?? 0;
        return compareNullableNumber(aPoints, bPoints, sortDirection);
      }

      return 0;
    });
  }, [filters, raceColumns, rows, sortDirection, sortKey]);

  return (
    <section
      className="mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
      data-testid="standings-table"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-gradient-to-r from-slate-950 to-slate-800 px-4 py-3 text-white">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide">Season Standings</h2>
          <p className="mt-1 text-xs text-slate-300">
            Showing <span className="font-semibold text-white">{filteredAndSortedRows.length}</span>{" "}
            of {rows.length} teams. Filters only change your view.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            className="rounded-md border border-white/25 bg-white/10 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/20"
            data-testid="standings-filter-toggle"
            onClick={() => setShowFilters((previous) => !previous)}
            type="button"
          >
            {showFilters ? "Hide filters" : "Advanced filters"}
          </button>
          <button
            className="rounded-md border border-white/25 bg-white/10 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/20"
            data-testid="standings-reset"
            onClick={resetView}
            type="button"
          >
            Reset view
          </button>
        </div>
      </div>

      <div className="divide-y divide-slate-200 md:hidden">
        {filteredAndSortedRows.length === 0 ? (
          <p className="px-4 py-4 text-sm text-slate-600">No rows match your current filters.</p>
        ) : (
          filteredAndSortedRows.map((row) => {
            const recentRaceColumns = raceColumns.slice(-3).reverse();

            return (
              <article key={`mobile-standings-${row.userId}`} className="px-3 py-2.5">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                      Rank #{row.currentStanding}
                    </p>
                    <h3 className="truncate text-sm font-semibold text-slate-900">
                      {row.teamName}
                    </h3>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-base font-semibold text-slate-900">{row.totalPoints}</p>
                    <p className="text-[11px] text-slate-500">pts</p>
                  </div>
                </div>
                <div className="mt-2 grid gap-1">
                  {recentRaceColumns.map((race) => (
                    <div
                      key={`mobile-standings-${row.userId}-${race.raceId}`}
                      className="flex items-center justify-between gap-2 rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-xs text-slate-700"
                      title={race.raceName}
                    >
                      <span className="truncate">{race.raceName}</span>
                      <span className="font-semibold text-slate-900">
                        {row.racePointsByRaceId[race.raceId] ?? 0}
                      </span>
                    </div>
                  ))}
                </div>
              </article>
            );
          })
        )}
      </div>

      <div className="hidden overflow-x-auto md:block">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-slate-50 text-slate-700">
            <tr>
              <th className="px-3 py-2 font-semibold">
                <button className="inline-flex items-center gap-1" onClick={() => onSort("change")} type="button">
                  Change {sortIndicator("change", sortKey, sortDirection)}
                </button>
              </th>
              <th className="px-3 py-2 font-semibold">
                <button
                  className="inline-flex items-center gap-1"
                  onClick={() => onSort("currentStanding")}
                  type="button"
                >
                  Current Rank {sortIndicator("currentStanding", sortKey, sortDirection)}
                </button>
              </th>
              <th className="px-3 py-2 font-semibold">
                <button className="inline-flex items-center gap-1" onClick={() => onSort("teamName")} type="button">
                  Team {sortIndicator("teamName", sortKey, sortDirection)}
                </button>
              </th>
              <th className="px-3 py-2 font-semibold">
                <button
                  className="inline-flex items-center gap-1"
                  data-testid="standings-sort-total"
                  onClick={() => onSort("totalPoints")}
                  type="button"
                >
                  Total Points {sortIndicator("totalPoints", sortKey, sortDirection)}
                </button>
              </th>
              {raceColumns.map((race) => (
                <th key={race.raceId} className="px-3 py-2 font-semibold">
                  <button
                    className="inline-flex items-center gap-1"
                    onClick={() => onSort(`race-${race.raceId}`)}
                    type="button"
                  >
                    {race.raceName} {sortIndicator(`race-${race.raceId}`, sortKey, sortDirection)}
                  </button>
                </th>
              ))}
            </tr>
            {showFilters ? (
              <tr>
                <th className="px-3 py-2">
                  <input
                    className={filterInputClassName}
                    onChange={(event) => updateFilter("change", event.target.value)}
                    placeholder=">=1"
                    type="text"
                    value={filters.change ?? ""}
                  />
                </th>
                <th className="px-3 py-2">
                  <input
                    className={filterInputClassName}
                    onChange={(event) => updateFilter("currentStanding", event.target.value)}
                    placeholder="<=5"
                    type="text"
                    value={filters.currentStanding ?? ""}
                  />
                </th>
                <th className="px-3 py-2">
                  <input
                    className={filterInputClassName}
                    data-testid="standings-filter-team"
                    onChange={(event) => updateFilter("teamName", event.target.value)}
                    placeholder="Team contains..."
                    type="text"
                    value={filters.teamName ?? ""}
                  />
                </th>
                <th className="px-3 py-2">
                  <input
                    className={filterInputClassName}
                    onChange={(event) => updateFilter("totalPoints", event.target.value)}
                    placeholder=">=300"
                    type="text"
                    value={filters.totalPoints ?? ""}
                  />
                </th>
                {raceColumns.map((race) => (
                  <th key={`race-filter-${race.raceId}`} className="px-3 py-2">
                    <input
                      className={filterInputClassName}
                      onChange={(event) => updateFilter(`race-${race.raceId}`, event.target.value)}
                      placeholder=">=20"
                      type="text"
                      value={filters[`race-${race.raceId}`] ?? ""}
                    />
                  </th>
                ))}
              </tr>
            ) : null}
          </thead>
          <tbody>
            {filteredAndSortedRows.length === 0 ? (
              <tr>
                <td className="px-3 py-4 text-sm text-slate-600" colSpan={4 + raceColumns.length}>
                  No rows match your current filters.
                </td>
              </tr>
            ) : (
              filteredAndSortedRows.map((row) => (
                <tr key={row.userId} className="border-t border-slate-200 hover:bg-slate-50">
                  <td className="px-3 py-2">
                    <span className={`inline-flex min-w-10 justify-center rounded-full border px-2 py-0.5 text-xs font-semibold ${changeClassName(row.change)}`}>
                      {formatChange(row.change)}
                    </span>
                  </td>
                  <td className="px-3 py-2 font-semibold text-slate-900">#{row.currentStanding}</td>
                  <td className="px-3 py-2 font-medium text-slate-900">{row.teamName}</td>
                  <td className="px-3 py-2 font-semibold">{row.totalPoints}</td>
                  {raceColumns.map((race) => (
                    <td key={`${row.userId}-${race.raceId}`} className="px-3 py-2">
                      {row.racePointsByRaceId[race.raceId] ?? 0}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
