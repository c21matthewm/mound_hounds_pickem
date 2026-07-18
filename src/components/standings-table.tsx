"use client";

import { useMemo, useState } from "react";
import { compactRoundLabel } from "@/lib/race-label";
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
  roundNumber: number;
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
  currentUserId: string;
  raceColumns: StandingsTableRaceColumn[];
  rows: StandingsTableRow[];
  seasonYear: number | null;
};

type BaseSortKey = "change" | "currentStanding" | "teamName" | "totalPoints";
type SortKey = BaseSortKey | `race-${number}`;
type RaceView = "all" | "recent";

const PAGE_SIZE = 25;

const defaultSortDirection = (key: SortKey): SortDirection =>
  key === "teamName" || key === "currentStanding" ? "asc" : "desc";

const formatChange = (value: number): string => {
  if (value > 0) return `+${value}`;
  return String(value);
};

export function StandingsTable({
  currentUserId,
  raceColumns,
  rows,
  seasonYear
}: Props) {
  const [expandedUserId, setExpandedUserId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [raceFilterId, setRaceFilterId] = useState<number | null>(null);
  const [racePointsFilter, setRacePointsFilter] = useState("");
  const [raceView, setRaceView] = useState<RaceView>("recent");
  const [rankFilter, setRankFilter] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [sortKey, setSortKey] = useState<SortKey>("currentStanding");
  const [teamFilter, setTeamFilter] = useState("");
  const [totalFilter, setTotalFilter] = useState("");

  const visibleRaceColumns = raceView === "recent" ? raceColumns.slice(-6) : raceColumns;
  const recentMobileRaces = raceColumns.slice(-3).reverse();
  const desktopTableMinWidth = 400 + visibleRaceColumns.length * 64;

  const onSort = (key: SortKey) => {
    setPage(1);
    if (sortKey === key) {
      setSortDirection((previous) => (previous === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(key);
    setSortDirection(defaultSortDirection(key));
  };

  const resetView = () => {
    setPage(1);
    setRaceFilterId(null);
    setRacePointsFilter("");
    setRankFilter("");
    setRaceView("recent");
    setSortDirection("asc");
    setSortKey("currentStanding");
    setTeamFilter("");
    setTotalFilter("");
  };

  const filteredAndSortedRows = useMemo(() => {
    const filtered = rows.filter((row) => {
      if (
        !numericMatch(row.currentStanding, rankFilter) ||
        !textMatch(row.teamName, teamFilter) ||
        !numericMatch(row.totalPoints, totalFilter)
      ) {
        return false;
      }

      if (
        raceFilterId !== null &&
        !numericMatch(row.racePointsByRaceId[raceFilterId] ?? 0, racePointsFilter)
      ) {
        return false;
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

      const raceId = Number(sortKey.replace("race-", ""));
      return compareNullableNumber(
        a.racePointsByRaceId[raceId] ?? 0,
        b.racePointsByRaceId[raceId] ?? 0,
        sortDirection
      );
    });
  }, [raceFilterId, racePointsFilter, rankFilter, rows, sortDirection, sortKey, teamFilter, totalFilter]);

  const pageCount = Math.max(1, Math.ceil(filteredAndSortedRows.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const pageRows = filteredAndSortedRows.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE
  );
  const firstVisible = filteredAndSortedRows.length === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1;
  const lastVisible = Math.min(currentPage * PAGE_SIZE, filteredAndSortedRows.length);
  const currentUserIndex = filteredAndSortedRows.findIndex((row) => row.userId === currentUserId);

  const findMyTeam = () => {
    if (currentUserIndex < 0) return;
    setPage(Math.floor(currentUserIndex / PAGE_SIZE) + 1);
  };

  return (
    <section
      className="mt-6 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm"
      data-testid="standings-table"
    >
      <div className="border-b border-slate-200 bg-slate-950 px-4 py-3 text-white">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">
              {seasonYear ? `${seasonYear} Standings` : "Season Standings"}
            </h2>
            <p className="mt-0.5 text-xs text-slate-300">
              {firstVisible}-{lastVisible} of {filteredAndSortedRows.length} teams
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {currentUserIndex >= 0 ? (
              <button
                className="rounded-md border border-white/25 px-2.5 py-1.5 text-xs font-semibold hover:bg-white/10"
                onClick={findMyTeam}
                type="button"
              >
                Find my team
              </button>
            ) : null}
            <button
              className="rounded-md border border-white/25 px-2.5 py-1.5 text-xs font-semibold hover:bg-white/10"
              data-testid="standings-filter-toggle"
              onClick={() => setShowFilters((previous) => !previous)}
              type="button"
            >
              {showFilters ? "Hide filters" : "Filters"}
            </button>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-md border border-white/25 p-0.5 text-xs font-semibold">
            <button
              className={`rounded px-2.5 py-1 ${raceView === "recent" ? "bg-white text-slate-950" : "text-white"}`}
              onClick={() => setRaceView("recent")}
              type="button"
            >
              Recent races
            </button>
            <button
              className={`rounded px-2.5 py-1 ${raceView === "all" ? "bg-white text-slate-950" : "text-white"}`}
              onClick={() => setRaceView("all")}
              type="button"
            >
              All races
            </button>
          </div>
          <button
            className="rounded-md px-2 py-1 text-xs font-semibold text-slate-300 hover:text-white"
            data-testid="standings-reset"
            onClick={resetView}
            type="button"
          >
            Reset
          </button>
        </div>
      </div>

      {showFilters ? (
        <div className="grid gap-2 border-b border-slate-200 bg-slate-50 p-3 sm:grid-cols-2 lg:grid-cols-5">
          <input
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
            data-testid="standings-filter-team"
            onChange={(event) => {
              setPage(1);
              setTeamFilter(event.target.value);
            }}
            placeholder="Team name"
            value={teamFilter}
          />
          <input
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
            onChange={(event) => {
              setPage(1);
              setRankFilter(event.target.value);
            }}
            placeholder="Rank, e.g. <=10"
            value={rankFilter}
          />
          <input
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
            onChange={(event) => {
              setPage(1);
              setTotalFilter(event.target.value);
            }}
            placeholder="Points, e.g. >=300"
            value={totalFilter}
          />
          <select
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
            onChange={(event) => {
              setPage(1);
              setRaceFilterId(event.target.value ? Number(event.target.value) : null);
            }}
            value={raceFilterId ?? ""}
          >
            <option value="">Race score filter</option>
            {raceColumns.map((race) => (
              <option key={race.raceId} value={race.raceId}>
                {compactRoundLabel(race.roundNumber)} · {race.raceName}
              </option>
            ))}
          </select>
          <input
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm disabled:bg-slate-100"
            disabled={raceFilterId === null}
            onChange={(event) => {
              setPage(1);
              setRacePointsFilter(event.target.value);
            }}
            placeholder="Race points, e.g. >=30"
            value={racePointsFilter}
          />
        </div>
      ) : null}

      <div className="grid grid-cols-[2.5rem_minmax(0,1fr)_4.5rem] gap-2 border-b border-slate-200 bg-slate-50 px-3 py-1.5 text-[10px] font-semibold uppercase text-slate-500 md:hidden">
        <span className="text-right">Rank</span>
        <span>Team</span>
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
                  className="grid w-full grid-cols-[2.5rem_minmax(0,1fr)_4.5rem] items-center gap-2 px-3 py-2.5 text-left"
                  onClick={() => setExpandedUserId(expanded ? null : row.userId)}
                  type="button"
                >
                  <span className="text-right text-sm font-semibold tabular-nums text-slate-600">
                    {row.currentStanding}
                  </span>
                  <span className="min-w-0 truncate text-sm font-semibold text-slate-900">
                    {row.teamName}
                    {isCurrentUser ? <span className="ml-1 text-xs font-medium text-cyan-700">You</span> : null}
                  </span>
                  <span className="text-right text-sm font-semibold tabular-nums text-slate-950">
                    {row.totalPoints}
                  </span>
                </button>
                {expanded ? (
                  <div className="grid grid-cols-3 gap-2 border-t border-slate-200 bg-slate-50 px-4 py-2">
                    {recentMobileRaces.map((race) => (
                      <div className="min-w-0 text-center" key={race.raceId} title={race.raceName}>
                        <p className="text-[10px] font-semibold text-slate-500">
                          {compactRoundLabel(race.roundNumber)}
                        </p>
                        <p className="text-sm font-semibold tabular-nums text-slate-900">
                          {row.racePointsByRaceId[race.raceId] ?? 0}
                        </p>
                      </div>
                    ))}
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
          <thead className="sticky top-0 z-20 bg-slate-50 text-slate-700">
            <tr>
              <th className="sticky left-0 z-30 w-20 bg-slate-50 px-3 py-2 text-right font-semibold">
                <button onClick={() => onSort("currentStanding")} type="button">
                  Rank {sortIndicator("currentStanding", sortKey, sortDirection)}
                </button>
              </th>
              <th className="sticky left-20 z-30 w-56 bg-slate-50 px-3 py-2 text-left font-semibold">
                <button onClick={() => onSort("teamName")} type="button">
                  Team {sortIndicator("teamName", sortKey, sortDirection)}
                </button>
              </th>
              <th className="w-24 px-3 py-2 text-right font-semibold">
                <button
                  data-testid="standings-sort-total"
                  onClick={() => onSort("totalPoints")}
                  type="button"
                >
                  Points {sortIndicator("totalPoints", sortKey, sortDirection)}
                </button>
              </th>
              {visibleRaceColumns.map((race) => (
                <th
                  aria-label={`${race.raceName} points`}
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
                <td className="px-3 py-5 text-sm text-slate-600" colSpan={3 + visibleRaceColumns.length}>
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
                      {row.change !== 0 ? (
                        <span className={`ml-1 text-[10px] ${row.change > 0 ? "text-emerald-700" : "text-amber-700"}`}>
                          {formatChange(row.change)}
                        </span>
                      ) : null}
                    </td>
                    <td className={`sticky left-20 z-10 truncate px-3 py-2 text-left font-medium text-slate-900 ${isCurrentUser ? "bg-cyan-50" : "bg-white"}`} title={row.teamName}>
                      {row.teamName}
                    </td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums text-slate-950">
                      {row.totalPoints}
                    </td>
                    {visibleRaceColumns.map((race) => (
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

      {filteredAndSortedRows.length > PAGE_SIZE ? (
        <div className="flex items-center justify-between gap-3 border-t border-slate-200 px-3 py-2.5">
          <button
            className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 disabled:opacity-40"
            disabled={currentPage === 1}
            onClick={() => setPage((previous) => Math.max(1, previous - 1))}
            type="button"
          >
            Previous
          </button>
          <p className="text-xs font-medium text-slate-600">
            Page {currentPage} of {pageCount}
          </p>
          <button
            className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 disabled:opacity-40"
            disabled={currentPage === pageCount}
            onClick={() => setPage((previous) => Math.min(pageCount, previous + 1))}
            type="button"
          >
            Next
          </button>
        </div>
      ) : null}
    </section>
  );
}
