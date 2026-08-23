"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent
} from "react";
import { MobileActionDock } from "@/components/mobile-action-dock";
import {
  parsePickDraft,
  pickDraftStorageKey,
  shouldOfferPickDraftRecovery,
  type PickDraft
} from "@/lib/pick-draft";

type SelectionMap = Record<number, number | null>;
const LEAVE_CONFIRM_MESSAGE = "You have unsaved Pick'em changes. Leave this page without saving?";

type GroupSelectionStatus = "changed" | "missing" | "saved";

const groupSelectionStatus = (
  draftSelection: SelectionMap,
  savedSelection: SelectionMap,
  groupNumber: number
): GroupSelectionStatus => {
  const draftDriverId = draftSelection[groupNumber] ?? null;
  const savedDriverId = savedSelection[groupNumber] ?? null;

  if (draftDriverId === null) return "missing";
  return draftDriverId === savedDriverId ? "saved" : "changed";
};

const GROUP_STATUS_CLASSES: Record<GroupSelectionStatus, string> = {
  changed: "border-cyan-300 bg-cyan-50 text-cyan-800",
  missing: "ui-status-warning border-amber-200 bg-amber-50 text-amber-800",
  saved: "ui-status-success border-emerald-200 bg-emerald-50 text-emerald-800"
};

const GROUP_STATUS_LABELS: Record<GroupSelectionStatus, string> = {
  changed: "selected, not saved",
  missing: "not selected",
  saved: "saved"
};

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
  draftOwnerId: string;
  existingAverageSpeed: string;
  existingSavedAt: string | null;
  groups: DriverGroup[];
  picksLocked: boolean;
  raceId: number;
  savedSelection: SelectionMap;
};

