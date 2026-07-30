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
    <section className="mt-5 border-y border-slate-200 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-slate-900">Saved submission</h3>
          <p className="mt-0.5 text-xs text-slate-500">{latestSavedText}</p>
        </div>
        <dl className="flex items-center gap-4 text-right">
          <div>
            <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              Groups
            </dt>
            <dd className="text-sm font-semibold text-slate-900">{savedPicks.length}</dd>
          </div>
          <div>
            <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              Avg Speed (MPH)
            </dt>
            <dd className="text-sm font-semibold text-slate-900">
              {savedAverageSpeed ?? "-"}
            </dd>
          </div>
        </dl>
      </div>

      {savedPicks.length > 0 ? (
        <details className="mt-2">
          <summary className="w-fit cursor-pointer text-xs font-semibold text-blue-800">
            View saved drivers
          </summary>
          <div className="mt-2 flex flex-wrap gap-1">
            {savedPicks.map((item) => (
              <span
                key={`saved-pick-${item.groupNumber}`}
                className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[11px] font-medium text-slate-700"
              >
                G{item.groupNumber} · {item.driverName}
              </span>
            ))}
          </div>
        </details>
      ) : (
        <p className="mt-2 text-xs text-amber-800">
          No picks are saved yet. Picks become official only after you press Save.
        </p>
      )}
    </section>
  );
}
