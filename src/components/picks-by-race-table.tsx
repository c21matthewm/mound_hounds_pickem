"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import {
  buildOrderedWeeklyRows,
  calculateOfficialSpeedDelta,
  isTopPointsTie
} from "@/lib/weekly-ranking";
import { groupNumbersForCount } from "@/lib/race-format";
import {
  compareNullableNumber,
  compareText,
  sortIndicator,
  type SortDirection
} from "@/lib/table-utils";

type DriverCell = {
  driverName: string | null;
  points: number | null;
};

export type PicksByRaceTableRow = {
  averageSpeed: number | null;
  displayName: string;
  drivers: DriverCell[];
  rank: number | null;
  teamName: string;
  totalPoints: number | null;
  userId: string;
};

type Props = {
  officialWinningAverageSpeed: number | null;
  resultsPosted: boolean;
  rows: PicksByRaceTableRow[];
};

type TieBreakRow = {
  averageSpeed: number | null;
  displayName: string;
  userId: string;
};

type SortKey =
  | "rank"
  | "teamName"
  | "totalPoints"
  | "averageSpeed"
  | `driver${number}`
  | `score${number}`;

const defaultSortDirection = (key: SortKey): SortDirection => {
  if (key === "teamName" || key.startsWith("driver") || key === "rank") {
    return "asc";
  }

  return "desc";
};

const formatAverageSpeed = (value: number | null): string =>
  value !== null ? value.toFixed(3) : "-";
const PAGE_SIZE = 25;

