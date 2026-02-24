"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type SelectionMap = Record<number, number | null>;
const GROUP_NUMBERS = [1, 2, 3, 4, 5, 6] as const;
const LEAVE_CONFIRM_MESSAGE = "You have unsaved Pick'em changes. Leave this page without saving?";

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
  const formRef = useRef<HTMLFormElement | null>(null);
  const submitInProgressRef = useRef(false);
  const submitIntentTimeoutRef = useRef<number | null>(null);
  const allowNextUnloadRef = useRef(false);
  const allowNextUnloadTimeoutRef = useRef<number | null>(null);

  const hasUnsavedChanges = useMemo(() => {
    const averageSpeedChanged = draftAverageSpeed.trim() !== existingAverageSpeed.trim();
    const picksChanged = GROUP_NUMBERS.some(
      (groupNumber) => (draftSelection[groupNumber] ?? null) !== (savedSelection[groupNumber] ?? null)
    );
    return averageSpeedChanged || picksChanged;
  }, [draftAverageSpeed, draftSelection, existingAverageSpeed, savedSelection]);

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
