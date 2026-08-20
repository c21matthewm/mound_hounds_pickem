"use client";

import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import {
  type SeasonRestorePointSummary,
  type SeasonRestorePreview
} from "@/lib/season-recovery";
import { CompactNotice, MetricStrip, SectionHeader, StatusChip } from "@/components/ui-primitives";

type Props = {
  activeSeason: {
    id: number;
    seasonYear: number;
  } | null;
  requestToken: string;
  restorePoints: SeasonRestorePointSummary[];
};

type RecoveryResponse<T> = {
  data?: T;
  error?: string;
};

const RECOVERY_ENDPOINT = "/api/admin/season-backups";

const formatDateTime = (value: string): string =>
  new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/Indiana/Indianapolis"
  }).format(new Date(value));

const sourceLabel = (source: SeasonRestorePointSummary["source"]): string => {
  switch (source) {
    case "result_checkpoint":
      return "Race checkpoint";
    case "pre_correction":
      return "Pre-correction";
    case "pre_rollover":
      return "Season milestone";
    case "automatic":
      return "Legacy automatic";
    case "pre_restore":
      return "Pre-restore safety";
    case "uploaded":
      return "Uploaded";
    default:
      return "Manual";
  }
};

const sourceTone = (
  source: SeasonRestorePointSummary["source"]
): "info" | "neutral" | "success" | "warning" => {
  if (source === "automatic" || source === "result_checkpoint") {
    return "success";
  }
  if (source === "pre_correction" || source === "pre_rollover" || source === "pre_restore") {
    return "warning";
  }
  return source === "uploaded" ? "info" : "neutral";
};

const postRecoveryAction = async <T,>(
  payload: Record<string, unknown>,
  requestToken: string
): Promise<T> => {
  const response = await fetch(RECOVERY_ENDPOINT, {
    body: JSON.stringify({ ...payload, requestToken }),
    headers: {
      "Content-Type": "application/json",
      "X-Mound-Hounds-Request": "season-recovery"
    },
    method: "POST"
  });
  const result = (await response.json()) as RecoveryResponse<T>;
  if (!response.ok || result.error || result.data === undefined) {
    throw new Error(result.error ?? "Season recovery request failed.");
  }
  return result.data;
};

const triggerDownload = (restorePointId: string): void => {
  const anchor = document.createElement("a");
  anchor.href = `${RECOVERY_ENDPOINT}?id=${encodeURIComponent(restorePointId)}`;
  anchor.download = "";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
};

