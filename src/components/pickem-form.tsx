"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type SelectionMap = Record<number, number | null>;
const LEAVE_CONFIRM_MESSAGE = "You have unsaved Pick'em changes. Leave this page without saving?";

type DriverOption = {
  championshipPoints: number;
  detailText?: string;
  driverName: string;
  id: number;
  imageUrl: string | null;
};

type DriverGroup = {
  drivers: DriverOption[];
  groupNumber: number;
  isTopGroup: boolean;
  selectionLabel?: string;
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

export function PickemForm({
  action,
  canSubmit,
  existingAverageSpeed,
  groups,
  picksLocked,
  raceId,
  savedSelection
}: Props) {
  const groupNumbers = useMemo(() => groups.map((group) => group.groupNumber), [groups]);
  const [draftSelection, setDraftSelection] = useState<SelectionMap>(() => ({ ...savedSelection }));
  const [draftAverageSpeed, setDraftAverageSpeed] = useState(existingAverageSpeed);
  const formRef = useRef<HTMLFormElement | null>(null);
  const submitInProgressRef = useRef(false);
  const submitIntentTimeoutRef = useRef<number | null>(null);
  const allowNextUnloadRef = useRef(false);
  const allowNextUnloadTimeoutRef = useRef<number | null>(null);

  const hasUnsavedChanges = useMemo(() => {
    const averageSpeedChanged = draftAverageSpeed.trim() !== existingAverageSpeed.trim();
    const picksChanged = groupNumbers.some(
      (groupNumber) => (draftSelection[groupNumber] ?? null) !== (savedSelection[groupNumber] ?? null)
    );
    return averageSpeedChanged || picksChanged;
  }, [draftAverageSpeed, draftSelection, existingAverageSpeed, groupNumbers, savedSelection]);
  const selectedGroupCount = groupNumbers.filter(
    (groupNumber) => draftSelection[groupNumber] !== null && draftSelection[groupNumber] !== undefined
  ).length;
  const missingGroupNumbers = groupNumbers.filter(
    (groupNumber) => draftSelection[groupNumber] === null || draftSelection[groupNumber] === undefined
  );
  const showMobileActionBar = !picksLocked && (hasUnsavedChanges || missingGroupNumbers.length > 0);

  const clearSubmitIntent = () => {
    submitInProgressRef.current = false;
    if (submitIntentTimeoutRef.current !== null) {
      window.clearTimeout(submitIntentTimeoutRef.current);
      submitIntentTimeoutRef.current = null;
    }
  };

  const allowNextUnloadOnce = () => {
    allowNextUnloadRef.current = true;
    if (allowNextUnloadTimeoutRef.current !== null) {
      window.clearTimeout(allowNextUnloadTimeoutRef.current);
    }
    allowNextUnloadTimeoutRef.current = window.setTimeout(() => {
      allowNextUnloadRef.current = false;
      allowNextUnloadTimeoutRef.current = null;
    }, 2000);
  };

  const handleSubmit = () => {
    submitInProgressRef.current = true;
    allowNextUnloadOnce();
    if (submitIntentTimeoutRef.current !== null) {
      window.clearTimeout(submitIntentTimeoutRef.current);
    }
    submitIntentTimeoutRef.current = window.setTimeout(() => {
      submitInProgressRef.current = false;
      submitIntentTimeoutRef.current = null;
    }, 4000);
  };

  useEffect(
    () => () => {
      if (submitIntentTimeoutRef.current !== null) {
        window.clearTimeout(submitIntentTimeoutRef.current);
      }
      if (allowNextUnloadTimeoutRef.current !== null) {
        window.clearTimeout(allowNextUnloadTimeoutRef.current);
      }
    },
    []
  );

  useEffect(() => {
    if (!hasUnsavedChanges || picksLocked) {
      return;
    }

    const confirmLeave = (): boolean => {
      if (submitInProgressRef.current) {
        allowNextUnloadOnce();
        return true;
      }
      const confirmed = window.confirm(LEAVE_CONFIRM_MESSAGE);
      if (confirmed) {
        allowNextUnloadOnce();
      }
      return confirmed;
    };

    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (submitInProgressRef.current || allowNextUnloadRef.current) {
        allowNextUnloadRef.current = false;
        return;
      }

      event.preventDefault();
      event.returnValue = "";
    };

    const onDocumentClick = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }

      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }

      const anchor = target.closest("a[href]");
      if (!(anchor instanceof HTMLAnchorElement)) {
        return;
      }

      if (anchor.target && anchor.target !== "_self") {
        return;
      }

      if (anchor.hasAttribute("download")) {
        return;
      }

      const href = anchor.getAttribute("href");
      if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) {
        return;
      }

      const destination = new URL(anchor.href, window.location.href);
      const current = new URL(window.location.href);
      if (destination.href === current.href) {
        return;
      }

      if (!confirmLeave()) {
        event.preventDefault();
      }
    };

    const onDocumentSubmit = (event: SubmitEvent) => {
      if (event.defaultPrevented) {
        return;
      }

      const submittedForm = event.target;
      if (!(submittedForm instanceof HTMLFormElement)) {
        return;
      }

      if (submittedForm === formRef.current) {
        return;
      }

      if (!confirmLeave()) {
        event.preventDefault();
      }
    };

    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onDocumentClick, true);
    document.addEventListener("submit", onDocumentSubmit, true);

    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onDocumentClick, true);
      document.removeEventListener("submit", onDocumentSubmit, true);
    };
  }, [hasUnsavedChanges, picksLocked]);

  return (
    <form action={action} className="mt-6 space-y-6" onSubmit={handleSubmit} ref={formRef}>
      <input name="race_id" type="hidden" value={String(raceId)} />

      <fieldset className="space-y-6 disabled:opacity-80" disabled={picksLocked}>
        <section className="rounded-2xl border border-slate-200 bg-white p-5 md:p-6">
          <label className="block max-w-sm">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
              Average Speed Tie-breaker
            </span>
            <span className="mb-3 block text-sm text-slate-600">
              Used only if multiple teams tie for the weekly win.
            </span>
            <input
              required
              className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm"
              min={1}
              name="average_speed"
              onChange={(event) => {
                clearSubmitIntent();
                setDraftAverageSpeed(event.target.value);
              }}
              step="0.001"
              type="number"
              value={draftAverageSpeed}
            />
          </label>
        </section>

        {groups.map((group) => (
          <section
            id={`driver-group-${group.groupNumber}`}
            key={group.groupNumber}
            className="rounded-2xl border border-slate-200 bg-white p-5 md:p-6"
          >
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-cyan-700">
                  Driver Group
                </p>
                <h3 className="text-xl font-semibold text-slate-900">
                  Group {group.groupNumber}
                  <span className="ml-2 text-sm font-normal text-slate-500">
                    {group.selectionLabel ?? (group.isTopGroup ? "Pick 1 of 4" : "Pick 1")}
                  </span>
                </h3>
              </div>
              <p className="text-xs text-slate-500">Sorted by current championship standing.</p>
            </div>

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
                        : "border-slate-200 bg-white hover:border-cyan-200 hover:bg-cyan-50/40";

                  return (
                    <label
                      key={driver.id}
                      className={`relative flex cursor-pointer items-center gap-3 rounded-2xl border px-3 py-3 shadow-sm transition hover:-translate-y-0.5 ${cardClassName}`}
                    >
                      <input
                        required
                        checked={isSelected}
                        name={`driver_group${group.groupNumber}_id`}
                        onChange={() => {
                          clearSubmitIntent();
                          setDraftSelection((previous) => ({
                            ...previous,
                            [group.groupNumber]: driver.id
                          }));
                        }}
                        type="radio"
                        value={String(driver.id)}
                      />

                      {driver.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          alt={driver.driverName}
                          className="h-14 w-14 rounded-2xl border border-slate-300 object-cover"
                          src={driver.imageUrl}
                        />
                      ) : (
                        <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-dashed border-slate-400 text-[10px] font-semibold text-slate-500">
                          NO IMG
                        </div>
                      )}

                      <div>
                        <p className="pr-16 text-sm font-semibold text-slate-900">{driver.driverName}</p>
                        <p className="text-xs text-slate-600">
                          {driver.detailText ?? `Championship Pts: ${driver.championshipPoints}`}
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
          className="rounded-xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={!canSubmit}
          type="submit"
        >
          {picksLocked ? "Picks are locked" : "Save Pick'em Form"}
        </button>

        {showMobileActionBar ? (
          <div className="fixed inset-x-3 bottom-[4.35rem] z-30 md:hidden">
            <div className="mx-auto max-w-md rounded-lg border border-slate-200 bg-white/95 px-2.5 py-1.5 shadow-[0_18px_45px_-28px_rgba(15,23,42,0.9)] backdrop-blur">
              <div className="flex items-center justify-between gap-2">
                <p className="shrink-0 text-xs font-semibold text-slate-800">
                  {selectedGroupCount}/{groupNumbers.length} groups
                </p>
                <div className="min-w-0 flex-1 overflow-x-auto">
                  {missingGroupNumbers.length > 0 ? (
                    <div className="flex w-max gap-1">
                      {missingGroupNumbers.map((groupNumber) => (
                        <a
                          key={`missing-group-${groupNumber}`}
                          className="rounded-md border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800"
                          href={`#driver-group-${groupNumber}`}
                        >
                          G{groupNumber}
                        </a>
                      ))}
                    </div>
                  ) : (
                    <span className="block truncate text-[11px] font-medium text-emerald-700">
                      All groups selected
                    </span>
                  )}
                </div>
                <button
                  className="shrink-0 rounded-md bg-slate-900 px-2.5 py-1.5 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={!canSubmit}
                  type="submit"
                >
                  Save
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </fieldset>
    </form>
  );
}
