"use client";

import { useMemo, useState } from "react";

type DriverCell = {
  driverName: string | null;
  points: number | null;
};

export type PicksByRaceTableRow = {
  averageSpeed: number | null;
  drivers: DriverCell[];
  rank: number | null;
  teamName: string;
  totalPoints: number | null;
  userId: string;
};

type Props = {
  resultsPosted: boolean;
  rows: PicksByRaceTableRow[];
};

type SortDirection = "asc" | "desc";

type SortKey =
  | "rank"
  | "teamName"
  | "totalPoints"
  | "averageSpeed"
  | "driver1"
  | "driver2"
  | "driver3"
  | "driver4"
  | "driver5"
  | "driver6"
  | "score1"
  | "score2"
  | "score3"
  | "score4"
  | "score5"
  | "score6";

type ColumnFilters = Record<SortKey, string>;

const DEFAULT_FILTERS: ColumnFilters = {
  averageSpeed: "",
  driver1: "",
  driver2: "",
  driver3: "",
  driver4: "",
  driver5: "",
  driver6: "",
  rank: "",
  score1: "",
  score2: "",
  score3: "",
  score4: "",
  score5: "",
  score6: "",
  teamName: "",
  totalPoints: ""
};

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

const sortIndicator = (
  key: SortKey,
  activeKey: SortKey,
  direction: SortDirection
): string => {
  if (key !== activeKey) {
    return "↕";
  }

  return direction === "asc" ? "↑" : "↓";
};

