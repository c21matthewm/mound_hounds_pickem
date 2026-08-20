"use client";

import { useMemo, useState } from "react";
import { compactRoundLabel } from "@/lib/race-label";
import {
  compareNullableNumber,
  compareText,
  sortIndicator,
  type SortDirection
} from "@/lib/table-utils";
import { DataSurface, Pagination } from "@/components/ui-primitives";

export type StandingsTableRaceColumn = {
  raceId: number;
  raceName: string;
  roundNumber: number;
};

export type StandingsTableRow = {
  change: number;
  currentStanding: number;
  displayName: string;
  racePointsByRaceId: Record<number, number>;
  totalPoints: number;
  userId: string;
};

type Props = {
  currentUserId: string;
  raceColumns: StandingsTableRaceColumn[];
  rows: StandingsTableRow[];
  seasonYear: number | null;
};

type BaseSortKey = "change" | "currentStanding" | "teamName" | "totalPoints";
type SortKey = BaseSortKey | `race-${number}`;

const PAGE_SIZE = 25;

const defaultSortDirection = (key: SortKey): SortDirection =>
  key === "teamName" || key === "currentStanding" ? "asc" : "desc";

const formatChange = (value: number): string => {
  if (value > 0) return `+${value}`;
  return String(value);
};

const ChangeBadge = ({ value }: { value: number }) => (
  <span
    className={`inline-flex h-4 min-w-6 items-center justify-center rounded-full border px-1 text-[9px] font-bold leading-none tabular-nums ${
      value > 0
        ? "ui-status-success border-emerald-200 bg-emerald-50 text-emerald-700"
        : value < 0
          ? "ui-status-danger border-red-200 bg-red-50 text-red-700"
          : "border-slate-200 bg-slate-100 text-slate-500"
    }`}
  >
    {formatChange(value)}
  </span>
);

