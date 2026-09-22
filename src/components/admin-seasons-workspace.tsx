import Link from "next/link";
import { completeLeagueSeasonAction } from "@/app/admin/season-closeout-actions";
import { AdminRulesDocumentUpload } from "@/components/admin-rules-document-upload";
import { isSafeRulesDocumentUrl } from "@/lib/season-rules";
import type { LeagueSeasonRow, RaceRow } from "@/app/admin/admin-types";
import { activateLeagueSeasonAction, createLeagueSeasonAction, setLeagueSeasonInviteCodeAction, setLeagueSeasonRulesDocumentAction } from "@/app/admin/season-actions";
import { finalizeHallOfFameSeasonAction } from "@/app/admin/hall-of-fame-actions";
import { formatDateTime } from "@/app/admin/admin-data";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { SubmitButton } from "@/components/submit-button";
import { AdminWorkspaceHeader, Disclosure, StatusChip, EmptyState, actionControlClassName } from "@/components/ui-primitives";
import { AdminHistoricalHallOfFameImport } from "@/components/admin-historical-hall-of-fame-import";
import { AdminInviteLinks } from "@/components/admin-invite-links";
export type AdminArchiveSummary = {
  id: number; season_year: number; champion_team_name: string; champion_total_points: number;
  finalized_at: string; participant_count: number; race_count: number;
};
type Props = {
  activeSeason: LeagueSeasonRow | null; seasons: LeagueSeasonRow[]; archives: AdminArchiveSummary[];
  currentSeasonRaces: RaceRow[]; canFinalizeSeason: boolean; canRefreshArchive: boolean; finalSeasonRace: RaceRow | undefined;
  unpublishedSeasonRaces: RaceRow[]; siteOrigin: string;
};
export function AdminSeasonsWorkspace({ activeSeason, seasons, archives, currentSeasonRaces, canFinalizeSeason, canRefreshArchive, finalSeasonRace, unpublishedSeasonRaces, siteOrigin }: Props) {
  const archivedYears = archives.map(archive => archive.season_year);
  const savedHallOfFameSeason = archives.find(archive => archive.season_year === activeSeason?.season_year) ?? null;
  return <section className="mt-6 min-w-0">
    <AdminWorkspaceHeader title="Seasons & League" description="Prepare upcoming seasons, preserve final standings, and choose when the league starts or finishes a season." />
    <div className="mt-4 rounded-lg border border-slate-200 bg-white p-4 sm:p-6">
      <h3 className="font-semibold">{activeSeason?.display_name ?? "No active season"}</h3>
      <p className="mt-1 text-sm text-slate-600">{!activeSeason ? "The league is between seasons. Hall of Fame remains available, and registration and picks will open when you activate the next season." : savedHallOfFameSeason ? "Final standings are saved. Complete this season below when you are ready to close registration and enter the off-season." : "Save the final standings, then complete this season before activating its successor."}</p>
      {activeSeason ? <ul className="mt-3 grid gap-2 text-sm sm:grid-cols-3">
        <li>Invite code: {activeSeason.registration_code_configured_at ? "Configured" : "Required"}</li>
        <li>Opening roster: {activeSeason.roster_configured_at ? "Configured" : "Required"}</li>
        <li>Final archive: {savedHallOfFameSeason ? "Saved" : "Pending"}</li>
      </ul> : null}
      <p className="mt-3 text-xs text-slate-500">Activation requires an invite code, a configured roster, and no other active season. Completion and activation create recovery backups. Rules and the calendar can be added afterward.</p>
    </div>
        <Disclosure open
          className="mt-5 bg-slate-50"
          description="Create seasons, configure the invite code and opening roster, then activate registration. Rules and races can be added afterward."
          summary={`Season management · ${activeSeason ? `${activeSeason.season_year} active` : "No active season"}`}
        >
            <div className="grid gap-2">
              {seasons.map((season) => (
                <div
                  className="flex flex-wrap items-center justify-between gap-3 rounded-md ui-panel border border-slate-200 bg-white px-3 py-2"
                  key={season.id}
                >
                  <div>
                    <p className="text-sm font-semibold text-slate-900">{season.display_name}</p>
                    <p className="text-xs text-slate-500">
                      {season.status === "completed" ? "Completed · Final standings retained" : season.status} {season.status !== "completed" ? <>·{" "}
                      {season.registration_code_configured_at
                        ? `Invite code set ${formatDateTime(season.registration_code_configured_at)}`
                        : "Invite code required"}{" "}
                      · {season.roster_configured_at ? "Roster configured" : "Roster required"}</> : null}
                    </p>
                  </div>
                  <div className="flex min-w-0 flex-wrap items-end gap-3">
                    {season.status !== "completed" ? (
                      <form
                        action={setLeagueSeasonRulesDocumentAction}
                        className="flex w-full min-w-0 flex-wrap items-end gap-2"
                      >
                        <input name="season_id" type="hidden" value={season.id} />
                        <input name="expected_rules_document_url" type="hidden" value={season.rules_document_url ?? ""} />
                        <label className="block">
                          <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                            Rules PDF path / HTTPS URL (optional)
                          </span>
                          <input
                            className="w-full sm:w-64 rounded-md ui-control-border border border-slate-300 px-2.5 py-2 text-xs"
                            defaultValue={season.rules_document_url ?? ""}
                            maxLength={2048}
                            name="rules_document_url"
                            placeholder="/docs/2027-rules.pdf"
                            type="text"
                          />
                        </label>
                        <SubmitButton
                          className="rounded-md ui-control-border border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-100"
                          pendingLabel="Saving..."
                        >
                          Save rules
                        </SubmitButton>
                      </form>
                    ) : null}
                    {season.rules_document_url && isSafeRulesDocumentUrl(season.rules_document_url) ? <a className="break-all text-sm font-semibold text-cyan-800 underline" href={season.rules_document_url} target="_blank" rel="noreferrer">Open {season.season_year} rules PDF</a> : null}
                    {season.status !== "completed" ? <AdminRulesDocumentUpload seasonId={season.id} seasonYear={season.season_year} currentUrl={season.rules_document_url} /> : null}
                    {season.status !== "completed" ? (
                      <form
                        action={setLeagueSeasonInviteCodeAction}
                        className="flex flex-wrap items-end gap-2"
                      >
                        <input name="season_id" type="hidden" value={season.id} />
                        <label className="block">
                          <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                            {season.registration_code_configured_at
                              ? "Replace invite code"
                              : "Set invite code"}
                          </span>
                          <input
                            required
                            autoCapitalize="none"
                            autoComplete="off"
                            className="w-full sm:w-44 rounded-md ui-control-border border border-slate-300 px-2.5 py-2 text-xs"
                            maxLength={64}
                            minLength={8}
                            name="invite_code"
                            type="text"
                          />
                        </label>
                        <label className="block">
                          <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                            Confirm code
                          </span>
                          <input
                            required
                            autoCapitalize="none"
                            autoComplete="off"
                            className="w-full sm:w-44 rounded-md ui-control-border border border-slate-300 px-2.5 py-2 text-xs"
                            maxLength={64}
                            minLength={8}
                            name="invite_code_confirmation"
                            type="text"
                          />
                        </label>
                        <SubmitButton
                          className="rounded-md ui-control-border border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-100"
                          pendingLabel="Saving..."
                        >
                          Save code
                        </SubmitButton>
                      </form>
                    ) : null}
                    {season.status === "upcoming" ? (
                      <form action={activateLeagueSeasonAction}>
                        <input name="season_id" type="hidden" value={season.id} />
                        <ConfirmSubmitButton
                          className="rounded-md ui-action-primary bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-700 disabled:bg-slate-400"
                          confirmMessage={`Activate ${season.season_year}? No other season can be active. A recovery backup will be created. Driver points will reset to zero while final ranking order is retained for opening groups.`}
                          disabled={
                            !season.registration_code_configured_at ||
                            !season.roster_configured_at ||
                            Boolean(activeSeason)
                          }
                          pendingLabel="Activating..."
                          type="submit"
                        >
                          Activate season
                        </ConfirmSubmitButton>
                      </form>
                    ) : null}
                    {!season.roster_configured_at && season.status !== "completed" ? (
                      <Link
                        className="rounded-md ui-control-border border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-100"
                        href="/admin?tab=drivers"
                      >
                        Configure roster
                      </Link>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
            <form action={createLeagueSeasonAction} className="mt-3 flex flex-wrap items-end gap-2">
              <label className="block">
                <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">
                  New season year
                </span>
                <input
                  className="w-36 rounded-md ui-control-border border border-slate-300 px-3 py-2 text-sm"
                  max={2100}
                  min={2000}
                  name="season_year"
                  placeholder="2027"
                  required
                  type="number"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">
                  Private invite code
                </span>
                <input
                  required
                  autoCapitalize="none"
                  autoComplete="off"
                  className="w-48 rounded-md ui-control-border border border-slate-300 px-3 py-2 text-sm"
                  maxLength={64}
                  minLength={8}
                  name="invite_code"
                  placeholder="8-64 characters"
                  type="text"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">
                  Confirm invite code
                </span>
                <input
                  required
                  autoCapitalize="none"
                  autoComplete="off"
                  className="w-48 rounded-md ui-control-border border border-slate-300 px-3 py-2 text-sm"
                  maxLength={64}
                  minLength={8}
                  name="invite_code_confirmation"
                  placeholder="Enter code again"
                  type="text"
                />
              </label>
              <SubmitButton
                className="rounded-md ui-control-border border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-100"
                pendingLabel="Creating..."
              >
                Create season
              </SubmitButton>
            </form>
            <p className="mt-2 text-xs text-slate-500">
              The code is stored securely and never displayed again. Existing registered
              participants remain registered if the code changes.
            </p>
        </Disclosure>

        <Disclosure open
          className="mt-5 border-cyan-200 bg-cyan-50"
          description="Save the final standings, then complete the season. Completing it leaves the league between seasons until you activate another."
          meta={
            <StatusChip tone={canFinalizeSeason ? "success" : "neutral"}>
              {!activeSeason ? "Between seasons" : savedHallOfFameSeason ? "Archive saved" : canFinalizeSeason ? "Ready to archive" : "Results pending"}
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
                        : activeSeason ? "Add this season's race schedule before saving final standings." : "There is no active season to close. Previous final standings remain in Hall of Fame."}
              </p>
            </div>
            <form action={finalizeHallOfFameSeasonAction}>
              <input name="tab" type="hidden" value="seasons" />
              <input name="season_id" type="hidden" value={String(activeSeason?.id ?? "")} />
              <ConfirmSubmitButton
                className="rounded-md ui-action-primary bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                confirmMessage={
                  savedHallOfFameSeason
                    ? `Replace the saved ${activeSeason?.season_year} Hall of Fame standings with the current final calculation?`
                    : `Finalize and save the ${activeSeason?.season_year} standings to the Hall of Fame?`
                }
                disabled={!activeSeason || !canFinalizeSeason || !canRefreshArchive}
                type="submit"
              >
                {savedHallOfFameSeason ? canRefreshArchive ? "Refresh Final Standings" : "Historical archive saved" : "Save Final Standings"}
              </ConfirmSubmitButton>
            </form>
          </div>
          {activeSeason && savedHallOfFameSeason ? <form action={completeLeagueSeasonAction} className="mt-5 border-t border-cyan-200 pt-4">
            <input name="season_id" type="hidden" value={activeSeason.id} />
            <input name="archive_id" type="hidden" value={savedHallOfFameSeason.id} />
            <input name="archive_finalized_at" type="hidden" value={savedHallOfFameSeason.finalized_at} />
            <input name="confirm_complete" type="hidden" value="yes" />
            <p className="mb-3 text-sm text-slate-700">Complete {activeSeason.season_year} when these are the official final standings. Accounts, race history and Hall of Fame are retained. Registration and picks close until the next season is activated.</p>
            <ConfirmSubmitButton className={actionControlClassName("primary")}
              pendingLabel="Completing season..." disabled={currentSeasonRaces.length > 0 && (!canFinalizeSeason || !canRefreshArchive)}
              confirmMessage={`Complete the ${activeSeason.season_year} season and enter the off-season? A recovery backup will be saved. Hall of Fame remains available, and no new season will be activated.`}>Complete {activeSeason.season_year} season</ConfirmSubmitButton>
          </form> : null}
        </Disclosure>

    <AdminInviteLinks siteOrigin={siteOrigin} />
    <section className="mt-5 rounded-lg border border-slate-200 bg-white p-4 sm:p-6">
      <h3 className="font-semibold text-slate-900">Season archives</h3>
      {archives.length ? <ul className="mt-3 divide-y divide-slate-200">{archives.map(archive => <li className="flex min-w-0 flex-wrap items-center justify-between gap-3 py-3" key={archive.id}>
        <div className="min-w-0"><p className="break-words font-semibold">{archive.season_year} · {archive.champion_team_name}</p><p className="text-sm text-slate-600">{archive.participant_count} teams · {archive.race_count} races · {archive.champion_total_points.toLocaleString("en-US")} champion points</p></div>
        <Link className="text-sm font-semibold text-cyan-800 underline" href={`/leaderboard?tab=hall&year=${archive.season_year}`}>View final standings</Link>
      </li>)}</ul> : <EmptyState title="No archived seasons" description="Finalize an app season or import a historical leaderboard below." />}
    </section>
    <div className="mt-5"><AdminHistoricalHallOfFameImport archivedYears={archivedYears} /></div>
  </section>;
}
