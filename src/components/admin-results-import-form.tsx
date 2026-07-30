"use client";

import { useMemo, useState } from "react";
import { normalizeDriverName, parseIndycarResultsPaste } from "@/lib/indycar-results";
import {
  groupNumbersForCount,
  normalizeRacePickFormat,
  pickGroupCountForFormat,
  type RacePickFormat
} from "@/lib/race-format";
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

type PreviewRow = {
  groupNumber: number | null;
  lineNumber: number;
  mappedDriverId: number | null;
  mappedDriverName: string | null;
  points: number;
  position: number | null;
  sourceDriverName: string;
  status: "duplicate" | "ready" | "unmatched";
};

type PreviewState = {
  duplicateCount: number;
  expectedResultCount: number;
  groupCount: number;
  highestPossibleScore: number | null;
  ignoredLineCount: number;
  inputKey: string;
  lowestPossibleScore: number | null;
  missingOfficialGroups: number[];
  missingScoreGroups: number[];
  noPickTeamNames: string[];
  parsedRowCount: number;
  positionsValid: boolean;
  readyCount: number;
  rows: PreviewRow[];
  selectedRaceName: string;
  selectedRacePickFormat: RacePickFormat;
  unmatchedDriverNames: string[];
  unmatchedLineCount: number;
  winningAverageSpeed: number | null;
  zeroPointDriverNames: string[];
};

const MAX_STANDARD_NONSTARTERS = 5;

type Props = {
  action: (formData: FormData) => void | Promise<void>;
  drivers: DriverOption[];
  participants: ParticipantOption[];
  picks: PickSummary[];
  raceDriverGroups: RaceDriverGroupOption[];
  selectedRace: RaceOption | null;
};

const buildInputKey = (raceId: string, rawPaste: string): string => `${raceId}::${rawPaste}`;