const defaultSortDirection = (key: SortKey): SortDirection => {
  if (key === "teamName" || key.startsWith("driver") || key === "rank") {
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

const filterInputClassName =
  "w-full rounded border border-slate-300 px-1.5 py-1 text-[11px] leading-tight text-slate-700 placeholder:text-slate-400";

export function PicksByRaceTable({ resultsPosted, rows }: Props) {
  const [filters, setFilters] = useState<ColumnFilters>(DEFAULT_FILTERS);
  const [sortKey, setSortKey] = useState<SortKey>(resultsPosted ? "rank" : "teamName");
  const [sortDirection, setSortDirection] = useState<SortDirection>(
    defaultSortDirection(resultsPosted ? "rank" : "teamName")
  );

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
    setFilters(DEFAULT_FILTERS);
    const initialSortKey: SortKey = resultsPosted ? "rank" : "teamName";
    setSortKey(initialSortKey);
    setSortDirection(defaultSortDirection(initialSortKey));
  };

  const filteredAndSortedRows = useMemo(() => {
    const filtered = rows.filter((row) => {
      return (
        numericMatch(row.rank, filters.rank) &&
        textMatch(row.teamName, filters.teamName) &&
        numericMatch(row.totalPoints, filters.totalPoints) &&
        numericMatch(row.averageSpeed, filters.averageSpeed) &&
        textMatch(row.drivers[0]?.driverName ?? "", filters.driver1) &&
        textMatch(row.drivers[1]?.driverName ?? "", filters.driver2) &&
        textMatch(row.drivers[2]?.driverName ?? "", filters.driver3) &&
        textMatch(row.drivers[3]?.driverName ?? "", filters.driver4) &&
        textMatch(row.drivers[4]?.driverName ?? "", filters.driver5) &&
        textMatch(row.drivers[5]?.driverName ?? "", filters.driver6) &&
        numericMatch(row.drivers[0]?.points ?? null, filters.score1) &&
        numericMatch(row.drivers[1]?.points ?? null, filters.score2) &&
        numericMatch(row.drivers[2]?.points ?? null, filters.score3) &&
        numericMatch(row.drivers[3]?.points ?? null, filters.score4) &&
        numericMatch(row.drivers[4]?.points ?? null, filters.score5) &&
        numericMatch(row.drivers[5]?.points ?? null, filters.score6)
      );
    });

    const sorted = [...filtered].sort((a, b) => {
      switch (sortKey) {
        case "rank":
          return compareNullableNumber(a.rank, b.rank, sortDirection);
        case "teamName":
          return compareText(a.teamName, b.teamName, sortDirection);
        case "totalPoints":
          return compareNullableNumber(a.totalPoints, b.totalPoints, sortDirection);
        case "averageSpeed":
          return compareNullableNumber(a.averageSpeed, b.averageSpeed, sortDirection);
        case "driver1":
          return compareText(a.drivers[0]?.driverName ?? "", b.drivers[0]?.driverName ?? "", sortDirection);
        case "driver2":
          return compareText(a.drivers[1]?.driverName ?? "", b.drivers[1]?.driverName ?? "", sortDirection);
        case "driver3":
          return compareText(a.drivers[2]?.driverName ?? "", b.drivers[2]?.driverName ?? "", sortDirection);
        case "driver4":
          return compareText(a.drivers[3]?.driverName ?? "", b.drivers[3]?.driverName ?? "", sortDirection);
        case "driver5":
          return compareText(a.drivers[4]?.driverName ?? "", b.drivers[4]?.driverName ?? "", sortDirection);
        case "driver6":
          return compareText(a.drivers[5]?.driverName ?? "", b.drivers[5]?.driverName ?? "", sortDirection);
        case "score1":
          return compareNullableNumber(a.drivers[0]?.points ?? null, b.drivers[0]?.points ?? null, sortDirection);
        case "score2":
          return compareNullableNumber(a.drivers[1]?.points ?? null, b.drivers[1]?.points ?? null, sortDirection);
        case "score3":
          return compareNullableNumber(a.drivers[2]?.points ?? null, b.drivers[2]?.points ?? null, sortDirection);
        case "score4":
          return compareNullableNumber(a.drivers[3]?.points ?? null, b.drivers[3]?.points ?? null, sortDirection);
        case "score5":
          return compareNullableNumber(a.drivers[4]?.points ?? null, b.drivers[4]?.points ?? null, sortDirection);
        case "score6":
          return compareNullableNumber(a.drivers[5]?.points ?? null, b.drivers[5]?.points ?? null, sortDirection);
        default:
          return 0;
      }
    });

    return sorted;
  }, [filters, rows, sortDirection, sortKey]);

  return (
    <section className="mt-6 overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-3 py-2">
        <p className="text-xs text-slate-600">
          Showing <span className="font-semibold text-slate-900">{filteredAndSortedRows.length}</span>{" "}
          of {rows.length} participant row(s)
        </p>
        <button
          className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
          data-testid="picks-table-reset"
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
              <button className="inline-flex items-center gap-1" onClick={() => onSort("rank")} type="button">
                Rank {sortIndicator("rank", sortKey, sortDirection)}
              </button>
            </th>
            <th className="px-3 py-2 font-semibold">
              <button
                className="inline-flex items-center gap-1"
                onClick={() => onSort("teamName")}
                type="button"
              >
                Team Name {sortIndicator("teamName", sortKey, sortDirection)}
              </button>
            </th>
            <th className="px-3 py-2 font-semibold">
              <button
                className="inline-flex items-center gap-1"
                data-testid="picks-sort-total-score"
                onClick={() => onSort("totalPoints")}
                type="button"
              >
                Total Score {sortIndicator("totalPoints", sortKey, sortDirection)}
              </button>
            </th>
            <th className="px-3 py-2 font-semibold">
              <button
                className="inline-flex items-center gap-1"
                onClick={() => onSort("averageSpeed")}
                type="button"
              >
                Average Speed {sortIndicator("averageSpeed", sortKey, sortDirection)}
              </button>
            </th>
            {Array.from({ length: 6 }, (_, index) => index + 1).map((groupNumber) => (
              <th key={`group-${groupNumber}`} className="px-3 py-2 font-semibold">
                <button
                  className="inline-flex items-center gap-1"
                  onClick={() => onSort(`driver${groupNumber}` as SortKey)}
                  type="button"
                >
                  Group {groupNumber}{" "}
                  {sortIndicator(`driver${groupNumber}` as SortKey, sortKey, sortDirection)}
                </button>
              </th>
            ))}
            {Array.from({ length: 6 }, (_, index) => index + 1).map((groupNumber) => (
              <th key={`group-score-${groupNumber}`} className="px-3 py-2 font-semibold">
                <button
                  className="inline-flex items-center gap-1"
                  onClick={() => onSort(`score${groupNumber}` as SortKey)}
                  type="button"
                >
                  Group {groupNumber} (Score){" "}
                  {sortIndicator(`score${groupNumber}` as SortKey, sortKey, sortDirection)}
                </button>
              </th>
            ))}
          </tr>
          <tr>
            <th className="px-3 py-2">
              <input
                className={filterInputClassName}
                onChange={(event) => updateFilter("rank", event.target.value)}
                placeholder="<=5"
                type="text"
                value={filters.rank}
              />
            </th>
            <th className="px-3 py-2">
              <input
                className={filterInputClassName}
                data-testid="picks-filter-team"
                onChange={(event) => updateFilter("teamName", event.target.value)}
                placeholder="Team contains..."
                type="text"
                value={filters.teamName}
              />
            </th>
            <th className="px-3 py-2">
              <input
                className={filterInputClassName}
                onChange={(event) => updateFilter("totalPoints", event.target.value)}
                placeholder=">=200"
                type="text"
                value={filters.totalPoints}
              />
            </th>
            <th className="px-3 py-2">
              <input
                className={filterInputClassName}
                onChange={(event) => updateFilter("averageSpeed", event.target.value)}
                placeholder="175-180"
                type="text"
                value={filters.averageSpeed}
              />
            </th>
            {Array.from({ length: 6 }, (_, index) => index + 1).map((groupNumber) => (
              <th key={`driver-filter-${groupNumber}`} className="px-3 py-2">
                <input
                  className={filterInputClassName}
                  onChange={(event) =>
                    updateFilter(`driver${groupNumber}` as SortKey, event.target.value)
                  }
                  placeholder="Driver contains..."
                  type="text"
                  value={filters[`driver${groupNumber}` as SortKey]}
                />
              </th>
            ))}
            {Array.from({ length: 6 }, (_, index) => index + 1).map((groupNumber) => (
              <th key={`score-filter-${groupNumber}`} className="px-3 py-2">
                <input
                  className={filterInputClassName}
                  onChange={(event) =>
                    updateFilter(`score${groupNumber}` as SortKey, event.target.value)
                  }
                  placeholder=">=30"
                  type="text"
                  value={filters[`score${groupNumber}` as SortKey]}
                />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {filteredAndSortedRows.length === 0 ? (
            <tr>
              <td className="px-3 py-4 text-sm text-slate-600" colSpan={16}>
                No rows match your current filters.
              </td>
            </tr>
          ) : (
            filteredAndSortedRows.map((row) => (
              <tr key={row.userId} className="border-t border-slate-200">
                <td className="px-3 py-2 font-semibold">
                  {resultsPosted ? (row.rank ?? "-") : "-"}
                </td>
                <td className="px-3 py-2">{row.teamName}</td>
                <td className="px-3 py-2 font-semibold">
                  {resultsPosted ? (row.totalPoints ?? 0) : "-"}
                </td>
                <td className="px-3 py-2">
                  {row.averageSpeed !== null ? row.averageSpeed.toFixed(3) : "-"}
                </td>
                {Array.from({ length: 6 }, (_, offset) => offset + 1).map((groupNumber) => {
                  const groupCell = row.drivers[groupNumber - 1];
                  return (
                    <td key={`${row.userId}-driver-${groupNumber}`} className="px-3 py-2">
                      {groupCell?.driverName ?? "No pick submitted"}
                    </td>
                  );
                })}
                {Array.from({ length: 6 }, (_, offset) => offset + 1).map((groupNumber) => {
                  const groupCell = row.drivers[groupNumber - 1];
                  return (
                    <td key={`${row.userId}-score-${groupNumber}`} className="px-3 py-2">
                      {resultsPosted && groupCell?.driverName ? (groupCell.points ?? 0) : "-"}
                    </td>
                  );
                })}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </section>
  );
}
