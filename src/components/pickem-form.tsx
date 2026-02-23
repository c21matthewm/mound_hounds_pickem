"use client";

import { useMemo, useState } from "react";

type SelectionMap = Record<number, number | null>;

type DriverOption = {
  championshipPoints: number;
  driverName: string;
  id: number;
  imageUrl: string | null;
};

type DriverGroup = {
  drivers: DriverOption[];
  groupNumber: number;
  isTopGroup: boolean;
};

type Props = {
  action: (formData: FormData) => void | Promise<void>;
  canSubmit: boolean;
  existingAverageSpeed: string;
  groups: DriverGroup[];
  picksLocked: boolean;
  raceId: number;
  savedSelection: SelectionMap;
};

const GROUP_NUMBERS = [1, 2, 3, 4, 5, 6] as const;

const normalizeNumberString = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? String(parsed) : trimmed;
};

const buildDriverNameById = (groups: DriverGroup[]): Map<number, string> => {
  const byId = new Map<number, string>();
  groups.forEach((group) => {
    group.drivers.forEach((driver) => {
      byId.set(driver.id, driver.driverName);
    });
  });
  return byId;
};

const sameSelections = (left: SelectionMap, right: SelectionMap): boolean =>
  GROUP_NUMBERS.every((groupNumber) => (left[groupNumber] ?? null) === (right[groupNumber] ?? null));