export function SeasonRecoveryCenter({ activeSeason, requestToken, restorePoints }: Props) {
  const router = useRouter();
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [confirmationYear, setConfirmationYear] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [preview, setPreview] = useState<SeasonRestorePreview | null>(null);
  const [selectedId, setSelectedId] = useState(restorePoints[0]?.id ?? "");

  const selectedPoint = useMemo(
    () => restorePoints.find((point) => point.id === selectedId) ?? null,
    [restorePoints, selectedId]
  );
  const storedBytes = restorePoints.reduce(
    (sum, point) => sum + Number(point.snapshot_bytes ?? 0),
    0
  );
  const formattedStoredSize =
    storedBytes < 1024 * 1024
      ? `${Math.max(0, storedBytes / 1024).toFixed(1)} KB`
      : `${(storedBytes / (1024 * 1024)).toFixed(1)} MB`;

  const runAction = async (name: string, action: () => Promise<void>) => {
    setBusyAction(name);
    setError(null);
    setMessage(null);
    try {
      await action();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Season recovery request failed.");
    } finally {
      setBusyAction(null);
    }
  };

  const createAndDownload = () =>
    runAction("create", async () => {
      if (!activeSeason) {
        throw new Error("Activate a season before creating a backup.");
      }

      const created = await postRecoveryAction<{ id: string }>(
        {
          action: "create",
          label: `Manual download before weekly operations ${new Date().toISOString()}`,
          seasonId: activeSeason.id
        },
        requestToken
      );
      setMessage("Backup created and download started. Store the JSON file somewhere outside the app.");
      triggerDownload(created.id);
      router.refresh();
    });

  const importBackup = (file: File) =>
    runAction("import", async () => {
      if (file.size > 8 * 1024 * 1024) {
        throw new Error("Backup file is larger than the supported 8 MB limit.");
      }

      let document: unknown;
      try {
        document = JSON.parse(await file.text());
      } catch {
        throw new Error("The selected file is not valid JSON.");
      }

      const imported = await postRecoveryAction<{ id: string; seasonYear: number }>(
        { action: "import", document },
        requestToken
      );
      setSelectedId(imported.id);
      setPreview(null);
      setMessage(
        `${imported.seasonYear} backup validated and imported. Preview it before considering a restore.`
      );
      if (uploadInputRef.current) {
        uploadInputRef.current.value = "";
      }
      router.refresh();
    });

  const previewRestore = () =>
    runAction("preview", async () => {
      if (!selectedPoint) {
        throw new Error("Select a restore point first.");
      }
      const nextPreview = await postRecoveryAction<SeasonRestorePreview>(
        { action: "preview", restorePointId: selectedPoint.id },
        requestToken
      );
      setPreview(nextPreview);
      setConfirmationYear("");
      setMessage("Preview loaded. Changed rows will be replaced only if you complete the restore.");
    });

  const restore = () =>
    runAction("restore", async () => {
      if (!selectedPoint || !preview) {
        throw new Error("Preview the selected restore point before restoring.");
      }
      if (confirmationYear !== String(selectedPoint.season_year)) {
        throw new Error(`Type ${selectedPoint.season_year} exactly to confirm this restore.`);
      }
      if (
        !window.confirm(
          `Restore the ${selectedPoint.season_year} season from "${selectedPoint.label}"? Current season data will be replaced, and a safety point will be created first.`
        )
      ) {
        return;
      }

      const restored = await postRecoveryAction<{
        restoredAt: string;
        safetyPointId: string;
      }>(
        {
          action: "restore",
          confirmationYear: Number(confirmationYear),
          restorePointId: selectedPoint.id
        },
        requestToken
      );
      setPreview(null);
      setConfirmationYear("");
      setMessage(
        `Season restored successfully. A pre-restore safety point (${restored.safetyPointId}) was retained.`
      );
      router.refresh();
    });

  const differenceRows = preview ? Object.entries(preview.differences) : [];
  const changedTableCount = differenceRows.filter(([, row]) => row.differentRows > 0).length;

  return (
    <section className="mt-6 min-w-0">
      <SectionHeader
        description="Create portable season backups and restore season-owned data after reviewing an exact comparison."
        eyebrow="Admin Safety"
        title="Season Recovery"
      />

      <MetricStrip
        className="mt-4 grid-cols-2"
        items={[
          { label: "Stored points", value: restorePoints.length },
          { label: "Stored size", value: formattedStoredSize }
        ]}
      />

      {error ? <CompactNotice className="mt-4" tone="danger">{error}</CompactNotice> : null}
      {message ? <CompactNotice className="mt-4" tone="success">{message}</CompactNotice> : null}

      <div className="mt-5 border-y border-slate-200 py-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-base font-semibold text-slate-950">Download a fresh backup</h3>
            <p className="mt-1 text-sm text-slate-600">
              Use this before results corrections, season rollover, or any unusual database work.
            </p>
          </div>
          <button
            className="min-h-10 rounded-md ui-action-primary bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
            disabled={!activeSeason || busyAction !== null}
            onClick={createAndDownload}
            type="button"
          >
            {busyAction === "create" ? "Creating..." : "Create & Download Backup"}
          </button>
        </div>

        <ol className="mt-4 grid gap-3 text-sm text-slate-700 sm:grid-cols-3">
          <li className="border-l-2 border-cyan-500 pl-3">
            <strong className="block text-slate-950">1. Download</strong>
            Create a new file immediately before important admin work.
          </li>
          <li className="border-l-2 border-cyan-500 pl-3">
            <strong className="block text-slate-950">2. Store elsewhere</strong>
            Keep it in a private cloud folder outside Supabase and Vercel.
          </li>
          <li className="border-l-2 border-cyan-500 pl-3">
            <strong className="block text-slate-950">3. Keep recent copies</strong>
            Retain at least the latest three files and never edit their contents.
          </li>
        </ol>
      </div>

      <div className="mt-5 grid min-w-0 gap-5 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <section className="min-w-0">
          <h3 className="text-base font-semibold text-slate-950">Choose a restore point</h3>
          <p className="mt-1 text-sm text-slate-600">
            Automatic points are saved after result publication. Downloaded files can be imported below.
          </p>

          <label className="mt-3 block">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">
              Restore point
            </span>
            <select
              className="w-full rounded-md ui-control-border border border-slate-300 bg-white px-3 py-2 text-sm"
              onChange={(event) => {
                setSelectedId(event.target.value);
                setPreview(null);
                setConfirmationYear("");
              }}
              value={selectedId}
            >
              <option value="">Select a restore point</option>
              {restorePoints.map((point) => (
                <option key={point.id} value={point.id}>
                  {formatDateTime(point.created_at)} - {point.label}
                </option>
              ))}
            </select>
          </label>

          {selectedPoint ? (
            <div className="mt-3 rounded-md ui-panel border border-slate-200 bg-white px-3 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <StatusChip tone={sourceTone(selectedPoint.source)}>
                  {sourceLabel(selectedPoint.source)}
                </StatusChip>
                <span className="text-xs text-slate-500">
                  Schema {selectedPoint.schema_version}
                </span>
              </div>
              <p className="mt-2 break-words text-sm font-semibold text-slate-950">
                {selectedPoint.label}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                {formatDateTime(selectedPoint.created_at)}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                {(Number(selectedPoint.snapshot_bytes ?? 0) / 1024).toFixed(1)} KB
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  className="min-h-10 rounded-md ui-control-border border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-800"
                  disabled={busyAction !== null}
                  onClick={() => triggerDownload(selectedPoint.id)}
                  type="button"
                >
                  Download
                </button>
                <button
                  className="min-h-10 rounded-md ui-action-primary bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
                  disabled={busyAction !== null}
                  onClick={previewRestore}
                  type="button"
                >
                  {busyAction === "preview" ? "Comparing..." : "Preview Restore"}
                </button>
              </div>
            </div>
          ) : (
            <CompactNotice className="mt-3">No restore point selected.</CompactNotice>
          )}

          <div className="mt-5 border-t border-slate-200 pt-4">
            <h4 className="text-sm font-semibold text-slate-950">Import a downloaded backup</h4>
            <p className="mt-1 text-sm text-slate-600">
              Import validates the checksum and adds the file to this list. It does not change live data.
            </p>
            <input
              accept="application/json,.json"
              className="mt-3 block w-full text-sm text-slate-700 file:mr-3 file:rounded-md file:border file:border-slate-300 file:bg-white file:px-3 file:py-2 file:text-sm file:font-semibold"
              disabled={busyAction !== null}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) {
                  void importBackup(file);
                }
              }}
              ref={uploadInputRef}
              type="file"
            />
          </div>
        </section>

        <section className="min-w-0 border-t border-slate-200 pt-5 lg:border-l lg:border-t-0 lg:pl-5 lg:pt-0">
          <h3 className="text-base font-semibold text-slate-950">Restore preview</h3>
          {!preview ? (
            <CompactNotice className="mt-3">
              Select a point and choose Preview Restore. Nothing is changed during preview.
            </CompactNotice>
          ) : (
            <>
              <MetricStrip
                className="mt-3 grid-cols-3"
                items={[
                  { label: "Season", value: preview.seasonYear },
                  { label: "Changed areas", value: changedTableCount },
                  {
                    label: "Restore point",
                    value: formatDateTime(preview.createdAt)
                  }
                ]}
              />

              <div className="mt-4 overflow-x-auto rounded-md border border-slate-200">
                <table className="min-w-full text-left text-sm">
                  <thead className="ui-table-head bg-slate-50 text-xs uppercase text-slate-600">
                    <tr>
                      <th className="px-3 py-2">Data</th>
                      <th className="px-3 py-2 text-right">Backup</th>
                      <th className="px-3 py-2 text-right">Current</th>
                      <th className="px-3 py-2 text-right">Changed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {differenceRows.map(([name, row]) => (
                      <tr className="border-t border-slate-200" key={name}>
                        <td className="whitespace-nowrap px-3 py-2 font-medium text-slate-900">
                          {name.replace(/([A-Z])/g, " $1")}
                        </td>
                        <td className="px-3 py-2 text-right">{row.backupCount}</td>
                        <td className="px-3 py-2 text-right">{row.currentCount}</td>
                        <td className="px-3 py-2 text-right">
                          <StatusChip tone={row.differentRows > 0 ? "warning" : "success"}>
                            {row.differentRows}
                          </StatusChip>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <CompactNotice className="mt-4" tone="warning">
                Restoring replaces current-season races, results, picks, saved pick versions,
                participant registrations, season driver state, and Hall of Fame data with this
                snapshot. Permanent account names, roles, passwords, and contact details are
                validated but are not overwritten.
              </CompactNotice>

              <label className="mt-4 block">
                <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">
                  Type {preview.seasonYear} to confirm
                </span>
                <input
                  className="w-full rounded-md ui-control-border border border-slate-300 px-3 py-2 text-base sm:max-w-52"
                  inputMode="numeric"
                  onChange={(event) => setConfirmationYear(event.target.value)}
                  placeholder={String(preview.seasonYear)}
                  value={confirmationYear}
                />
              </label>
              <button
                className="mt-3 min-h-10 w-full rounded-md border border-red-300 bg-red-50 px-4 py-2 text-sm font-semibold text-red-800 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
                disabled={
                  busyAction !== null ||
                  confirmationYear !== String(preview.seasonYear)
                }
                onClick={restore}
                type="button"
              >
                {busyAction === "restore" ? "Restoring..." : "Restore This Season"}
              </button>
            </>
          )}
        </section>
      </div>

      <CompactNotice className="mt-5">
        Automatic storage is bounded: only the newest checkpoint for each race and a small recent
        correction buffer are retained. Manual downloads, uploaded files, pre-restore points, and
        season milestones are preserved.
      </CompactNotice>

      <CompactNotice className="mt-3">
        Season backups intentionally exclude login passwords, Supabase Auth settings, Vercel
        environment variables, SMTP/API secrets, and image files. Keep those services configured
        separately; stored image URLs are included.
      </CompactNotice>
    </section>
  );
}
