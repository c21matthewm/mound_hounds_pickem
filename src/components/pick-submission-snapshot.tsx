"use client";

import { useMemo } from "react";
import { formatLeagueDateTime } from "@/lib/timezone";

type SavedPickItem = {
  driverName: string;
  groupNumber: number;
};

type Props = {
  latestSavedAt: string | null;
  savedAverageSpeed: string | null;
  savedPicks: SavedPickItem[];
};

export function PickSubmissionSnapshot({
  latestSavedAt,
  savedAverageSpeed,
  savedPicks
}: Props) {
  const latestSavedText = useMemo(() => {
    if (!latestSavedAt) {
      return "No submission yet";
    }

    return formatLeagueDateTime(latestSavedAt, { dateStyle: "medium", timeStyle: "short" });
  }, [latestSavedAt]);

  return (
    <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-4 md:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-slate-900">Last Saved Submission</h3>
          <p className="mt-1 text-sm text-slate-600">Your saved state for this race.</p>
        </div>
        <p className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-slate-700">
          {savedPicks.length} saved group{savedPicks.length === 1 ? "" : "s"}
        </p>
      </div>

      <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
          <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Latest Saved
          </dt>
          <dd className="mt-0.5 font-medium text-slate-900">{latestSavedText}</dd>
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
          <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Avg Speed
          </dt>
          <dd className="mt-0.5 font-medium text-slate-900">{savedAverageSpeed ?? "Not saved"}</dd>
        </div>
      </dl>

      {savedPicks.length > 0 ? (
        <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-3">
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
          </div>
        </div>
      ) : (
        <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          No picks saved yet for this race. Your picks become official only after you click Save
          Pick&apos;em Form.
        </p>
      )}
    </section>
  );
}
