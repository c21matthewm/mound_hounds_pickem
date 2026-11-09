"use client";

import { useState } from "react";
import { parseIndycarResultsPaste } from "@/lib/indycar-results";
import { buildRaceResultsPreview, MAX_STANDARD_NONSTARTERS, type RaceResultsPreview } from "@/lib/race-results-preview";
import type { RacePickFormat } from "@/lib/race-format";
import { SubmitButton } from "@/components/submit-button";

type RaceOption = {
  id: number;
  pickFormat: RacePickFormat;
  raceName: string;
  resultsStatus: "draft" | "published";
};

type DriverOption = {
  driverName: string;
  groupNumber: number;
  id: number;
  isActive: boolean;
};

type ParticipantOption = {
  id: string;
  teamName: string;
};

type PickSummary = {
  race_id: number;
  user_id: string;
};

type RaceDriverGroupOption = {
  driver_id: number;
  group_number: number;
  qualifying_position: number | null;
  race_id: number;
};

type PreviewState = RaceResultsPreview & {
  inputKey: string;
  noPickTeamNames: string[];
  selectedRaceName: string;
  selectedRacePickFormat: RacePickFormat;
};

type Props = {
  action: (formData: FormData) => void | Promise<void>;
  drivers: DriverOption[];
  participants: ParticipantOption[];
  picks: PickSummary[];
  raceDriverGroups: RaceDriverGroupOption[];
  selectedRace: RaceOption | null;
};

const buildInputKey = (raceId: string, rawPaste: string): string => `${raceId}::${rawPaste}`;

const summaryCardClassName = "rounded-md ui-panel border border-slate-200 bg-white px-3 py-3 shadow-sm";

const formatScore = (value: number | null): string => (value === null ? "Incomplete" : String(value));