export function PickemForm({
  action,
  canSubmit,
  draftOwnerId,
  existingAverageSpeed,
  existingSavedAt,
  groups,
  picksLocked,
  raceId,
  savedSelection
}: Props) {
  const groupNumbers = useMemo(() => groups.map((group) => group.groupNumber), [groups]);
  const [draftSelection, setDraftSelection] = useState<SelectionMap>(() => ({ ...savedSelection }));
  const [draftAverageSpeed, setDraftAverageSpeed] = useState(existingAverageSpeed);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [recoveryDraft, setRecoveryDraft] = useState<PickDraft | null>(null);
  const [draftStorageReady, setDraftStorageReady] = useState(false);
  const formRef = useRef<HTMLFormElement | null>(null);
  const submitInProgressRef = useRef(false);
  const submitIntentTimeoutRef = useRef<number | null>(null);
  const allowNextUnloadRef = useRef(false);
  const allowNextUnloadTimeoutRef = useRef<number | null>(null);
  const storageKey = useMemo(
    () => pickDraftStorageKey(draftOwnerId, raceId),
    [draftOwnerId, raceId]
  );

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

  const storeCurrentDraft = useCallback(() => {
    try {
      const draft: PickDraft = {
        averageSpeed: draftAverageSpeed,
        savedAt: new Date().toISOString(),
        selections: draftSelection,
        version: 1
      };
      window.localStorage.setItem(storageKey, JSON.stringify(draft));
    } catch {
      // Storage can be unavailable in private browsing; the form remains fully usable.
    }
  }, [draftAverageSpeed, draftSelection, storageKey]);

  const clearSubmitIntent = () => {
    submitInProgressRef.current = false;
    setIsSubmitting(false);
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

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    if (submitInProgressRef.current) {
      event.preventDefault();
      return;
    }
    if (hasUnsavedChanges) {
      storeCurrentDraft();
    }
    setIsSubmitting(true);
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
    try {
      if (picksLocked) {
        window.localStorage.removeItem(storageKey);
        setRecoveryDraft(null);
        setDraftStorageReady(true);
        return;
      }

      const storedDraft = parsePickDraft(window.localStorage.getItem(storageKey));
      if (
        storedDraft &&
        shouldOfferPickDraftRecovery(
          storedDraft,
          {
            averageSpeed: existingAverageSpeed,
            savedAt: existingSavedAt,
            selections: savedSelection
          },
          groupNumbers
        )
      ) {
        setRecoveryDraft(storedDraft);
      } else {
        window.localStorage.removeItem(storageKey);
        setRecoveryDraft(null);
      }
    } catch {
      setRecoveryDraft(null);
    } finally {
      setDraftStorageReady(true);
    }
  }, [
    existingAverageSpeed,
    existingSavedAt,
    groupNumbers,
    picksLocked,
    savedSelection,
    storageKey
  ]);

  useEffect(() => {
    if (!draftStorageReady) {
      return;
    }

    if (hasUnsavedChanges) {
      storeCurrentDraft();
      return;
    }

    if (!recoveryDraft) {
      try {
        window.localStorage.removeItem(storageKey);
      } catch {
        // Storage cleanup is best effort.
      }
    }
  }, [
    draftAverageSpeed,
    draftSelection,
    draftStorageReady,
    hasUnsavedChanges,
    recoveryDraft,
    storeCurrentDraft,
    storageKey
  ]);

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

      {recoveryDraft ? (
        <div
          className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-cyan-200 bg-cyan-50 px-3 py-2.5 text-sm text-cyan-950"
          role="status"
        >
          <div>
            <p className="font-semibold">Unsaved picks found on this device</p>
            <p className="mt-0.5 text-xs text-cyan-800">
              Continue that draft or discard it and keep the last saved submission.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              className="rounded-md border border-cyan-300 bg-white px-3 py-1.5 text-xs font-semibold text-cyan-900 hover:bg-cyan-100"
              onClick={() => {
                clearSubmitIntent();
                setDraftSelection({ ...recoveryDraft.selections });
                setDraftAverageSpeed(recoveryDraft.averageSpeed);
                setRecoveryDraft(null);
              }}
              type="button"
            >
              Continue draft
            </button>
            <button
              className="rounded-md px-3 py-1.5 text-xs font-semibold text-cyan-900 hover:bg-cyan-100"
              onClick={() => {
                try {
                  window.localStorage.removeItem(storageKey);
                } catch {
                  // Storage cleanup is best effort.
                }
                setRecoveryDraft(null);
              }}
              type="button"
            >
              Discard
            </button>
          </div>
        </div>
      ) : null}

      <fieldset className="space-y-5 disabled:opacity-80" disabled={picksLocked || isSubmitting}>
        <section className="ui-panel rounded-lg border border-slate-200 bg-white px-3 py-3 sm:px-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-semibold text-slate-900">Driver groups</p>
            <p className="text-xs font-semibold tabular-nums text-slate-500">
              {selectedGroupCount}/{groupNumbers.length} selected
            </p>
          </div>
          <nav aria-label="Driver group navigation" className="mt-2 overflow-x-auto pb-0.5">
            <div className="flex w-max min-w-full gap-1.5 sm:w-full">
              {groupNumbers.map((groupNumber) => {
                const status = groupSelectionStatus(
                  draftSelection,
                  savedSelection,
                  groupNumber
                );

                return (
                  <a
                    aria-label={`Group ${groupNumber}, ${GROUP_STATUS_LABELS[status]}`}
                    className={`inline-flex h-8 min-w-9 flex-1 items-center justify-center rounded-md border px-2 text-xs font-semibold ${GROUP_STATUS_CLASSES[status]}`}
                    href={`#driver-group-${groupNumber}`}
                    key={`group-navigation-${groupNumber}`}
                  >
                    G{groupNumber}
                  </a>
                );
              })}
            </div>
          </nav>
        </section>

        <section className="rounded-lg ui-panel border border-slate-200 bg-white px-4 py-4 md:px-5">
          <label className="grid items-end gap-3 sm:grid-cols-[minmax(0,1fr)_15rem]">
            <span>
              <span className="block text-sm font-semibold text-slate-900">
                Average Speed Tie-breaker (MPH)
              </span>
              <span className="mt-1 block text-xs leading-5 text-slate-500">
                Used only if multiple teams tie for the weekly win.
              </span>
            </span>
            <input
              required
              className="w-full rounded-md ui-control-border border border-slate-300 px-3 py-2.5 text-sm"
              min={1}
              max={300}
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
            className="scroll-mt-4 rounded-lg ui-panel border border-slate-200 bg-white p-4 md:p-5"
          >
            <div>
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
            </div>

            {group.drivers.length === 0 ? (
              <p className="mt-3 text-sm text-slate-600">No active drivers in this group.</p>
            ) : (
              <div className="mt-3 grid gap-2.5 md:grid-cols-2">
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
                      className={`relative flex min-h-20 cursor-pointer items-center gap-2.5 rounded-md border px-3 py-2.5 shadow-sm transition hover:-translate-y-0.5 focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-blue-600 ${cardClassName}`}
                    >
                      <input
                        required
                        className="sr-only"
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

                      <span
                        aria-hidden
                        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                          isSelected
                            ? "border-cyan-700 bg-cyan-700"
                            : "border-slate-400 bg-white"
                        }`}
                      >
                        {isSelected ? <span className="h-1.5 w-1.5 rounded-full bg-white" /> : null}
                      </span>

                      {driver.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          alt={driver.driverName}
                          className="h-14 w-14 rounded-md ui-control-border border border-slate-300 object-cover"
                          decoding="async"
                          height={56}
                          loading="lazy"
                          src={driver.imageUrl}
                          width={56}
                        />
                      ) : (
                        <div className="flex h-14 w-14 items-center justify-center rounded-md border border-dashed border-slate-400 text-[10px] font-semibold text-slate-500">
                          NO IMG
                        </div>
                      )}

                      <div>
                        <p className="pr-20 text-sm font-semibold text-slate-900">
                          {driver.driverName}
                        </p>
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
          className="rounded-md ui-action-primary bg-slate-900 px-5 py-3 text-sm font-semibold text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={!canSubmit || isSubmitting}
          type="submit"
        >
          {picksLocked
            ? "Picks are locked"
            : isSubmitting
              ? "Saving picks..."
              : "Save Pick'em Form"}
        </button>

        {showMobileActionBar ? (
          <MobileActionDock>
            <div className="ui-panel ui-panel-translucent mx-auto max-w-md rounded-lg border border-slate-200 bg-white/95 px-2.5 py-1.5 shadow-[0_18px_45px_-28px_rgba(15,23,42,0.9)] backdrop-blur">
              <div className="flex items-center justify-between gap-2">
                <p className="shrink-0 text-xs font-semibold text-slate-800">
                  {selectedGroupCount}/{groupNumbers.length} groups
                </p>
                <div className="min-w-0 flex-1 overflow-x-auto">
                  <div className="flex w-max gap-1">
                    {groupNumbers.map((groupNumber) => {
                      const status = groupSelectionStatus(
                        draftSelection,
                        savedSelection,
                        groupNumber
                      );

                      return (
                        <a
                          aria-label={`Group ${groupNumber}, ${GROUP_STATUS_LABELS[status]}`}
                          className={`rounded-md border px-2 py-0.5 text-[11px] font-semibold ${GROUP_STATUS_CLASSES[status]}`}
                          href={`#driver-group-${groupNumber}`}
                          key={`dock-group-${groupNumber}`}
                        >
                          G{groupNumber}
                        </a>
                      );
                    })}
                  </div>
                </div>
                <button
                  className="shrink-0 rounded-md ui-action-primary bg-slate-900 px-2.5 py-1.5 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={!canSubmit || isSubmitting}
                  type="submit"
                >
                  {isSubmitting ? "Saving..." : "Save"}
                </button>
              </div>
            </div>
          </MobileActionDock>
        ) : null}
      </fieldset>
    </form>
  );
}
