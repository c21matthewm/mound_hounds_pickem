import { finalizeHallOfFameSeasonAction } from "@/app/admin/hall-of-fame-actions";
import {
  importIndy500QualifyingOrderAction,
  importIndycarResultsAction,
  publishSavedRaceResultsAction,
  upsertResultAction
} from "@/app/admin/result-actions";
import type {
  DriverRow,
  LeagueSeasonRow,
  PickSummaryRow,
  RaceDriverGroupRow,
  RaceRow,
  ResultRow,
  ScoringAudit,
  WinnerProfileRow
} from "@/app/admin/admin-types";
import {
  formatDateTime,
  formatOptionalDecimal
} from "@/app/admin/admin-data";
import { AdminResultsImportForm } from "@/components/admin-results-import-form";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { SubmitButton } from "@/components/submit-button";
import {
  AdminWorkspaceHeader,
  Disclosure,
  StatusChip
} from "@/components/ui-primitives";
import { normalizeRacePickFormat } from "@/lib/race-format";

type SavedHallOfFameSeason = {
  finalized_at: string;
  id: number;
  participant_count: number;
  race_count: number;
};

type AdminResultsWorkspaceProps = {
  activeIndy500Races: RaceRow[];
  activeParticipants: WinnerProfileRow[];
  activeSeason: LeagueSeasonRow | null;
  canFinalizeSeason: boolean;
  currentSeasonRaces: RaceRow[];
  driverNameById: Map<number, string>;
  drivers: DriverRow[];
  finalSeasonRace: RaceRow | undefined;
  hallOfFameMigrationReady: boolean;
  pickRows: PickSummaryRow[];
  raceById: Map<number, RaceRow>;
  raceDriverGroups: RaceDriverGroupRow[];
  results: ResultRow[];
  savedHallOfFameSeason: SavedHallOfFameSeason | null;
  scoringAudits: ScoringAudit[];
  selectedResultRace: RaceRow | null;
  sortedResults: ResultRow[];
  unpublishedSeasonRaces: RaceRow[];
};

