"use client";

import { useMemo, useState } from "react";
import { normalizeDriverName, parseIndycarResultsPaste } from "@/lib/indycar-results";

type RaceOption = {
  id: number;
  raceName: string;
};

type DriverOption = {
  driverName: string;
  id: number;
};

type PreviewRow = {
  lineNumber: number;
  mappedDriverName: string | null;
  points: number;
  sourceDriverName: string;
  status: "duplicate" | "ready" | "unmatched";
};

type PreviewState = {
  duplicateCount: number;
  ignoredLineCount: number;
  inputKey: string;
  parsedRowCount: number;
  readyCount: number;
  rows: PreviewRow[];
  unmatchedDriverNames: string[];
  unmatchedLineCount: number;
  winningAverageSpeed: number | null;
};

type Props = {
  action: (formData: FormData) => void | Promise<void>;
  activeRaces: RaceOption[];
  drivers: DriverOption[];
};

const buildInputKey = (raceId: string, rawPaste: string): string => `${raceId}::${rawPaste}`;

export function AdminResultsImportForm({ action, activeRaces, drivers }: Props) {
  const [raceId, setRaceId] = useState("");
  const [rawPaste, setRawPaste] = useState("");
  const [previewState, setPreviewState] = useState<PreviewState | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const driverMap = useMemo(() => {
    const byNormalizedName = new Map<string, { id: number; name: string }>();
    drivers.forEach((driver) => {
      byNormalizedName.set(normalizeDriverName(driver.driverName), {
        id: driver.id,
        name: driver.driverName
      });
    });
    return byNormalizedName;
  }, [drivers]);

  const currentInputKey = buildInputKey(raceId, rawPaste);
  const previewIsStale = previewState ? previewState.inputKey !== currentInputKey : false;
  const canPublish =
    previewState !== null &&
    !previewIsStale &&
    previewState.readyCount > 0 &&
    previewState.unmatchedLineCount === 0 &&
    previewState.winningAverageSpeed !== null;

  const runPreview = () => {
    if (!raceId) {
      setPreviewError("Select a race before previewing.");
      setPreviewState(null);
      return;
    }

    if (!rawPaste.trim()) {
      setPreviewError("Paste results text before previewing.");
      setPreviewState(null);
      return;
    }

    const parsed = parseIndycarResultsPaste(rawPaste);
    if (parsed.rows.length === 0) {
      setPreviewError("No result rows were detected from your pasted table.");
      setPreviewState(null);
      return;
    }

    if (parsed.winningAverageSpeed === null) {
      setPreviewError(
        "Could not determine the official race average speed. Make sure the Average Speed column is included."
      );
      setPreviewState(null);
      return;
    }

    const seenDriverIds = new Set<number>();
    const unmatchedNames = new Set<string>();
    const previewRows: PreviewRow[] = parsed.rows.map((row) => {
      const normalized = normalizeDriverName(row.driverName);
      const matched = driverMap.get(normalized);

      if (!matched) {
        unmatchedNames.add(row.driverName);
        return {
          lineNumber: row.lineNumber,
          mappedDriverName: null,
          points: row.points,
          sourceDriverName: row.driverName,
          status: "unmatched"
        };
      }

      if (seenDriverIds.has(matched.id)) {
        return {
          lineNumber: row.lineNumber,
          mappedDriverName: matched.name,
          points: row.points,
          sourceDriverName: row.driverName,
          status: "duplicate"
        };
      }

      seenDriverIds.add(matched.id);
      return {
        lineNumber: row.lineNumber,
        mappedDriverName: matched.name,
        points: row.points,
        sourceDriverName: row.driverName,
        status: "ready"
      };
    });

    const readyCount = previewRows.filter((row) => row.status === "ready").length;
    const duplicateCount = previewRows.filter((row) => row.status === "duplicate").length;
    const unmatchedLineCount = previewRows.filter((row) => row.status === "unmatched").length;

    setPreviewError(null);
    setPreviewState({
      duplicateCount,
      ignoredLineCount: parsed.ignoredLineCount,
      inputKey: currentInputKey,
      parsedRowCount: parsed.rows.length,
      readyCount,
      rows: previewRows,
      unmatchedDriverNames: Array.from(unmatchedNames),
      unmatchedLineCount,
      winningAverageSpeed: parsed.winningAverageSpeed
    });
  };

  return (
    <form
      action={action}
      className="mt-5 rounded-md border border-slate-200 bg-slate-50 p-4"
      data-testid="admin-results-import-form"
    >
      <input name="tab" type="hidden" value="results" />
      <h3 className="text-sm font-semibold text-slate-900">Bulk Import (Preview to Publish)</h3>
      <p className="mt-1 text-xs text-slate-600">
        Step 1 preview parsed driver mappings. Step 2 publish only after preview is clean.
      </p>

      <div className="mt-3 grid gap-3 md:grid-cols-4">
        <label className="block md:col-span-1">
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">
            Race
          </span>
          <select
            required
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            data-testid="admin-results-import-race-select"
            name="race_id"
            onChange={(event) => setRaceId(event.target.value)}
            value={raceId}
          >
            <option value="">{activeRaces.length > 0 ? "Select race" : "No active races"}</option>
            {activeRaces.map((race) => (
              <option key={race.id} value={String(race.id)}>
                {race.raceName}
              </option>
            ))}
          </select>
        </label>

        <label className="block md:col-span-3">
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">
            Pasted results table
          </span>
          <textarea
            required
            className="h-40 w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-xs"
            data-testid="admin-results-import-paste"
            name="results_paste"
            onChange={(event) => setRawPaste(event.target.value)}
            placeholder={
              "1\t6\t2\tJosef Newgarden\tTeam Penske\t225\t60\t4\t01:54:50.6727\t156.342\tRunning\t51"
            }
            value={rawPaste}
          />
        </label>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
          data-testid="admin-results-import-preview"
          onClick={runPreview}
          type="button"
        >
          Preview mapping
        </button>
        <button
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
          data-testid="admin-results-import-submit"
          disabled={!canPublish}
          type="submit"
        >
          Publish results
        </button>
        {previewState ? (
          <p className="text-xs text-slate-600">
            {previewIsStale
              ? "Preview is stale. Run preview again before publishing."
              : canPublish
                ? "Preview is clean. Ready to publish."
                : "Preview has issues. Resolve before publishing."}
          </p>
        ) : null}
      </div>

      {previewState && !previewIsStale ? (
        <p className="mt-2 text-xs text-slate-600">
          Official race average speed detected: {previewState.winningAverageSpeed?.toFixed(3)}
        </p>
      ) : null}

      {previewError ? (
        <p className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {previewError}
        </p>
      ) : null}

      {previewState ? (
        <section className="mt-3 rounded-md border border-slate-200 bg-white p-3">
          <h4 className="text-sm font-semibold text-slate-900">Preview Summary</h4>
          <dl className="mt-2 grid gap-2 text-sm sm:grid-cols-4">
            <div className="rounded border border-slate-200 bg-slate-50 px-2 py-1.5">
              <dt className="text-[11px] uppercase tracking-wide text-slate-500">Parsed Rows</dt>
              <dd className="font-semibold text-slate-900">{previewState.parsedRowCount}</dd>
            </div>
            <div className="rounded border border-slate-200 bg-slate-50 px-2 py-1.5">
              <dt className="text-[11px] uppercase tracking-wide text-slate-500">Ready Rows</dt>
              <dd className="font-semibold text-emerald-700">{previewState.readyCount}</dd>
            </div>
            <div className="rounded border border-slate-200 bg-slate-50 px-2 py-1.5">
              <dt className="text-[11px] uppercase tracking-wide text-slate-500">Unmatched</dt>
              <dd className="font-semibold text-red-700">{previewState.unmatchedLineCount}</dd>
            </div>
            <div className="rounded border border-slate-200 bg-slate-50 px-2 py-1.5">
              <dt className="text-[11px] uppercase tracking-wide text-slate-500">Duplicates</dt>
              <dd className="font-semibold text-amber-700">{previewState.duplicateCount}</dd>
            </div>
          </dl>
          <p className="mt-2 text-xs text-slate-600">
            Ignored non-data lines: {previewState.ignoredLineCount}
          </p>
          {previewState.unmatchedDriverNames.length > 0 ? (
            <p className="mt-2 rounded border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-700">
              Unmatched drivers: {previewState.unmatchedDriverNames.join(", ")}
            </p>
          ) : null}

          <div className="mt-3 max-h-64 overflow-auto rounded border border-slate-200">
            <table className="min-w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-700">
                <tr>
                  <th className="px-2 py-1.5 font-semibold">Line</th>
                  <th className="px-2 py-1.5 font-semibold">Pasted Driver</th>
                  <th className="px-2 py-1.5 font-semibold">Mapped Driver</th>
                  <th className="px-2 py-1.5 font-semibold">Points</th>
                  <th className="px-2 py-1.5 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                {previewState.rows.map((row) => (
                  <tr key={`preview-line-${row.lineNumber}-${row.sourceDriverName}`} className="border-t border-slate-200">
                    <td className="px-2 py-1.5">{row.lineNumber}</td>
                    <td className="px-2 py-1.5">{row.sourceDriverName}</td>
                    <td className="px-2 py-1.5">{row.mappedDriverName ?? "-"}</td>
                    <td className="px-2 py-1.5">{row.points}</td>
                    <td className="px-2 py-1.5">
                      {row.status === "ready" ? (
                        <span className="font-semibold text-emerald-700">Ready</span>
                      ) : row.status === "duplicate" ? (
                        <span className="font-semibold text-amber-700">Duplicate (ignored)</span>
                      ) : (
                        <span className="font-semibold text-red-700">Unmatched</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </form>
  );
}
