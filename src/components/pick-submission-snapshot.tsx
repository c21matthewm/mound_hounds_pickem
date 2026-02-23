"use client";

import { useEffect, useMemo, useState } from "react";
import { formatLeagueDateTime } from "@/lib/timezone";

type SavedPickItem = {
  driverName: string;
  groupNumber: number;
};

type Props = {
  latestSavedAt: string | null;
  qualifyingStartAt: string;
  savedAverageSpeed: string | null;
  savedPicks: SavedPickItem[];
};

const getRemainingMs = (qualifyingStartAt: string): number =>
  new Date(qualifyingStartAt).getTime() - Date.now();

const formatCountdown = (remainingMs: number): string => {
  const totalMinutes = Math.max(0, Math.ceil(remainingMs / 60_000));
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;

  if (days > 0) {
    return `${days}d ${hours}h ${minutes}m`;
  }

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }

  return `${minutes}m`;
};

export function PickSubmissionSnapshot({
  latestSavedAt,
  qualifyingStartAt,
  savedAverageSpeed,
  savedPicks
}: Props) {
  const [remainingMs, setRemainingMs] = useState<number>(() => getRemainingMs(qualifyingStartAt));

  useEffect(() => {
    const interval = setInterval(() => {
      setRemainingMs(getRemainingMs(qualifyingStartAt));
    }, 30_000);

    return () => clearInterval(interval);
  }, [qualifyingStartAt]);

  const isLocked = remainingMs <= 0;
  const latestSavedText = useMemo(() => {
    if (!latestSavedAt) {
      return "No submission yet";
    }

    return formatLeagueDateTime(latestSavedAt, { dateStyle: "medium", timeStyle: "short" });
  }, [latestSavedAt]);

  return (
    <section className="mt-6 rounded-lg border border-slate-200 bg-white p-4 md:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-slate-900">Submission Snapshot</h3>
          <p className="mt-1 text-sm text-slate-600">
            Track pick lock timing and your latest saved submission for this race.
          </p>
        </div>
        <p
          className={`rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-wide ${
            isLocked
              ? "border-amber-300 bg-amber-50 text-amber-800"
              : "border-cyan-300 bg-cyan-50 text-cyan-800"
          }`}
        >
          {isLocked ? "Picks Locked" : `Locks In ${formatCountdown(remainingMs)}`}
        </p>
      </div>

      <dl className="mt-3 grid gap-2 text-sm">
        <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
          <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Latest Saved
          </dt>
          <dd className="mt-0.5 font-medium text-slate-900">{latestSavedText}</dd>
        </div>
      </dl>

      {savedPicks.length > 0 ? (
        <div className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-emerald-800">
            Last Saved Submission
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {savedPicks.map((item) => (
              <span
                key={`saved-pick-${item.groupNumber}`}
                className="rounded-full border border-emerald-300 bg-white px-2 py-0.5 text-xs font-medium text-emerald-900"
              >
                G{item.groupNumber}: {item.driverName}
              </span>
            ))}
            <span className="rounded-full border border-emerald-300 bg-white px-2 py-0.5 text-xs font-medium text-emerald-900">
              Avg Speed: {savedAverageSpeed ?? "Not saved"}
            </span>
          </div>
        </div>
      ) : (
        <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          No picks saved yet for this race. Your picks become official only after you click Save
          Pick&apos;em Form.
        </p>
      )}
    </section>
  );
}
