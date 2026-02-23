"use client";

import { useMemo, useState } from "react";

export type StandingsTableRaceColumn = {
  raceId: number;
  raceName: string;
};

export type StandingsTableRow = {
  change: number;
  currentStanding: number;
  previousStanding: number | null;
  racePointsByRaceId: Record<number, number>;
  teamName: string;
  totalPoints: number;
  trend: "down" | "flat" | "up";
  userId: string;
};

type Props = {
  raceColumns: StandingsTableRaceColumn[];
  rows: StandingsTableRow[];
};

type SortDirection = "asc" | "desc";
type BaseSortKey =
  | "trend"
  | "previousStanding"
  | "currentStanding"
  | "change"
  | "teamName"
  | "totalPoints";
type SortKey = BaseSortKey | `race-${number}`;

type BaseFilterKey = BaseSortKey;
type FilterKey = BaseFilterKey | `race-${number}`;
type ColumnFilters = Record<string, string>;

const trendSymbol = (trend: "down" | "flat" | "up"): string => {
  if (trend === "up") return "▲";
  if (trend === "down") return "▼";
  return "→";
};

const sortIndicator = (key: SortKey, activeKey: SortKey, direction: SortDirection): string => {
  if (key !== activeKey) {
    return "↕";
  }

  return direction === "asc" ? "↑" : "↓";
};

const defaultSortDirection = (key: SortKey): SortDirection => {
  if (key === "teamName" || key === "trend" || key === "currentStanding" || key === "previousStanding") {
    return "asc";
  }

  return "desc";
};

const compareNullableNumber = (
  a: number | null,
  b: number | null,
  direction: SortDirection
): number => {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return direction === "asc" ? a - b : b - a;
};

const compareText = (a: string, b: string, direction: SortDirection): number =>
  direction === "asc" ? a.localeCompare(b) : b.localeCompare(a);

const textMatch = (value: string, filterValue: string): boolean => {
  const normalizedFilter = filterValue.trim().toLowerCase();
  if (!normalizedFilter) {
    return true;
  }

  return value.toLowerCase().includes(normalizedFilter);
};

const numericMatch = (value: number | null, filterValue: string): boolean => {
  const normalizedFilter = filterValue.trim();
  if (!normalizedFilter) {
    return true;
  }
  if (value === null) {
    return false;
  }

  const compareMatch = normalizedFilter.match(/^(<=|>=|<|>)\s*(-?\d+(?:\.\d+)?)$/);
  if (compareMatch) {
    const operator = compareMatch[1];
    const threshold = Number(compareMatch[2]);
    if (operator === "<") return value < threshold;
    if (operator === "<=") return value <= threshold;
    if (operator === ">") return value > threshold;
    if (operator === ">=") return value >= threshold;
  }

  const rangeMatch = normalizedFilter.match(/^(-?\d+(?:\.\d+)?)\s*-\s*(-?\d+(?:\.\d+)?)$/);
  if (rangeMatch) {
    const left = Number(rangeMatch[1]);
    const right = Number(rangeMatch[2]);
    const min = Math.min(left, right);
    const max = Math.max(left, right);
    return value >= min && value <= max;
  }

  const exact = Number(normalizedFilter);
  if (!Number.isNaN(exact)) {
    return value === exact;
  }

  return String(value).includes(normalizedFilter);
};

const trendMatch = (trend: "down" | "flat" | "up", filterValue: string): boolean => {
  const normalizedFilter = filterValue.trim().toLowerCase();
  if (!normalizedFilter) {
    return true;
  }

  const trendText = trend === "up" ? "up" : trend === "down" ? "down" : "flat";
  const symbol = trendSymbol(trend);
  return trendText.includes(normalizedFilter) || symbol.includes(normalizedFilter);
};

const trendWeight = (trend: "down" | "flat" | "up"): number => {
  if (trend === "down") return 0;
  if (trend === "flat") return 1;
  return 2;
};

const filterInputClassName =
  "w-full rounded border border-slate-300 px-1.5 py-1 text-[11px] leading-tight text-slate-700 placeholder:text-slate-400";

const createDefaultFilters = (raceColumns: StandingsTableRaceColumn[]): ColumnFilters => {
  const defaults: ColumnFilters = {
    change: "",
    currentStanding: "",
    previousStanding: "",
    teamName: "",
    totalPoints: "",
    trend: ""
  };

  raceColumns.forEach((column) => {
    defaults[`race-${column.raceId}`] = "";
  });

  return defaults;
};