export function AdminResultsWorkspace({
  activeIndy500Races,
  activeParticipants,
  activeSeason,
  canFinalizeSeason,
  currentSeasonRaces,
  driverNameById,
  drivers,
  finalSeasonRace,
  hallOfFameMigrationReady,
  pickRows,
  raceById,
  raceDriverGroups,
  results,
  savedHallOfFameSeason,
  scoringAudits,
  selectedResultRace,
  sortedResults,
  unpublishedSeasonRaces
}: AdminResultsWorkspaceProps) {
  return (
        <section
          className="mt-6 rounded-lg ui-panel border border-slate-200 bg-white p-4 sm:p-6"
          key={`results-workspace-${selectedResultRace?.id ?? "empty"}`}
        >
        <AdminWorkspaceHeader
          description="Select one race, validate its official results, then publish or correct that race."
          title="Race Results"
        />

        <div className="mt-4 rounded-md ui-panel-muted border border-slate-200 bg-slate-50 p-3">
          <form
            action="/admin"
            className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]"
            method="get"
          >
            <input name="tab" type="hidden" value="results" />
            <label className="block">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">
                Results workspace
              </span>
              <select
                className="w-full rounded-md ui-control-border border border-slate-300 bg-white px-3 py-2 text-sm"
                defaultValue={selectedResultRace ? String(selectedResultRace.id) : ""}
                name="result_race_id"
              >
                <option value="">
                  {currentSeasonRaces.length > 0 ? "Select race" : "No active-season races"}
                </option>
                {currentSeasonRaces.map((race) => (
                  <option key={`workspace-race-${race.id}`} value={race.id}>
                    R{race.round_number} · {race.race_name} ·{" "}
                    {race.results_status === "published" ? "Published" : "Draft"}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="self-end rounded-md ui-action-primary bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700"
              type="submit"
            >
              Open race
            </button>
          </form>

          {selectedResultRace ? (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 pt-3 text-xs">
              <p className="min-w-0 font-semibold text-slate-900">
                R{selectedResultRace.round_number} · {selectedResultRace.race_name}
              </p>
              <div className="flex flex-wrap gap-1.5">
                <span
                  className={`rounded-full border px-2 py-0.5 font-semibold ${
                    selectedResultRace.results_status === "published"
                      ? "ui-status-success border-emerald-200 bg-emerald-50 text-emerald-800"
                      : "ui-status-warning border-amber-200 bg-amber-50 text-amber-800"
                  }`}
                >
                  {selectedResultRace.results_status === "published" ? "Published" : "Draft"}
                </span>
                <span className="rounded-full ui-panel border border-slate-200 bg-white px-2 py-0.5 font-semibold text-slate-700">
                  {pickRows.length} picks
                </span>
                <span className="rounded-full ui-panel border border-slate-200 bg-white px-2 py-0.5 font-semibold text-slate-700">
                  {results.length} result rows
                </span>
              </div>
            </div>
          ) : null}
        </div>

        {activeIndy500Races.length > 0 ? (
        <details className="mt-5 rounded-md border border-cyan-200 bg-cyan-50">
          <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-slate-900">
            Indianapolis 500 qualifying order
          </summary>
          <form
            action={importIndy500QualifyingOrderAction}
            className="border-t border-cyan-200 p-4"
            data-testid="admin-indy-qualifying-import-form"
          >
            <input name="tab" type="hidden" value="results" />
            <input
              name="result_race_id"
              type="hidden"
              value={String(selectedResultRace?.id ?? "")}
            />
            <input
              name="race_id"
              type="hidden"
              value={String(activeIndy500Races[0]?.id ?? "")}
            />
            <p className="text-xs text-slate-600">
              For Indy 500 races only: paste the 33-car qualifying order to create 8 pick groups.
            </p>
            <div className="mt-3 grid gap-3 md:grid-cols-4">
              <div
                className="rounded-md border border-cyan-200 bg-white px-3 py-2 md:col-span-1"
                data-testid="admin-indy-qualifying-race"
              >
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Indy 500 race
                </p>
                <p className="mt-1 text-sm font-semibold text-slate-900">
                  {activeIndy500Races[0]
                    ? `R${activeIndy500Races[0].round_number} · ${activeIndy500Races[0].race_name}`
                    : "Select an Indy 500 race above"}
                </p>
              </div>
              <label className="block md:col-span-3">
                <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">
                  Qualifying order paste
                </span>
                <textarea
                  required
                  className="h-32 w-full rounded-md ui-control-border border border-slate-300 px-3 py-2 font-mono text-xs"
                  data-testid="admin-indy-qualifying-paste"
                  name="qualifying_order_paste"
                  placeholder={"1\t10\tAlex Palou\n2\t5\tPato O'Ward\n3\t2\tJosef Newgarden"}
                />
              </label>
            </div>
            <SubmitButton
              className="mt-3 rounded-md ui-action-primary bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700"
              data-testid="admin-indy-qualifying-submit"
              disabled={activeIndy500Races.length === 0}
              pendingLabel="Importing..."
            >
              Import qualifying order
            </SubmitButton>
          </form>
        </details>
        ) : null}

        <AdminResultsImportForm
          action={importIndycarResultsAction}
          selectedRace={
            selectedResultRace
              ? {
                  id: selectedResultRace.id,
                  pickFormat: normalizeRacePickFormat(selectedResultRace.pick_format),
                  raceName: selectedResultRace.race_name,
                  resultsStatus: selectedResultRace.results_status
                }
              : null
          }
          drivers={drivers.map((driver) => ({
            driverName: driver.driver_name,
            groupNumber: driver.group_number,
            id: driver.id,
            isActive: driver.is_active
          }))}
          participants={activeParticipants.map((winnerProfile) => ({
            id: winnerProfile.id,
            teamName: winnerProfile.team_name
          }))}
          picks={pickRows}
          raceDriverGroups={raceDriverGroups}
        />

        <details
          className="mt-5 rounded-lg ui-panel-muted border border-slate-200 bg-slate-50"
          data-testid="admin-scoring-audit"
        >
          <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-slate-900">
            <span className="inline-flex w-full flex-wrap items-center justify-between gap-3 align-middle">
              <span>Scoring Audit</span>
            <span className="rounded-md ui-control-border border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700">
              {scoringAudits.length} race{scoringAudits.length === 1 ? "" : "s"}
            </span>
            </span>
          </summary>

          <div className="border-t border-slate-200 p-4">

          {scoringAudits.length === 0 ? (
            <p className="mt-3 rounded-md border border-dashed border-slate-300 bg-white px-3 py-3 text-sm text-slate-600">
              No saved race results are available to audit yet.
            </p>
          ) : (
            <div className="mt-3 grid gap-3">
              {scoringAudits.map((audit, auditIndex) => (
                <details
                  className="rounded-md ui-panel border border-slate-200 bg-white"
                  data-testid={`admin-scoring-audit-race-${audit.raceId}`}
                  key={`scoring-audit-${audit.raceId}`}
                  open={auditIndex === 0}
                >
                  <summary className="cursor-pointer px-3 py-3 text-sm font-semibold text-slate-900">
                    <span className="flex flex-wrap items-center justify-between gap-2">
                      <span>
                        {audit.raceName}{" "}
                        <span className="font-normal text-slate-500">
                          ({normalizeRacePickFormat(audit.pickFormat) === "indy_500" ? "Indy 500" : "Standard"})
                        </span>
                        <span
                          className={`ml-2 rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase ${
                            audit.resultsStatus === "published"
                              ? "border-emerald-300 bg-emerald-50 text-emerald-800"
                              : "border-amber-300 bg-amber-50 text-amber-800"
                          }`}
                        >
                          {audit.resultsStatus}
                        </span>
                      </span>
                      <span className="text-xs font-medium text-slate-600">
                        {audit.resultsStatus === "published" ? "Winner" : "Projected leader"}: {audit.winnerTeamName ?? "-"}
                      </span>
                    </span>
                  </summary>

                  <div className="border-t border-slate-200 p-3">
                    <dl className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
                      <div className="rounded-md ui-panel-muted border border-slate-200 bg-slate-50 px-3 py-2">
                        <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                          Results
                        </dt>
                        <dd className="mt-0.5 font-semibold text-slate-900">
                          {audit.resultCount} rows
                        </dd>
                      </div>
                      <div className="rounded-md ui-panel-muted border border-slate-200 bg-slate-50 px-3 py-2">
                        <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                          Picks
                        </dt>
                        <dd className="mt-0.5 font-semibold text-slate-900">
                          {audit.submittedPickCount} submitted / {audit.noPickCount} fallback
                        </dd>
                      </div>
                      <div className="rounded-md ui-panel-muted border border-slate-200 bg-slate-50 px-3 py-2">
                        <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                          Range
                        </dt>
                        <dd className="mt-0.5 font-semibold text-slate-900">
                          {audit.lowestPossibleScore}-{audit.highestPossibleScore}
                        </dd>
                      </div>
                      <div className="rounded-md ui-panel-muted border border-slate-200 bg-slate-50 px-3 py-2">
                        <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                          Official Avg Speed
                        </dt>
                        <dd className="mt-0.5 font-semibold text-slate-900">
                          {formatOptionalDecimal(audit.officialWinningAverageSpeed)}
                        </dd>
                      </div>
                    </dl>

                    <div className="mt-3 max-h-80 overflow-auto rounded-md border border-slate-200">
                      <table className="min-w-full text-left text-xs">
                        <thead className="ui-table-head bg-slate-50 text-slate-700">
                          <tr>
                            <th className="px-2 py-1.5 font-semibold">Rank</th>
                            <th className="px-2 py-1.5 font-semibold">Team</th>
                            <th className="px-2 py-1.5 font-semibold">Score</th>
                            <th className="px-2 py-1.5 font-semibold">Source</th>
                            <th className="px-2 py-1.5 font-semibold">Avg Speed</th>
                            <th className="px-2 py-1.5 font-semibold">Delta</th>
                            <th className="px-2 py-1.5 font-semibold">Pick Detail</th>
                          </tr>
                        </thead>
                        <tbody>
                          {audit.rows.map((row) => {
                            const pickDetail = row.submittedPick
                              ? row.driverCells
                                  .map((cell) =>
                                    `G${cell.groupNumber}: ${cell.driverName ?? "No pick"} (${cell.points ?? "-"})`
                                  )
                                  .join(" | ")
                              : `Lowest possible score fallback (${audit.lowestPossibleScore})`;

                            return (
                              <tr key={`${audit.raceId}-${row.userId}`} className="border-t border-slate-200">
                                <td className="px-2 py-1.5 font-semibold">#{row.rank}</td>
                                <td className="px-2 py-1.5 font-medium text-slate-900">{row.teamName}</td>
                                <td className="px-2 py-1.5 font-semibold">{row.points}</td>
                                <td className="px-2 py-1.5">
                                  {row.submittedPick ? (
                                    <span className="font-semibold text-emerald-700">Submitted</span>
                                  ) : (
                                    <span className="font-semibold text-amber-700">Fallback</span>
                                  )}
                                </td>
                                <td className="px-2 py-1.5">{formatOptionalDecimal(row.averageSpeed)}</td>
                                <td className="px-2 py-1.5">{formatOptionalDecimal(row.tiebreakDelta)}</td>
                                <td className="max-w-[420px] px-2 py-1.5 text-slate-600">
                                  <span className="line-clamp-2">{pickDetail}</span>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </details>
              ))}
            </div>
          )}
          </div>
        </details>

        <details className="mt-5 rounded-md ui-panel border border-slate-200 bg-white">
          <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-slate-900">
            Manual result entry
          </summary>
          <form
            action={upsertResultAction}
            className="grid gap-3 border-t border-slate-200 p-4 md:grid-cols-4"
            data-testid="admin-results-manual-form"
          >
            <input name="tab" type="hidden" value="results" />
            <input
              name="result_race_id"
              type="hidden"
              value={String(selectedResultRace?.id ?? "")}
            />
            <input name="race_id" type="hidden" value={String(selectedResultRace?.id ?? "")} />
            <div className="rounded-md ui-panel-muted border border-slate-200 bg-slate-50 px-3 py-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Race</p>
              <p className="mt-1 text-sm font-semibold text-slate-900">
                {selectedResultRace
                  ? `R${selectedResultRace.round_number} · ${selectedResultRace.race_name}`
                  : "No race selected"}
              </p>
            </div>

            <label className="block">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">
                Driver
              </span>
              <select
                required
                className="w-full rounded-md ui-control-border border border-slate-300 px-3 py-2 text-sm"
                data-testid="admin-results-manual-driver-select"
                name="driver_id"
              >
                <option value="">Select driver</option>
                {drivers.map((driver) => (
                  <option key={driver.id} value={String(driver.id)}>
                    {driver.driver_name}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">
                Points
              </span>
              <input
                required
                className="w-full rounded-md ui-control-border border border-slate-300 px-3 py-2 text-sm"
                data-testid="admin-results-manual-points"
                min={0}
                name="points"
                step={1}
                type="number"
              />
            </label>

            <label className="flex items-start gap-2 rounded-md border ui-status-warning border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900 md:col-span-4">
              <input className="mt-0.5" name="confirm_results_correction" type="checkbox" />
              Check only when intentionally editing a published race. The race will return to
              draft until the complete corrected field is republished.
            </label>

            <div className="flex items-end">
              <SubmitButton
                className="w-full rounded-md ui-action-primary bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700"
                data-testid="admin-results-manual-submit"
                pendingLabel="Saving draft..."
              >
                Save draft result
              </SubmitButton>
            </div>
          </form>

          <form
            action={publishSavedRaceResultsAction}
            className="grid gap-3 border-t border-slate-200 bg-emerald-50/50 p-4 md:grid-cols-3"
          >
            <input name="tab" type="hidden" value="results" />
            <input
              name="result_race_id"
              type="hidden"
              value={String(selectedResultRace?.id ?? "")}
            />
            <input name="race_id" type="hidden" value={String(selectedResultRace?.id ?? "")} />
            <div className="rounded-md ui-panel border border-slate-200 bg-white px-3 py-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Complete draft race
              </p>
              <p className="mt-1 text-sm font-semibold text-slate-900">
                {selectedResultRace
                  ? `R${selectedResultRace.round_number} · ${selectedResultRace.race_name}${
                      selectedResultRace.results_status === "published"
                        ? " (published correction)"
                        : " (draft)"
                    }`
                  : "No race selected"}
              </p>
            </div>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">
                Official winning average speed
              </span>
              <input
                required
                className="w-full rounded-md ui-control-border border border-slate-300 px-3 py-2 text-sm"
                max={300}
                min={0.001}
                name="official_winning_average_speed"
                step={0.001}
                type="number"
              />
            </label>
            <div className="flex items-end">
              <SubmitButton
                className="w-full rounded-md ui-action-primary bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700"
                pendingLabel="Publishing..."
              >
                Publish complete draft
              </SubmitButton>
            </div>
            <label className="flex items-start gap-2 rounded-md border ui-status-warning border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900 md:col-span-3">
              <input className="mt-0.5" name="confirm_results_correction" type="checkbox" />
              Check only when intentionally republishing an already published race.
            </label>
            <p className="text-xs text-slate-600 md:col-span-3">
              Manual publication requires one saved row per snapshotted driver; enter 0 for
              nonstarters. Bulk import adds those zero rows automatically.
            </p>
          </form>
        </details>

        <Disclosure
          className="mt-5 border-cyan-200 bg-cyan-50"
          description="Finalize the permanent Hall of Fame snapshot after every race is published."
          meta={
            <StatusChip tone={canFinalizeSeason ? "success" : "neutral"}>
              {canFinalizeSeason ? "Ready" : "Not ready"}
            </StatusChip>
          }
          summary="Season closeout"
        >
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold uppercase tracking-wide text-cyan-800">
                Season Archive
              </p>
              <h3 className="mt-1 text-base font-semibold text-slate-900">
                {activeSeason ? `${activeSeason.season_year} Hall of Fame` : "Hall of Fame"}
              </h3>
              <p className="mt-1 text-sm text-slate-700">
                Save the final standings before retiring this season&apos;s drivers. The archived
                leaderboard does not depend on future driver or profile changes.
              </p>
              <p className="mt-2 text-xs font-medium text-slate-600">
                {savedHallOfFameSeason
                  ? `Saved ${formatDateTime(savedHallOfFameSeason.finalized_at)} · ${savedHallOfFameSeason.participant_count} teams · ${savedHallOfFameSeason.race_count} races`
                  : canFinalizeSeason
                    ? `${currentSeasonRaces.length} races published. Ready to finalize.`
                    : unpublishedSeasonRaces.length > 0
                      ? `${unpublishedSeasonRaces.length} race result set(s) still need publication.`
                      : finalSeasonRace
                        ? `Available after ${finalSeasonRace.race_name}.`
                        : "Add this season's race schedule before finalizing."}
              </p>
              {!hallOfFameMigrationReady ? (
                <p className="mt-2 text-xs font-semibold text-amber-800">
                  Hall of Fame database setup is incomplete. Review Race Week before using this control.
                </p>
              ) : null}
            </div>
            <form action={finalizeHallOfFameSeasonAction}>
              <input name="tab" type="hidden" value="results" />
              <input name="season_id" type="hidden" value={String(activeSeason?.id ?? "")} />
              <ConfirmSubmitButton
                className="rounded-md ui-action-primary bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                confirmMessage={
                  savedHallOfFameSeason
                    ? `Replace the saved ${activeSeason?.season_year} Hall of Fame standings with the current final calculation?`
                    : `Finalize and save the ${activeSeason?.season_year} standings to the Hall of Fame?`
                }
                disabled={!canFinalizeSeason || !hallOfFameMigrationReady}
                type="submit"
              >
                {savedHallOfFameSeason ? "Refresh Final Standings" : "Finalize Season"}
              </ConfirmSubmitButton>
            </form>
          </div>
        </Disclosure>

        <details className="mt-5 rounded-md ui-panel border border-slate-200 bg-white">
          <summary className="cursor-pointer px-3 py-3 text-sm font-semibold text-slate-900">
            Saved result rows ({sortedResults.length})
          </summary>
          <div className="max-h-96 overflow-auto border-t border-slate-200">
            <table className="min-w-full text-left text-sm">
              <thead className="ui-table-head bg-slate-50 text-slate-700">
                <tr>
                  <th className="px-3 py-2 font-semibold">Race</th>
                  <th className="px-3 py-2 font-semibold">Driver</th>
                  <th className="px-3 py-2 font-semibold">Points</th>
                </tr>
              </thead>
              <tbody>
                {sortedResults.length === 0 ? (
                  <tr>
                    <td className="px-3 py-3 text-slate-600" colSpan={3}>
                      No results entered yet.
                    </td>
                  </tr>
                ) : (
                  sortedResults.map((result) => {
                    const race = raceById.get(result.race_id);
                    return (
                      <tr key={result.id} className="border-t border-slate-200">
                        <td className="px-3 py-2">
                          {race ? `${race.race_name} (${formatDateTime(race.race_date)})` : `Race #${result.race_id}`}
                        </td>
                        <td className="px-3 py-2">
                          {driverNameById.get(result.driver_id) ?? `Driver #${result.driver_id}`}
                        </td>
                        <td className="px-3 py-2">{result.points}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </details>
        </section>
  );
}