export function StandingsTable({
  currentUserId,
  raceColumns,
  rows,
  seasonYear
}: Props) {
  const [expandedUserId, setExpandedUserId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [sortKey, setSortKey] = useState<SortKey>("currentStanding");

  const desktopTableMinWidth = 480 + raceColumns.length * 64;

  const onSort = (key: SortKey) => {
    setPage(1);
    if (sortKey === key) {
      setSortDirection((previous) => (previous === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(key);
    setSortDirection(defaultSortDirection(key));
  };

  const ariaSortFor = (key: SortKey): "ascending" | "descending" | "none" =>
    sortKey === key ? (sortDirection === "asc" ? "ascending" : "descending") : "none";

  const sortedRows = useMemo(() => {
    return [...rows].sort((a, b) => {
      if (sortKey === "change") {
        return compareNullableNumber(a.change, b.change, sortDirection);
      }
      if (sortKey === "currentStanding") {
        return compareNullableNumber(a.currentStanding, b.currentStanding, sortDirection);
      }
      if (sortKey === "teamName") {
        return compareText(a.displayName, b.displayName, sortDirection);
      }
      if (sortKey === "totalPoints") {
        return compareNullableNumber(a.totalPoints, b.totalPoints, sortDirection);
      }

      const raceId = Number(sortKey.replace("race-", ""));
      return compareNullableNumber(
        a.racePointsByRaceId[raceId] ?? 0,
        b.racePointsByRaceId[raceId] ?? 0,
        sortDirection
      );
    });
  }, [rows, sortDirection, sortKey]);

  const pageCount = Math.max(1, Math.ceil(sortedRows.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const pageRows = sortedRows.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE
  );
  const firstVisible = sortedRows.length === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1;
  const lastVisible = Math.min(currentPage * PAGE_SIZE, sortedRows.length);
  return (
    <DataSurface
      className="mt-6"
      data-testid="standings-table"
      description={`${firstVisible}-${lastVisible} of ${sortedRows.length} teams`}
      title={seasonYear ? `${seasonYear} Standings` : "Season Standings"}
    >
      <div className="grid grid-cols-[2.25rem_2.75rem_minmax(0,1fr)_4.25rem] gap-1.5 border-b border-slate-200 bg-slate-50 px-3 py-1.5 text-[10px] font-semibold uppercase text-slate-500 md:hidden">
        <span className="text-right">Rank</span>
        <span className="text-center">+/-</span>
        <span>Participant / Team</span>
        <span className="text-right">Points</span>
      </div>

      <div className="divide-y divide-slate-200 md:hidden">
        {pageRows.length === 0 ? (
          <p className="px-4 py-5 text-sm text-slate-600">No teams match this view.</p>
        ) : (
          pageRows.map((row) => {
            const expanded = expandedUserId === row.userId;
            const isCurrentUser = row.userId === currentUserId;
            return (
              <article
                className={isCurrentUser ? "border-l-2 border-cyan-500 bg-cyan-50/60" : "border-l-2 border-transparent"}
                key={row.userId}
              >
                <button
                  aria-expanded={expanded}
                  aria-label={`${row.displayName}, rank ${row.currentStanding}, ${row.totalPoints} points. ${expanded ? "Hide" : "Show"} race results.`}
                  className="grid w-full grid-cols-[2.25rem_2.75rem_minmax(0,1fr)_4.25rem] items-center gap-1.5 px-3 py-2.5 text-left"
                  onClick={() => setExpandedUserId(expanded ? null : row.userId)}
                  type="button"
                >
                  <span className="text-right text-sm font-semibold tabular-nums text-slate-700">
                    {row.currentStanding}
                  </span>
                  <span className="flex justify-center">
                    <ChangeBadge value={row.change} />
                  </span>
                  <span className="min-w-0 truncate text-sm font-semibold text-slate-900">
                    {row.displayName}
                    {isCurrentUser ? <span className="ml-1 text-xs font-medium text-cyan-700">You</span> : null}
                  </span>
                  <span className="text-right text-sm font-semibold tabular-nums text-slate-950">
                    {row.totalPoints}
                  </span>
                </button>
                {expanded ? (
                  <div className="overflow-x-auto border-t border-slate-200 bg-slate-50 px-4 py-2">
                    <div className="flex min-w-max gap-2">
                      {raceColumns.map((race) => (
                        <div
                          className="w-12 shrink-0 text-center"
                          key={race.raceId}
                          title={race.raceName}
                        >
                          <p className="text-[10px] font-semibold text-slate-500">
                            {compactRoundLabel(race.roundNumber)}
                          </p>
                          <p className="text-sm font-semibold tabular-nums text-slate-900">
                            {row.racePointsByRaceId[race.raceId] ?? 0}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </article>
            );
          })
        )}
      </div>

      <div className="hidden overflow-x-auto md:block">
        <table
          className="min-w-full table-fixed text-sm"
          style={{ minWidth: `${desktopTableMinWidth}px` }}
        >
          <caption className="sr-only">
            {seasonYear ? `${seasonYear} league standings` : "Current league standings"}
          </caption>
          <thead className="sticky top-0 z-20 bg-slate-50 text-slate-700">
            <tr>
              <th aria-sort={ariaSortFor("currentStanding")} className="sticky left-0 z-30 w-20 bg-slate-50 px-3 py-2 text-right font-semibold">
                <button onClick={() => onSort("currentStanding")} type="button">
                  Rank {sortIndicator("currentStanding", sortKey, sortDirection)}
                </button>
              </th>
              <th aria-sort={ariaSortFor("teamName")} className="sticky left-20 z-30 w-56 bg-slate-50 px-3 py-2 text-left font-semibold">
                <button onClick={() => onSort("teamName")} type="button">
                  Participant / Team {sortIndicator("teamName", sortKey, sortDirection)}
                </button>
              </th>
              <th aria-sort={ariaSortFor("change")} className="w-20 px-3 py-2 text-right font-semibold">
                <button onClick={() => onSort("change")} type="button">
                  Change {sortIndicator("change", sortKey, sortDirection)}
                </button>
              </th>
              <th aria-sort={ariaSortFor("totalPoints")} className="w-24 px-3 py-2 text-right font-semibold">
                <button
                  data-testid="standings-sort-total"
                  onClick={() => onSort("totalPoints")}
                  type="button"
                >
                  Points {sortIndicator("totalPoints", sortKey, sortDirection)}
                </button>
              </th>
              {raceColumns.map((race) => (
                <th
                  aria-label={`${race.raceName} points`}
                  aria-sort={ariaSortFor(`race-${race.raceId}`)}
                  className="w-16 px-2 py-2 text-right font-semibold"
                  key={race.raceId}
                  title={race.raceName}
                >
                  <button onClick={() => onSort(`race-${race.raceId}`)} type="button">
                    {compactRoundLabel(race.roundNumber)}{" "}
                    {sortIndicator(`race-${race.raceId}`, sortKey, sortDirection)}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pageRows.length === 0 ? (
              <tr>
                <td className="px-3 py-5 text-sm text-slate-600" colSpan={4 + raceColumns.length}>
                  No teams match this view.
                </td>
              </tr>
            ) : (
              pageRows.map((row) => {
                const isCurrentUser = row.userId === currentUserId;
                return (
                  <tr
                    className={`border-t border-slate-200 hover:bg-slate-50 ${isCurrentUser ? "bg-cyan-50/60" : "bg-white"}`}
                    key={row.userId}
                  >
                    <td className={`sticky left-0 z-10 px-3 py-2 text-right font-semibold tabular-nums ${isCurrentUser ? "bg-cyan-50" : "bg-white"}`}>
                      {row.currentStanding}
                    </td>
                    <td className={`sticky left-20 z-10 truncate px-3 py-2 text-left font-medium text-slate-900 ${isCurrentUser ? "bg-cyan-50" : "bg-white"}`} title={row.displayName}>
                      {row.displayName}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <ChangeBadge value={row.change} />
                    </td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums text-slate-950">
                      {row.totalPoints}
                    </td>
                    {raceColumns.map((race) => (
                      <td className="px-2 py-2 text-right tabular-nums text-slate-700" key={race.raceId}>
                        {row.racePointsByRaceId[race.raceId] ?? 0}
                      </td>
                    ))}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {sortedRows.length > PAGE_SIZE ? (
        <Pagination
          currentPage={currentPage}
          itemLabel="teams"
          onNext={() => setPage((previous) => Math.min(pageCount, previous + 1))}
          onPrevious={() => setPage((previous) => Math.max(1, previous - 1))}
          pageCount={pageCount}
          rangeEnd={lastVisible}
          rangeStart={firstVisible}
          totalItems={sortedRows.length}
        />
      ) : null}
    </DataSurface>
  );
}