export function AdminResultsImportForm({
  action,
  drivers,
  participants,
  picks,
  raceDriverGroups,
  selectedRace
}: Props) {
  const [rawPaste, setRawPaste] = useState("");
  const [previewState, setPreviewState] = useState<PreviewState | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const raceId = selectedRace ? String(selectedRace.id) : "";

  const currentInputKey = buildInputKey(raceId, rawPaste);
  const previewIsStale = previewState ? previewState.inputKey !== currentInputKey : false;
  const canPublish = previewState !== null && !previewIsStale && previewState.canPublishManually;

  const runPreview = () => {
    if (!selectedRace) {
      setPreviewError("Select a race before previewing.");
      setPreviewState(null);
      return;
    }
    if (!rawPaste.trim()) {
      setPreviewError("Paste results text before previewing.");
      setPreviewState(null);
      return;
    }
    const preview = buildRaceResultsPreview({
      drivers,
      parsed: parseIndycarResultsPaste(rawPaste),
      pickFormat: selectedRace.pickFormat,
      raceDriverGroups,
      raceId: selectedRace.id
    });
    if (preview.parsedRowCount === 0) {
      setPreviewError("No result rows were detected from your pasted table.");
      setPreviewState(null);
      return;
    }
    if (preview.winningAverageSpeed === null) {
      setPreviewError(preview.flags.find(flag => flag.code === "missing_winning_speed")?.message ?? "The official winning average speed is missing.");
      setPreviewState(null);
      return;
    }
    const pickedUserIds = new Set(picks.filter(pick => pick.race_id === selectedRace.id).map(pick => pick.user_id));
    const noPickTeamNames = participants.filter(participant => !pickedUserIds.has(participant.id))
      .map(participant => participant.teamName).sort((a, b) => a.localeCompare(b));
    setPreviewError(null);
    setPreviewState({
      ...preview,
      inputKey: currentInputKey,
      noPickTeamNames,
      selectedRaceName: selectedRace.raceName,
      selectedRacePickFormat: selectedRace.pickFormat
    });
  };

  return (
    <form
      action={action}
      className="mt-5 rounded-md ui-panel-muted border border-slate-200 bg-slate-50 p-4"
      data-testid="admin-results-import-form"
    >
      <input name="tab" type="hidden" value="results" />
      <input name="race_id" type="hidden" value={raceId} />
      <input name="result_race_id" type="hidden" value={raceId} />
      <h3 className="text-sm font-semibold text-slate-900">Bulk Import (Preview to Publish)</h3>
      <p className="mt-1 text-xs text-slate-600">
        Step 1 preview parsed driver mappings, scoring ranges, and no-pick fallbacks. Step 2 publish only after preview is clean.
      </p>

      <div className="mt-3 grid gap-3 md:grid-cols-4">
        <div className="rounded-md ui-panel border border-slate-200 bg-white px-3 py-2 md:col-span-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Race</p>
          <p
            className="mt-1 text-sm font-semibold text-slate-900"
            data-testid="admin-results-import-race"
          >
            {selectedRace
              ? `${selectedRace.raceName}${
                  selectedRace.pickFormat === "indy_500" ? " (Indy 500)" : ""
                }`
              : "No race selected"}
          </p>
        </div>

        <label className="block md:col-span-3">
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">
            Pasted results table
          </span>
          <textarea
            required
            className="h-40 w-full rounded-md ui-control-border border border-slate-300 px-3 py-2 font-mono text-xs"
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
          className="rounded-md ui-control-border border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
          data-testid="admin-results-import-preview"
          onClick={runPreview}
          type="button"
        >
          Preview mapping
        </button>
        <SubmitButton
          className="rounded-md ui-action-primary bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
          data-testid="admin-results-import-submit"
          disabled={!canPublish}
          pendingLabel="Publishing..."
        >
          Publish results
        </SubmitButton>
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

      {selectedRace?.resultsStatus === "published" ? (
        <label className="mt-3 flex items-start gap-2 rounded-md border ui-status-danger border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-800">
          <input className="mt-0.5" name="confirm_results_correction" required type="checkbox" />
          Confirm that this is an intentional correction replacing already published results.
          Standings will be recalculated immediately.
        </label>
      ) : null}

      {previewError ? (
        <p className="mt-3 rounded-md border ui-status-danger border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {previewError}
        </p>
      ) : null}

      {previewState ? (
        <section className="mt-4 rounded-lg ui-panel border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h4 className="text-base font-semibold text-slate-900">
                Publish Preview: {previewState.selectedRaceName}
              </h4>
              <p className="mt-1 text-xs text-slate-600">
                {previewState.selectedRacePickFormat === "indy_500"
                  ? "Indianapolis 500 format: 8 qualifying-order groups."
                  : "Standard format: 6 championship-standing groups."}
              </p>
            </div>
            <span className="rounded-full ui-control-border border border-slate-300 bg-slate-50 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-slate-700">
              {previewState.groupCount} groups
            </span>
          </div>

          <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <div className={summaryCardClassName}>
              <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Official / Pickable
              </dt>
              <dd className="mt-1 text-2xl font-semibold text-emerald-700">
                {previewState.readyCount}/{previewState.expectedResultCount}
              </dd>
            </div>
            <div className={summaryCardClassName}>
              <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Zero-Point Nonstarters
              </dt>
              <dd className="mt-1 text-2xl font-semibold text-amber-700">
                {previewState.zeroPointDriverNames.length}
              </dd>
            </div>
            <div className={summaryCardClassName}>
              <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Unmatched Rows
              </dt>
              <dd className="mt-1 text-2xl font-semibold text-red-700">{previewState.unmatchedLineCount}</dd>
            </div>
            <div className={summaryCardClassName}>
              <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Winner Avg Speed
              </dt>
              <dd className="mt-1 text-2xl font-semibold text-slate-900">
                {previewState.winningAverageSpeed?.toFixed(3) ?? "-"}
              </dd>
            </div>
            <div className={summaryCardClassName}>
              <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                No-Pick Users
              </dt>
              <dd className="mt-1 text-2xl font-semibold text-amber-700">
                {previewState.noPickTeamNames.length}
              </dd>
            </div>
            <div className={summaryCardClassName}>
              <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Highest Possible
              </dt>
              <dd className="mt-1 text-2xl font-semibold text-slate-900">
                {formatScore(previewState.highestPossibleScore)}
              </dd>
            </div>
            <div className={summaryCardClassName}>
              <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Lowest Possible
              </dt>
              <dd className="mt-1 text-2xl font-semibold text-slate-900">
                {formatScore(previewState.lowestPossibleScore)}
              </dd>
            </div>
            <div className={summaryCardClassName}>
              <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Duplicates
              </dt>
              <dd className="mt-1 text-2xl font-semibold text-amber-700">{previewState.duplicateCount}</dd>
            </div>
            <div className={summaryCardClassName}>
              <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Ignored Lines
              </dt>
              <dd className="mt-1 text-2xl font-semibold text-slate-900">{previewState.ignoredLineCount}</dd>
            </div>
          </dl>

          {previewState.flags.filter(flag => ["invalid_points", "invalid_field_group", "conflicting_field_group", "incomplete_qualifying_field"].includes(flag.code)).map(flag => (
            <p className="mt-3 rounded-md border ui-status-danger border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700" key={`${flag.code}:${flag.message}`}>
              {flag.message}
            </p>
          ))}

          {previewState.missingScoreGroups.length > 0 ? (
            <p className="mt-3 rounded-md border ui-status-warning border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              Highest/lowest possible scores need at least one mapped result in each pick group.
              Missing group(s): {previewState.missingScoreGroups.join(", ")}.
            </p>
          ) : null}

          {!previewState.positionsValid ? (
            <p className="mt-3 rounded-md border ui-status-danger border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              Finishing positions must be unique and contiguous from 1 through the final official row.
            </p>
          ) : null}

          {previewState.missingOfficialGroups.length > 0 ? (
            <p className="mt-3 rounded-md border ui-status-danger border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              The official order has no participating driver from group(s): {previewState.missingOfficialGroups.join(", ")}.
            </p>
          ) : null}

          {previewState.zeroPointDriverNames.length > MAX_STANDARD_NONSTARTERS ? (
            <p className="mt-3 rounded-md border ui-status-danger border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              More than {MAX_STANDARD_NONSTARTERS} snapshotted drivers are missing. Review the pasted table before publishing.
            </p>
          ) : null}

          {previewState.zeroPointDriverNames.length > 0 ? (
            <div className="mt-3 rounded-md border ui-status-warning border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              <p className="font-semibold">
                These pickable drivers are absent from the official finishing order and will receive 0 points.
              </p>
              <p className="mt-1">{previewState.zeroPointDriverNames.join(", ")}</p>
            </div>
          ) : null}

          {previewState.unmatchedDriverNames.length > 0 ? (
            <p className="mt-3 rounded-md border ui-status-danger border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              Unmatched drivers: {previewState.unmatchedDriverNames.join(", ")}
            </p>
          ) : null}

          {previewState.noPickTeamNames.length > 0 ? (
            <div className="mt-3 rounded-md border ui-status-warning border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              <p className="font-semibold">No-pick users will receive the lowest possible score.</p>
              <p className="mt-1">
                {previewState.noPickTeamNames.slice(0, 12).join(", ")}
                {previewState.noPickTeamNames.length > 12
                  ? `, +${previewState.noPickTeamNames.length - 12} more`
                  : ""}
              </p>
            </div>
          ) : null}

          <div className="mt-4 max-h-72 overflow-auto rounded border border-slate-200">
            <table className="min-w-full text-left text-xs">
              <thead className="ui-table-head bg-slate-50 text-slate-700">
                <tr>
                  <th className="px-2 py-1.5 font-semibold">Line</th>
                  <th className="px-2 py-1.5 font-semibold">Position</th>
                  <th className="px-2 py-1.5 font-semibold">Pasted Driver</th>
                  <th className="px-2 py-1.5 font-semibold">Mapped Driver</th>
                  <th className="px-2 py-1.5 font-semibold">Group</th>
                  <th className="px-2 py-1.5 font-semibold">Points</th>
                  <th className="px-2 py-1.5 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                {previewState.rows.map((row) => (
                  <tr
                    key={`preview-line-${row.lineNumber}-${row.sourceDriverName}`}
                    className="border-t border-slate-200"
                  >
                    <td className="px-2 py-1.5">{row.lineNumber}</td>
                    <td className="px-2 py-1.5">{row.position ?? "-"}</td>
                    <td className="px-2 py-1.5">{row.sourceDriverName}</td>
                    <td className="px-2 py-1.5">{row.mappedDriverName ?? "-"}</td>
                    <td className="px-2 py-1.5">{row.groupNumber ? `G${row.groupNumber}` : "-"}</td>
                    <td className="px-2 py-1.5">{row.points}</td>
                    <td className="px-2 py-1.5">
                      {row.status === "ready" ? (
                        <span className="font-semibold text-emerald-700">Ready</span>
                      ) : row.status === "duplicate" ? (
                        <span className="font-semibold text-amber-700">Duplicate</span>
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