export function PicksByRaceTable({ officialWinningAverageSpeed, resultsPosted, rows }: Props) {
  const groupCount = Math.max(6, ...rows.map((row) => row.drivers.length));
  const groupNumbers = useMemo(
    () => groupNumbersForCount(groupCount),
    [groupCount]
  );
  const [sortKey, setSortKey] = useState<SortKey>(resultsPosted ? "rank" : "teamName");
  const [sortDirection, setSortDirection] = useState<SortDirection>(
    defaultSortDirection(resultsPosted ? "rank" : "teamName")
  );
  const [selectedRow, setSelectedRow] = useState<PicksByRaceTableRow | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const dialogRef = useRef<HTMLElement | null>(null);
  const lastDialogTriggerRef = useRef<HTMLButtonElement | null>(null);

  const onSort = (key: SortKey) => {
    setCurrentPage(1);
    if (sortKey === key) {
      setSortDirection((previous) => (previous === "asc" ? "desc" : "asc"));
      return;
    }

    setSortKey(key);
    setSortDirection(defaultSortDirection(key));
  };

  const ariaSortFor = (key: SortKey): "ascending" | "descending" | "none" =>
    sortKey === key ? (sortDirection === "asc" ? "ascending" : "descending") : "none";

  useEffect(() => {
    if (!selectedRow || !dialogRef.current) {
      return;
    }

    const dialog = dialogRef.current;
    const focusable = Array.from(
      dialog.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
    );
    focusable[0]?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setSelectedRow(null);
        return;
      }

      if (event.key !== "Tab" || focusable.length === 0) {
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      lastDialogTriggerRef.current?.focus();
    };
  }, [selectedRow]);

  const sortedRows = useMemo(() => {
    return [...rows].sort((a, b) => {
      if (sortKey.startsWith("driver")) {
        const groupIndex = Number(sortKey.replace("driver", "")) - 1;
        return compareText(
          a.drivers[groupIndex]?.driverName ?? "",
          b.drivers[groupIndex]?.driverName ?? "",
          sortDirection
        );
      }

      if (sortKey.startsWith("score")) {
        const groupIndex = Number(sortKey.replace("score", "")) - 1;
        return compareNullableNumber(
          a.drivers[groupIndex]?.points ?? null,
          b.drivers[groupIndex]?.points ?? null,
          sortDirection
        );
      }

      switch (sortKey) {
        case "rank":
          return compareNullableNumber(a.rank, b.rank, sortDirection);
        case "teamName":
          return compareText(a.displayName, b.displayName, sortDirection);
        case "totalPoints":
          return compareNullableNumber(a.totalPoints, b.totalPoints, sortDirection);
        case "averageSpeed":
          return compareNullableNumber(a.averageSpeed, b.averageSpeed, sortDirection);
        default:
          return 0;
      }
    });

  }, [rows, sortDirection, sortKey]);
  const totalPages = Math.max(1, Math.ceil(sortedRows.length / PAGE_SIZE));
  const visiblePage = Math.min(currentPage, totalPages);
  const paginatedRows = useMemo(
    () => sortedRows.slice((visiblePage - 1) * PAGE_SIZE, visiblePage * PAGE_SIZE),
    [sortedRows, visiblePage]
  );

  const tieBreakRows = useMemo(() => {
    if (!resultsPosted || !selectedRow || selectedRow.totalPoints === null) {
      return [] as TieBreakRow[];
    }

    const normalizedRows = rows
      .filter((row) => row.totalPoints !== null)
      .map((row) => ({
        averageSpeed: row.averageSpeed,
        points: row.totalPoints ?? 0,
        teamName: row.teamName,
        userId: row.userId
      }));

    if (!isTopPointsTie(normalizedRows, selectedRow.totalPoints)) {
      return [] as TieBreakRow[];
    }

    const topPoints = Math.max(...normalizedRows.map((row) => row.points));
    const tiedTopRows = normalizedRows.filter((row) => row.points === topPoints);
    const orderedTopRows = buildOrderedWeeklyRows(tiedTopRows, officialWinningAverageSpeed);
    const displayNameByUserId = new Map(rows.map((row) => [row.userId, row.displayName]));

    return orderedTopRows.map((row) => ({
      averageSpeed: row.averageSpeed,
      displayName: displayNameByUserId.get(row.userId) ?? row.teamName,
      userId: row.userId
    }));
  }, [officialWinningAverageSpeed, resultsPosted, rows, selectedRow]);

  const selectedTieBreakRank = useMemo(() => {
    if (!selectedRow) {
      return null;
    }

    const index = tieBreakRows.findIndex((row) => row.userId === selectedRow.userId);
    return index >= 0 ? index + 1 : null;
  }, [selectedRow, tieBreakRows]);

  return (
    <>
      <section className="mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 bg-gradient-to-r from-cyan-50 to-slate-50 px-4 py-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-800">
            Picks Matrix
          </h2>
          <p className="mt-1 text-xs text-slate-600">
            {rows.length} teams. Pick and score columns are paired by group.
          </p>
        </div>

        <div className="divide-y divide-slate-200 md:hidden">
          {sortedRows.length === 0 ? (
            <p className="px-4 py-4 text-sm text-slate-600">No team picks are available.</p>
          ) : (
            paginatedRows.map((row) => (
              <article key={`mobile-picks-${row.userId}`} className="px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <button
                    className="min-w-0 text-left"
                    onClick={(event) => {
                      lastDialogTriggerRef.current = event.currentTarget;
                      setSelectedRow(row);
                    }}
                    type="button"
                  >
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      {resultsPosted ? `Rank ${row.rank ?? "-"}` : "Submitted Pick"}
                    </p>
                    <h3
                      className="mt-0.5 truncate text-base font-semibold text-slate-900 underline decoration-slate-300 underline-offset-2"
                      title={row.displayName}
                    >
                      {row.displayName}
                    </h3>
                  </button>
                  <div className="text-right">
                    <p className="text-lg font-semibold text-slate-900">
                      {resultsPosted ? (row.totalPoints ?? 0) : "-"}
                    </p>
                    <p className="text-xs text-slate-500">score</p>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-medium text-slate-700">
                    Avg {formatAverageSpeed(row.averageSpeed)} MPH
                  </span>
                  {row.drivers.slice(0, 4).map((driver, index) => (
                    <span
                      key={`mobile-picks-${row.userId}-${index}`}
                      className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-xs font-medium text-slate-700"
                    >
                      G{index + 1}: {driver.driverName ?? "No pick"}
                    </span>
                  ))}
                  {row.drivers.length > 4 ? (
                    <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-medium text-slate-600">
                      +{row.drivers.length - 4} groups
                    </span>
                  ) : null}
                </div>
              </article>
            ))
          )}
        </div>

        <div className="hidden overflow-x-auto md:block">
        <table className="min-w-full text-left text-sm">
          <caption className="sr-only">Participant picks and scores by driver group</caption>
          <thead className="bg-slate-50 text-slate-700">
            <tr>
              <th aria-sort={ariaSortFor("rank")} className="px-3 py-2 font-semibold">
                <button className="inline-flex items-center gap-1" onClick={() => onSort("rank")} type="button">
                  Rank {sortIndicator("rank", sortKey, sortDirection)}
                </button>
              </th>
              <th aria-sort={ariaSortFor("teamName")} className="px-3 py-2 font-semibold">
                <button
                  className="inline-flex items-center gap-1"
                  onClick={() => onSort("teamName")}
                  type="button"
                >
                  Participant / Team {sortIndicator("teamName", sortKey, sortDirection)}
                </button>
              </th>
              <th aria-sort={ariaSortFor("totalPoints")} className="px-3 py-2 font-semibold">
                <button
                  className="inline-flex items-center gap-1"
                  data-testid="picks-sort-total-score"
                  onClick={() => onSort("totalPoints")}
                  type="button"
                >
                  Total Score {sortIndicator("totalPoints", sortKey, sortDirection)}
                </button>
              </th>
              <th aria-sort={ariaSortFor("averageSpeed")} className="px-3 py-2 font-semibold">
                <button
                  className="inline-flex items-center gap-1"
                  onClick={() => onSort("averageSpeed")}
                  type="button"
                >
                  Average Speed (MPH) {sortIndicator("averageSpeed", sortKey, sortDirection)}
                </button>
              </th>
              {groupNumbers.map((groupNumber) => (
                <Fragment key={`group-columns-${groupNumber}`}>
                  <th aria-sort={ariaSortFor(`driver${groupNumber}` as SortKey)} className="px-3 py-2 font-semibold">
                    <button
                      className="inline-flex items-center gap-1"
                      onClick={() => onSort(`driver${groupNumber}` as SortKey)}
                      type="button"
                    >
                      G{groupNumber} Pick{" "}
                      {sortIndicator(`driver${groupNumber}` as SortKey, sortKey, sortDirection)}
                    </button>
                  </th>
                  <th aria-sort={ariaSortFor(`score${groupNumber}` as SortKey)} className="px-3 py-2 font-semibold">
                    <button
                      className="inline-flex items-center gap-1"
                      onClick={() => onSort(`score${groupNumber}` as SortKey)}
                      type="button"
                    >
                      G{groupNumber} Score{" "}
                      {sortIndicator(`score${groupNumber}` as SortKey, sortKey, sortDirection)}
                    </button>
                  </th>
                </Fragment>
              ))}
            </tr>
          </thead>
          <tbody>
            {sortedRows.length === 0 ? (
              <tr>
                <td className="px-3 py-4 text-sm text-slate-600" colSpan={4 + groupCount * 2}>
                  No team picks are available.
                </td>
              </tr>
            ) : (
              paginatedRows.map((row) => (
                <tr key={row.userId} className="border-t border-slate-200">
                  <td className="px-3 py-2 font-semibold">
                    {resultsPosted ? (row.rank ?? "-") : "-"}
                  </td>
                  <td className="px-3 py-2">
                    <button
                      className="font-semibold text-slate-900 underline decoration-slate-300 underline-offset-2 hover:text-slate-700"
                      onClick={(event) => {
                        lastDialogTriggerRef.current = event.currentTarget;
                        setSelectedRow(row);
                      }}
                      type="button"
                    >
                      {row.displayName}
                    </button>
                  </td>
                  <td className="px-3 py-2 font-semibold">
                    {resultsPosted ? (row.totalPoints ?? 0) : "-"}
                  </td>
                  <td className="px-3 py-2">{formatAverageSpeed(row.averageSpeed)}</td>
                  {groupNumbers.map((groupNumber) => {
                    const groupCell = row.drivers[groupNumber - 1];
                    return (
                      <Fragment key={`${row.userId}-group-${groupNumber}`}>
                        <td className="px-3 py-2">
                          {groupCell?.driverName ?? (
                            <span className="text-slate-400">No pick submitted</span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          {resultsPosted ? (
                            <span className="inline-flex min-w-8 justify-center rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">
                              {groupCell?.points ?? "-"}
                            </span>
                          ) : (
                            "-"
                          )}
                        </td>
                      </Fragment>
                    );
                  })}
                </tr>
              ))
            )}
          </tbody>
        </table>
        </div>

        {sortedRows.length > PAGE_SIZE ? (
          <div className="flex items-center justify-between gap-3 border-t border-slate-200 px-4 py-3">
            <p className="text-xs text-slate-500">
              Teams {(visiblePage - 1) * PAGE_SIZE + 1}-
              {Math.min(visiblePage * PAGE_SIZE, sortedRows.length)} of {sortedRows.length}
            </p>
            <div className="flex items-center gap-2">
              <button
                className="rounded-md border border-slate-300 px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
                disabled={visiblePage <= 1}
                onClick={() => setCurrentPage(Math.max(1, visiblePage - 1))}
                type="button"
              >
                Previous
              </button>
              <span className="text-xs font-semibold text-slate-600">
                {visiblePage}/{totalPages}
              </span>
              <button
                className="rounded-md border border-slate-300 px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
                disabled={visiblePage >= totalPages}
                onClick={() => setCurrentPage(Math.min(totalPages, visiblePage + 1))}
                type="button"
              >
                Next
              </button>
            </div>
          </div>
        ) : null}
      </section>

      {selectedRow ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4"
          onClick={() => setSelectedRow(null)}
          role="presentation"
        >
          <section
            aria-labelledby="picks-detail-title"
            aria-modal="true"
            className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-lg border border-slate-200 bg-white p-5"
            onClick={(event) => event.stopPropagation()}
            ref={dialogRef}
            role="dialog"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold text-slate-900" id="picks-detail-title">{selectedRow.displayName}</h3>
                <p className="mt-1 text-sm text-slate-600">Picks breakdown and tiebreak context</p>
              </div>
              <button
                className="rounded-md border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                onClick={() => setSelectedRow(null)}
                type="button"
              >
                Close
              </button>
            </div>

            <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-3">
              <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Rank</dt>
                <dd className="mt-0.5 font-medium text-slate-900">
                  {resultsPosted ? (selectedRow.rank ?? "-") : "-"}
                </dd>
              </div>
              <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  Total Score
                </dt>
                <dd className="mt-0.5 font-medium text-slate-900">
                  {resultsPosted ? (selectedRow.totalPoints ?? 0) : "-"}
                </dd>
              </div>
              <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  Average Speed (MPH)
                </dt>
                <dd className="mt-0.5 font-medium text-slate-900">
                  {formatAverageSpeed(selectedRow.averageSpeed)}
                </dd>
              </div>
            </dl>

            <section className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-3">
              <h4 className="text-sm font-semibold text-slate-900">Tiebreak Comparison</h4>
              {!resultsPosted ? (
                <p className="mt-2 text-sm text-slate-600">
                  Tiebreak only applies after results are posted.
                </p>
              ) : tieBreakRows.length <= 1 ? (
                <p className="mt-2 text-sm text-slate-600">
                  No first-place tie for this row. Tiebreak not needed.
                </p>
              ) : (
                <>
                  <p className="mt-2 text-sm text-slate-700">
                    Teams tied for first at <span className="font-semibold">{selectedRow.totalPoints}</span>{" "}
                    points are ordered by closest pick to the official race average speed.
                  </p>
                  <p className="mt-1 text-xs text-slate-600">
                    Official race average speed:{" "}
                    {officialWinningAverageSpeed !== null
                      ? officialWinningAverageSpeed.toFixed(3)
                      : "Unavailable (fallback to team name order)."}
                  </p>
                  <p className="mt-1 text-xs text-slate-600">
                    {selectedTieBreakRank
                      ? `${selectedRow.displayName} is tiebreak position #${selectedTieBreakRank} of ${tieBreakRows.length}.`
                      : "Selected team is not in the tiebreak group."}
                  </p>
                  <div className="mt-2 overflow-x-auto rounded-md border border-slate-200 bg-white">
                    <table className="min-w-full text-left text-sm">
                      <caption className="sr-only">First-place average-speed tiebreak comparison</caption>
                      <thead className="bg-slate-50 text-slate-700">
                        <tr>
                          <th className="px-3 py-2 font-semibold">Tiebreak Rank</th>
                          <th className="px-3 py-2 font-semibold">Team</th>
                          <th className="px-3 py-2 font-semibold">Average Speed</th>
                          <th className="px-3 py-2 font-semibold">Delta to Official</th>
                        </tr>
                      </thead>
                      <tbody>
                        {tieBreakRows.map((row, index) => (
                          <tr
                            key={`tiebreak-${row.userId}`}
                            className={`border-t border-slate-200 ${
                              row.userId === selectedRow.userId ? "bg-cyan-50" : ""
                            }`}
                          >
                            <td className="px-3 py-2">{index + 1}</td>
                            <td className="px-3 py-2">{row.displayName}</td>
                            <td className="px-3 py-2">
                              {row.averageSpeed !== null ? row.averageSpeed.toFixed(3) : "-"}
                            </td>
                            <td className="px-3 py-2">
                              {calculateOfficialSpeedDelta(row.averageSpeed, officialWinningAverageSpeed)?.toFixed(
                                3
                              ) ?? "-"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </section>

            <section className="mt-4">
              <h4 className="text-sm font-semibold text-slate-900">Per-Driver Scoring</h4>
              <div className="mt-2 overflow-x-auto rounded-md border border-slate-200">
                <table className="min-w-full text-left text-sm">
                  <caption className="sr-only">Selected team driver picks and points</caption>
                  <thead className="bg-slate-50 text-slate-700">
                    <tr>
                      <th className="px-3 py-2 font-semibold">Group</th>
                      <th className="px-3 py-2 font-semibold">Driver</th>
                      <th className="px-3 py-2 font-semibold">Points</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedRow.drivers.map((driver, index) => (
                      <tr key={`${selectedRow.userId}-modal-driver-${index + 1}`} className="border-t border-slate-200">
                        <td className="px-3 py-2">Group {index + 1}</td>
                        <td className="px-3 py-2">{driver.driverName ?? "No pick submitted"}</td>
                        <td className="px-3 py-2">
                          {resultsPosted ? (driver.points ?? "-") : "-"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </section>
        </div>
      ) : null}
    </>
  );
}