export function StandingsTable({ raceColumns, rows }: Props) {
  const defaultFilters = useMemo(() => createDefaultFilters(raceColumns), [raceColumns]);
  const [filters, setFilters] = useState<ColumnFilters>(defaultFilters);
  const [sortKey, setSortKey] = useState<SortKey>("totalPoints");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");

  const onSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDirection((previous) => (previous === "asc" ? "desc" : "asc"));
      return;
    }

    setSortKey(key);
    setSortDirection(defaultSortDirection(key));
  };

  const updateFilter = (key: FilterKey, value: string) => {
    setFilters((previous) => ({ ...previous, [key]: value }));
  };

  const resetView = () => {
    setFilters(createDefaultFilters(raceColumns));
    setSortKey("totalPoints");
    setSortDirection("desc");
  };

  const filteredAndSortedRows = useMemo(() => {
    const filtered = rows.filter((row) => {
      if (
        !trendMatch(row.trend, filters.trend ?? "") ||
        !numericMatch(row.previousStanding, filters.previousStanding ?? "") ||
        !numericMatch(row.currentStanding, filters.currentStanding ?? "") ||
        !numericMatch(row.change, filters.change ?? "") ||
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
      if (sortKey === "trend") {
        return compareNullableNumber(trendWeight(a.trend), trendWeight(b.trend), sortDirection);
      }
      if (sortKey === "previousStanding") {
        return compareNullableNumber(a.previousStanding, b.previousStanding, sortDirection);
      }
      if (sortKey === "currentStanding") {
        return compareNullableNumber(a.currentStanding, b.currentStanding, sortDirection);
      }
      if (sortKey === "change") {
        return compareNullableNumber(a.change, b.change, sortDirection);
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
      className="mt-6 overflow-x-auto rounded-lg border border-slate-200 bg-white"
      data-testid="standings-table"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-3 py-2">
        <p className="text-xs text-slate-600">
          Showing <span className="font-semibold text-slate-900">{filteredAndSortedRows.length}</span>{" "}
          of {rows.length} team row(s)
        </p>
        <button
          className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
          data-testid="standings-reset"
          onClick={resetView}
          type="button"
        >
          Reset filters & sort
        </button>
      </div>

      <table className="min-w-full text-left text-sm">
        <thead className="bg-slate-50 text-slate-700">
          <tr>
            <th className="px-3 py-2 font-semibold">
              <button className="inline-flex items-center gap-1" onClick={() => onSort("trend")} type="button">
                Trend {sortIndicator("trend", sortKey, sortDirection)}
              </button>
            </th>
            <th className="px-3 py-2 font-semibold">
              <button
                className="inline-flex items-center gap-1"
                onClick={() => onSort("previousStanding")}
                type="button"
              >
                Prev {sortIndicator("previousStanding", sortKey, sortDirection)}
              </button>
            </th>
            <th className="px-3 py-2 font-semibold">
              <button
                className="inline-flex items-center gap-1"
                onClick={() => onSort("currentStanding")}
                type="button"
              >
                Current {sortIndicator("currentStanding", sortKey, sortDirection)}
              </button>
            </th>
            <th className="px-3 py-2 font-semibold">
              <button className="inline-flex items-center gap-1" onClick={() => onSort("change")} type="button">
                Change {sortIndicator("change", sortKey, sortDirection)}
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
                Total {sortIndicator("totalPoints", sortKey, sortDirection)}
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
          <tr>
            <th className="px-3 py-2">
              <input
                className={filterInputClassName}
                onChange={(event) => updateFilter("trend", event.target.value)}
                placeholder="up/down/flat"
                type="text"
                value={filters.trend ?? ""}
              />
            </th>
            <th className="px-3 py-2">
              <input
                className={filterInputClassName}
                onChange={(event) => updateFilter("previousStanding", event.target.value)}
                placeholder="<=5"
                type="text"
                value={filters.previousStanding ?? ""}
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
                onChange={(event) => updateFilter("change", event.target.value)}
                placeholder=">=1"
                type="text"
                value={filters.change ?? ""}
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
        </thead>
        <tbody>
          {filteredAndSortedRows.length === 0 ? (
            <tr>
              <td className="px-3 py-4 text-sm text-slate-600" colSpan={6 + raceColumns.length}>
                No rows match your current filters.
              </td>
            </tr>
          ) : (
            filteredAndSortedRows.map((row) => (
              <tr key={row.userId} className="border-t border-slate-200">
                <td className="px-3 py-2 font-semibold">{trendSymbol(row.trend)}</td>
                <td className="px-3 py-2">{row.previousStanding ?? "-"}</td>
                <td className="px-3 py-2 font-semibold">{row.currentStanding}</td>
                <td className="px-3 py-2">{row.change > 0 ? `+${row.change}` : row.change}</td>
                <td className="px-3 py-2">{row.teamName}</td>
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
    </section>
  );
}