const summaryCardClassName = "rounded-md border border-slate-200 bg-white px-3 py-3 shadow-sm";

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

  const driverMap = useMemo(() => {
    const byNormalizedName = new Map<string, { groupNumber: number; id: number; name: string }>();
    drivers.forEach((driver) => {
      byNormalizedName.set(normalizeDriverName(driver.driverName), {
        groupNumber: driver.groupNumber,
        id: driver.id,
        name: driver.driverName
      });
    });
    return byNormalizedName;
  }, [drivers]);

  const driverById = useMemo(() => {
    const byId = new Map<number, DriverOption>();
    drivers.forEach((driver) => byId.set(driver.id, driver));
    return byId;
  }, [drivers]);

  const currentInputKey = buildInputKey(raceId, rawPaste);
  const previewIsStale = previewState ? previewState.inputKey !== currentInputKey : false;
  const canPublish =
    previewState !== null &&
    !previewIsStale &&
    previewState.readyCount > 0 &&
    previewState.readyCount <= previewState.expectedResultCount &&
    (previewState.selectedRacePickFormat === "standard" ||
      previewState.readyCount === previewState.expectedResultCount) &&
    previewState.duplicateCount === 0 &&
    previewState.unmatchedLineCount === 0 &&
    previewState.positionsValid &&
    previewState.missingOfficialGroups.length === 0 &&
    previewState.zeroPointDriverNames.length <= MAX_STANDARD_NONSTARTERS &&
    previewState.winningAverageSpeed !== null &&
    previewState.missingScoreGroups.length === 0;

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

    const selectedRaceId = Number(raceId);
    const racePickFormat = normalizeRacePickFormat(selectedRace.pickFormat);
    const groupCount = pickGroupCountForFormat(racePickFormat);
    const groupNumbers = groupNumbersForCount(groupCount);
    const raceGroupByDriverId = new Map<number, number>();
    raceDriverGroups
      .filter((group) => group.race_id === selectedRaceId)
      .forEach((group) => {
        raceGroupByDriverId.set(group.driver_id, group.group_number);
      });
    const expectedDriverIds =
      raceGroupByDriverId.size > 0
        ? new Set(raceGroupByDriverId.keys())
        : new Set(
            racePickFormat === "standard"
              ? drivers
                  .filter(
                    (driver) =>
                      driver.isActive && driver.groupNumber >= 1 && driver.groupNumber <= groupCount
                  )
                  .map((driver) => driver.id)
              : []
          );

    const resolveGroupNumber = (driverId: number): number | null => {
      const raceGroup = raceGroupByDriverId.get(driverId);
      if (raceGroup !== undefined) {
        return raceGroup;
      }

      if (racePickFormat === "standard") {
        return driverById.get(driverId)?.groupNumber ?? null;
      }

      return null;
    };

    const seenDriverIds = new Set<number>();
    const unmatchedNames = new Set<string>();
    const previewRows: PreviewRow[] = parsed.rows.map((row) => {
      const normalized = normalizeDriverName(row.driverName);
      const matched = driverMap.get(normalized);

      if (!matched) {
        unmatchedNames.add(row.driverName);
        return {
          groupNumber: null,
          lineNumber: row.lineNumber,
          mappedDriverId: null,
          mappedDriverName: null,
          points: row.points,
          position: row.position,
          sourceDriverName: row.driverName,
          status: "unmatched"
        };
      }

      if (!expectedDriverIds.has(matched.id)) {
        unmatchedNames.add(`${row.driverName} (outside race field)`);
        return {
          groupNumber: null,
          lineNumber: row.lineNumber,
          mappedDriverId: matched.id,
          mappedDriverName: matched.name,
          points: row.points,
          position: row.position,
          sourceDriverName: row.driverName,
          status: "unmatched"
        };
      }

      if (seenDriverIds.has(matched.id)) {
        return {
          groupNumber: resolveGroupNumber(matched.id),
          lineNumber: row.lineNumber,
          mappedDriverId: matched.id,
          mappedDriverName: matched.name,
          points: row.points,
          position: row.position,
          sourceDriverName: row.driverName,
          status: "duplicate"
        };
      }

      seenDriverIds.add(matched.id);
      return {
        groupNumber: resolveGroupNumber(matched.id),
        lineNumber: row.lineNumber,
        mappedDriverId: matched.id,
        mappedDriverName: matched.name,
        points: row.points,
        position: row.position,
        sourceDriverName: row.driverName,
        status: "ready"
      };
    });

    const readyCount = previewRows.filter((row) => row.status === "ready").length;
    const duplicateCount = previewRows.filter((row) => row.status === "duplicate").length;
    const unmatchedLineCount = previewRows.filter((row) => row.status === "unmatched").length;
    const readyRows = previewRows.filter((row) => row.status === "ready");
    const readyPositions = readyRows
      .map((row) => row.position)
      .filter((position): position is number => position !== null);
    const sortedPositions = [...readyPositions].sort((a, b) => a - b);
    const positionsValid =
      readyPositions.length === readyRows.length &&
      new Set(readyPositions).size === readyRows.length &&
      sortedPositions.every((position, index) => position === index + 1);
    const zeroPointDriverIds = Array.from(expectedDriverIds).filter(
      (driverId) => !seenDriverIds.has(driverId)
    );
    const zeroPointDriverNames = zeroPointDriverIds
      .map((driverId) => driverById.get(driverId)?.driverName ?? `Driver #${driverId}`)
      .sort((a, b) => a.localeCompare(b));
    const pointsByGroup = new Map<number, number[]>();
    for (const groupNumber of groupNumbers) {
      pointsByGroup.set(groupNumber, []);
    }

    previewRows.forEach((row) => {
      if (row.status !== "ready" || !row.groupNumber) {
        return;
      }

      const points = pointsByGroup.get(row.groupNumber) ?? [];
      points.push(row.points);
      pointsByGroup.set(row.groupNumber, points);
    });

    const missingOfficialGroups = groupNumbers.filter(
      (groupNumber) => (pointsByGroup.get(groupNumber) ?? []).length === 0
    );

    zeroPointDriverIds.forEach((driverId) => {
      const groupNumber = resolveGroupNumber(driverId);
      if (!groupNumber) {
        return;
      }

      const points = pointsByGroup.get(groupNumber) ?? [];
      points.push(0);
      pointsByGroup.set(groupNumber, points);
    });

    const missingScoreGroups: number[] = [];
    let highestPossibleScore = 0;
    let lowestPossibleScore = 0;
    for (const groupNumber of groupNumbers) {
      const groupPoints = pointsByGroup.get(groupNumber) ?? [];
      if (groupPoints.length === 0) {
        missingScoreGroups.push(groupNumber);
        continue;
      }

      highestPossibleScore += Math.max(...groupPoints);
      lowestPossibleScore += Math.min(...groupPoints);
    }

    const pickedUserIds = new Set(
      picks.filter((pick) => pick.race_id === selectedRaceId).map((pick) => pick.user_id)
    );
    const noPickTeamNames = participants
      .filter((participant) => !pickedUserIds.has(participant.id))
      .map((participant) => participant.teamName)
      .sort((a, b) => a.localeCompare(b));

    setPreviewError(null);
    setPreviewState({
      duplicateCount,
      expectedResultCount: expectedDriverIds.size,
      groupCount,
      highestPossibleScore: missingScoreGroups.length > 0 ? null : highestPossibleScore,
      ignoredLineCount: parsed.ignoredLineCount,
      inputKey: currentInputKey,
      lowestPossibleScore: missingScoreGroups.length > 0 ? null : lowestPossibleScore,
      missingOfficialGroups,
      missingScoreGroups,
      noPickTeamNames,
      parsedRowCount: parsed.rows.length,
      positionsValid,
      readyCount,
      rows: previewRows,
      selectedRaceName: selectedRace.raceName,
      selectedRacePickFormat: racePickFormat,
      unmatchedDriverNames: Array.from(unmatchedNames),
      unmatchedLineCount,
      winningAverageSpeed: parsed.winningAverageSpeed,
      zeroPointDriverNames
    });
  };

  return (
    <form
      action={action}
      className="mt-5 rounded-md border border-slate-200 bg-slate-50 p-4"
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
        <div className="rounded-md border border-slate-200 bg-white px-3 py-2 md:col-span-1">
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
        <SubmitButton
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
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
        <label className="mt-3 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-800">
          <input className="mt-0.5" name="confirm_results_correction" required type="checkbox" />
          Confirm that this is an intentional correction replacing already published results.
          Standings will be recalculated immediately.
        </label>
      ) : null}

      {previewError ? (
        <p className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {previewError}
        </p>
      ) : null}

      {previewState ? (
        <section className="mt-4 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
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
            <span className="rounded-full border border-slate-300 bg-slate-50 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-slate-700">
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

          {previewState.missingScoreGroups.length > 0 ? (
            <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              Highest/lowest possible scores need at least one mapped result in each pick group.
              Missing group(s): {previewState.missingScoreGroups.join(", ")}.
            </p>
          ) : null}

          {!previewState.positionsValid ? (
            <p className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              Finishing positions must be unique and contiguous from 1 through the final official row.
            </p>
          ) : null}

          {previewState.missingOfficialGroups.length > 0 ? (
            <p className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              The official order has no participating driver from group(s): {previewState.missingOfficialGroups.join(", ")}.
            </p>
          ) : null}

          {previewState.zeroPointDriverNames.length > MAX_STANDARD_NONSTARTERS ? (
            <p className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              More than {MAX_STANDARD_NONSTARTERS} snapshotted drivers are missing. Review the pasted table before publishing.
            </p>
          ) : null}

          {previewState.zeroPointDriverNames.length > 0 ? (
            <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              <p className="font-semibold">
                These pickable drivers are absent from the official finishing order and will receive 0 points.
              </p>
              <p className="mt-1">{previewState.zeroPointDriverNames.join(", ")}</p>
            </div>
          ) : null}

          {previewState.unmatchedDriverNames.length > 0 ? (
            <p className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              Unmatched drivers: {previewState.unmatchedDriverNames.join(", ")}
            </p>
          ) : null}

          {previewState.noPickTeamNames.length > 0 ? (
            <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
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
              <thead className="bg-slate-50 text-slate-700">
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