export function PickemForm({
  action,
  canSubmit,
  existingAverageSpeed,
  groups,
  picksLocked,
  raceId,
  savedSelection
}: Props) {
  const [draftSelection, setDraftSelection] = useState<SelectionMap>(() => ({ ...savedSelection }));
  const [draftAverageSpeed, setDraftAverageSpeed] = useState(existingAverageSpeed);

  const driverNameById = useMemo(() => buildDriverNameById(groups), [groups]);

  const savedAverageSpeedNormalized = normalizeNumberString(existingAverageSpeed);
  const draftAverageSpeedNormalized = normalizeNumberString(draftAverageSpeed);
  const hasAnySavedPick = GROUP_NUMBERS.some((groupNumber) => savedSelection[groupNumber] !== null);

  const hasUnsavedChanges =
    !sameSelections(draftSelection, savedSelection) ||
    draftAverageSpeedNormalized !== savedAverageSpeedNormalized;

  const nameForDriver = (driverId: number | null): string => {
    if (!driverId) {
      return "No pick selected";
    }

    return driverNameById.get(driverId) ?? `Driver #${driverId}`;
  };

  return (
    <form action={action} className="mt-6 space-y-6">
      <input name="race_id" type="hidden" value={String(raceId)} />

      <section className="rounded-lg border border-slate-200 bg-white p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold text-slate-900">Pick Status</h3>
            <p className="mt-1 text-sm text-slate-600">
              Compare your saved picks with your current form selections before you submit.
            </p>
          </div>
          <p
            className={`rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-wide ${
              hasUnsavedChanges
                ? "border-amber-300 bg-amber-100 text-amber-800"
                : "border-emerald-200 bg-emerald-50 text-emerald-700"
            }`}
          >
            {hasUnsavedChanges ? "Unsaved changes" : "Matches saved picks"}
          </p>
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <section className="rounded-md border border-emerald-200 bg-emerald-50 p-4">
            <h4 className="text-sm font-semibold text-emerald-900">Currently Saved Picks</h4>
            <ul className="mt-2 space-y-1 text-sm text-emerald-900">
              {GROUP_NUMBERS.map((groupNumber) => (
                <li key={`saved-${groupNumber}`}>
                  <span className="font-semibold">G{groupNumber}:</span>{" "}
                  {nameForDriver(savedSelection[groupNumber] ?? null)}
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-emerald-800">
              Avg Speed: {savedAverageSpeedNormalized || "Not saved"}
            </p>
          </section>

          <section className="rounded-md border border-cyan-200 bg-cyan-50 p-4">
            <h4 className="text-sm font-semibold text-cyan-900">Current Form Picks</h4>
            <ul className="mt-2 space-y-1 text-sm text-cyan-900">
              {GROUP_NUMBERS.map((groupNumber) => (
                <li key={`current-${groupNumber}`}>
                  <span className="font-semibold">G{groupNumber}:</span>{" "}
                  {nameForDriver(draftSelection[groupNumber] ?? null)}
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-cyan-800">
              Avg Speed: {draftAverageSpeedNormalized || "Not entered"}
            </p>
          </section>
        </div>

        {!hasAnySavedPick ? (
          <p className="mt-3 text-xs text-slate-600">
            You have not saved picks for this race yet. Your picks are not official until you click
            Save Pick&apos;em Form.
          </p>
        ) : null}
      </section>

      <fieldset className="space-y-6 disabled:opacity-80" disabled={picksLocked}>
        <section className="rounded-lg border border-slate-200 bg-white p-6">
          <label className="block max-w-xs">
            <span className="mb-1 block text-sm font-medium text-slate-700">
              Average Speed Tie-breaker
            </span>
            <input
              required
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              min={1}
              name="average_speed"
              onChange={(event) => setDraftAverageSpeed(event.target.value)}
              step="0.001"
              type="number"
              value={draftAverageSpeed}
            />
          </label>
        </section>

        {groups.map((group) => (
          <section
            key={group.groupNumber}
            className="rounded-lg border border-slate-200 bg-white p-6"
          >
            <h3 className="text-lg font-semibold text-slate-900">
              Group {group.groupNumber}
              <span className="ml-2 text-sm font-normal text-slate-500">
                {group.isTopGroup ? "(Pick 1 of 4)" : "(Pick 1)"}
              </span>
            </h3>

            {group.drivers.length === 0 ? (
              <p className="mt-3 text-sm text-slate-600">No active drivers in this group.</p>
            ) : (
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                {group.drivers.map((driver) => {
                  const selectedDriverId = draftSelection[group.groupNumber] ?? null;
                  const savedDriverId = savedSelection[group.groupNumber] ?? null;
                  const isSelected = selectedDriverId === driver.id;
                  const isSaved = savedDriverId === driver.id;
                  const isSavedAndSelected = isSaved && isSelected;

                  const cardClassName = isSavedAndSelected
                    ? "border-emerald-500 bg-emerald-50 ring-2 ring-emerald-200"
                    : isSelected
                      ? "border-cyan-500 bg-cyan-50 ring-2 ring-cyan-200"
                      : isSaved
                        ? "border-amber-300 bg-amber-50"
                        : "border-slate-200 hover:bg-slate-50";

                  return (
                    <label
                      key={driver.id}
                      className={`relative flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 shadow-sm transition ${cardClassName}`}
                    >
                      <input
                        required
                        checked={isSelected}
                        name={`driver_group${group.groupNumber}_id`}
                        onChange={() =>
                          setDraftSelection((previous) => ({
                            ...previous,
                            [group.groupNumber]: driver.id
                          }))
                        }
                        type="radio"
                        value={String(driver.id)}
                      />

                      {driver.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          alt={driver.driverName}
                          className="h-12 w-12 rounded-full border border-slate-300 object-cover"
                          src={driver.imageUrl}
                        />
                      ) : (
                        <div className="flex h-12 w-12 items-center justify-center rounded-full border border-dashed border-slate-400 text-[10px] font-semibold text-slate-500">
                          NO IMG
                        </div>
                      )}

                      <div>
                        <p className="text-sm font-semibold text-slate-900">{driver.driverName}</p>
                        <p className="text-xs text-slate-600">
                          Championship Pts: {driver.championshipPoints}
                        </p>
                      </div>

                      {isSavedAndSelected ? (
                        <span className="absolute right-2 top-2 rounded-full bg-emerald-600 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
                          Saved
                        </span>
                      ) : null}

                      {!isSaved && isSelected ? (
                        <span className="absolute right-2 top-2 rounded-full bg-cyan-700 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
                          Selected
                        </span>
                      ) : null}

                      {isSaved && !isSelected ? (
                        <span className="absolute right-2 top-2 rounded-full bg-amber-500 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
                          Saved (old)
                        </span>
                      ) : null}
                    </label>
                  );
                })}
              </div>
            )}
          </section>
        ))}

        <button
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={!canSubmit}
          type="submit"
        >
          {picksLocked ? "Picks are locked" : "Save Pick'em Form"}
        </button>
      </fieldset>
    </form>
  );
}
