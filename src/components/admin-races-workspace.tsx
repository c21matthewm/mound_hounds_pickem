import Link from "next/link";
import {
  createRaceAction,
  deleteRaceAction,
  setRaceArchivedAction,
  setRacePickWindowAction,
  setRaceWinnerAction,
  updateRaceAction
} from "@/app/admin/race-actions";
import {
  activateLeagueSeasonAction,
  createLeagueSeasonAction,
  setLeagueSeasonInviteCodeAction,
  setLeagueSeasonRulesDocumentAction
} from "@/app/admin/season-actions";
import type {
  LeagueSeasonRow,
  RaceRow,
  WinnerProfileRow
} from "@/app/admin/admin-types";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { SubmitButton } from "@/components/submit-button";
import {
  AdminWorkspaceHeader,
  Disclosure,
  EmptyState,
  FormField,
  StatusChip,
  actionControlClassName,
  fieldControlClassName
} from "@/components/ui-primitives";
import { normalizeRacePickFormat } from "@/lib/race-format";
import { LEAGUE_TIME_ZONE } from "@/lib/timezone";
import {
  formatDateTime,
  formatDateTimeLocalInput
} from "@/app/admin/admin-data";

type AdminRacesWorkspaceProps = {
  activeParticipants: WinnerProfileRow[];
  activeSeason: LeagueSeasonRow | null;
  currentSeasonRaces: RaceRow[];
  pickWindowPartnerByRaceId: Map<number, RaceRow>;
  races: RaceRow[];
  racesByPickWindow: Map<string, RaceRow[]>;
  seasonById: Map<number, LeagueSeasonRow>;
  seasons: LeagueSeasonRow[];
  selectedRaceSeason: LeagueSeasonRow | null;
  teamNameByProfileId: Map<string, string>;
};

export function AdminRacesWorkspace({
  activeParticipants,
  activeSeason,
  currentSeasonRaces,
  pickWindowPartnerByRaceId,
  races,
  racesByPickWindow,
  seasonById,
  seasons,
  selectedRaceSeason,
  teamNameByProfileId
}: AdminRacesWorkspaceProps) {
  return (
        <section className="mt-6 rounded-lg ui-panel border border-slate-200 bg-white p-4 sm:p-6">
        <AdminWorkspaceHeader
          description={`Create and manage race weeks. Times use ${LEAGUE_TIME_ZONE}.`}
          meta={
            <form action="/admin" className="flex items-end gap-2" method="get">
              <input name="tab" type="hidden" value="races" />
              <label className="block">
                <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  Viewing season
                </span>
                <select
                  className="rounded-md ui-control-border border border-slate-300 bg-white px-3 py-2 text-sm"
                  defaultValue={selectedRaceSeason ? String(selectedRaceSeason.id) : ""}
                  name="race_season_id"
                >
                  {seasons.map((season) => (
                    <option key={season.id} value={season.id}>
                      {season.season_year} {season.status === "active" ? "(active)" : ""}
                    </option>
                  ))}
                </select>
              </label>
              <button
                className="rounded-md ui-control-border border border-slate-300 px-3 py-2 text-sm font-semibold"
                type="submit"
              >
                View
              </button>
            </form>
          }
          title="Races"
        />

        <Disclosure
          className="mt-5 bg-slate-50"
          description="Create seasons, configure invite codes and rules, then activate a prepared season."
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
                    <p className="text-xs capitalize text-slate-500">
                      {season.status} ·{" "}
                      {season.registration_code_configured_at
                        ? "Invite code configured"
                        : "Invite code required"}{" "}
                      · {season.roster_configured_at ? "Roster configured" : "Roster required"}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-end justify-end gap-2">
                    {season.status !== "completed" ? (
                      <form
                        action={setLeagueSeasonRulesDocumentAction}
                        className="flex flex-wrap items-end gap-2"
                      >
                        <input name="season_id" type="hidden" value={season.id} />
                        <label className="block">
                          <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                            Rules PDF path / URL
                          </span>
                          <input
                            className="w-52 rounded-md ui-control-border border border-slate-300 px-2.5 py-2 text-xs"
                            defaultValue={season.rules_document_url ?? ""}
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
                            className="w-44 rounded-md ui-control-border border border-slate-300 px-2.5 py-2 text-xs"
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
                            className="w-44 rounded-md ui-control-border border border-slate-300 px-2.5 py-2 text-xs"
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
                          confirmMessage={`Activate ${season.season_year}? The current season must already be saved to the Hall of Fame. Driver points will reset to zero while final ranking order is retained for opening groups.`}
                          disabled={
                            !season.registration_code_configured_at ||
                            !season.roster_configured_at
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

        <form
          action={createRaceAction}
          className="mt-5 grid gap-3 md:grid-cols-6"
          data-testid="admin-race-create-form"
        >
          <input name="tab" type="hidden" value="races" />
          <label className="block">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">
              Season
            </span>
            <select
              required
              className="w-full rounded-md ui-control-border border border-slate-300 px-3 py-2 text-sm"
              defaultValue={activeSeason ? String(activeSeason.id) : ""}
              name="season_id"
            >
              <option value="">Select</option>
              {seasons
                .filter((season) => season.status !== "completed")
                .map((season) => (
                  <option key={season.id} value={season.id}>
                    {season.season_year} {season.status === "active" ? "(active)" : "(upcoming)"}
                  </option>
                ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">
              Round
            </span>
            <input
              required
              className="w-full rounded-md ui-control-border border border-slate-300 px-3 py-2 text-sm"
              defaultValue={
                selectedRaceSeason?.id === activeSeason?.id && currentSeasonRaces.length > 0
                  ? Math.max(...currentSeasonRaces.map((race) => race.round_number)) + 1
                  : selectedRaceSeason?.id === activeSeason?.id
                    ? 1
                    : undefined
              }
              max={99}
              min={1}
              name="round_number"
              type="number"
            />
          </label>
          <label className="block md:col-span-2">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">
              Race name
            </span>
            <input
              required
              className="w-full rounded-md ui-control-border border border-slate-300 px-3 py-2 text-sm"
              data-testid="admin-race-create-name"
              maxLength={200}
              name="race_name"
              type="text"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">
              Qualifying start
            </span>
            <input
              required
              className="w-full rounded-md ui-control-border border border-slate-300 px-3 py-2 text-sm"
              data-testid="admin-race-create-qualifying"
              name="qualifying_start_at"
              type="datetime-local"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">
              Race start
            </span>
            <input
              required
              className="w-full rounded-md ui-control-border border border-slate-300 px-3 py-2 text-sm"
              data-testid="admin-race-create-start"
              name="race_date"
              type="datetime-local"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">
              Payout
            </span>
            <input
              required
              className="w-full rounded-md ui-control-border border border-slate-300 px-3 py-2 text-sm"
              data-testid="admin-race-create-payout"
              min={0}
              name="payout"
              step="0.01"
              type="number"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">
              Pick rules
            </span>
            <select
              className="w-full rounded-md ui-control-border border border-slate-300 px-3 py-2 text-sm"
              data-testid="admin-race-create-pick-format"
              defaultValue="standard"
              name="pick_format"
            >
              <option value="standard">Standard (6 picks, locks at qualifying)</option>
              <option value="indy_500">Indianapolis 500 (8 picks, locks at race start)</option>
            </select>
          </label>

          <Disclosure
            className="md:col-span-6"
            description="Doubleheader deadlines and optional race-title media."
            summary="Advanced scheduling and media"
          >
            <div className="grid gap-3 md:grid-cols-2">
              <FormField
                description="For a doubleheader, choose the consecutive race that already exists."
                label="Shared pick deadline"
              >
                <select
                  className={fieldControlClassName()}
                  defaultValue=""
                  name="pick_window_partner_id"
                >
                  <option value="">Standalone race</option>
                  {races
                    .filter(
                      (race) =>
                        !race.is_archived &&
                        !race.field_frozen_at &&
                        normalizeRacePickFormat(race.pick_format) === "standard" &&
                        (racesByPickWindow.get(race.pick_window_key)?.length ?? 0) === 1
                    )
                    .map((race) => (
                      <option key={race.id} value={race.id}>
                        {seasonById.get(race.season_id)?.season_year ?? "-"} · R{race.round_number} ·{" "}
                        {race.race_name}
                      </option>
                    ))}
                </select>
              </FormField>

              <FormField label="Title image upload">
                <input
                  accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
                  className={fieldControlClassName("text-xs")}
                  data-testid="admin-race-create-image-file"
                  name="title_image_file"
                  type="file"
                />
              </FormField>

              <FormField className="md:col-span-2" label="Title image URL fallback">
                <input
                  className={fieldControlClassName()}
                  data-testid="admin-race-create-image-url"
                  name="title_image_url"
                  type="url"
                />
              </FormField>
            </div>
          </Disclosure>

          <div className="md:col-span-6">
            <SubmitButton
              className={actionControlClassName("primary")}
              data-testid="admin-race-create-submit"
              pendingLabel="Adding..."
            >
              Add race
            </SubmitButton>
          </div>
        </form>

        <details className="mt-6 rounded-md ui-panel-muted border border-slate-200 bg-slate-50">
          <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-slate-900">
            Advanced winner tools
          </summary>
          <form
            action={setRaceWinnerAction}
            className="grid gap-3 border-t border-slate-200 p-4 md:grid-cols-3"
            data-testid="admin-race-winner-form"
          >
            <input name="tab" type="hidden" value="races" />
            <label className="block">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">
                Race
              </span>
              <select
                required
                className="w-full rounded-md ui-control-border border border-slate-300 px-3 py-2 text-sm"
                data-testid="admin-race-winner-race-select"
                name="race_id"
              >
                <option value="">{currentSeasonRaces.length > 0 ? "Select race" : "No current-season races"}</option>
                {currentSeasonRaces.map((race) => (
                  <option key={race.id} value={String(race.id)}>
                    R{race.round_number} · {race.race_name}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">
                Fantasy winner
              </span>
              <select
                className="w-full rounded-md ui-control-border border border-slate-300 px-3 py-2 text-sm"
                data-testid="admin-race-winner-profile-select"
                name="winner_profile_id"
              >
                <option value="">Auto-calculate now (clear manual override)</option>
                {activeParticipants.map((winnerProfile) => (
                  <option key={winnerProfile.id} value={winnerProfile.id}>
                    {winnerProfile.team_name}
                  </option>
                ))}
              </select>
            </label>

            <div className="flex items-end">
              <SubmitButton
                className="w-full rounded-md ui-action-primary bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700"
                data-testid="admin-race-winner-submit"
                pendingLabel="Saving..."
              >
                Save fantasy winner
              </SubmitButton>
            </div>
            <p className="text-xs text-slate-500 md:col-span-3">
              Auto winner uses highest weekly points, then closest official average speed tiebreak, then team name.
            </p>
          </form>
        </details>

        <div className="mt-5 grid gap-3">
          {races.length === 0 ? (
            <EmptyState
              description="Add the first race for the selected season using the form above."
              title="No races scheduled"
            />
          ) : (
            races.map((race) => (
              <details key={`race-edit-${race.id}`} className="rounded-md ui-panel border border-slate-200 bg-white">
                <summary className="cursor-pointer px-3 py-3">
                  <div className="inline-flex w-full flex-wrap items-center justify-between gap-3 align-middle">
                    <div className="flex min-w-0 items-center gap-3">
                      {race.title_image_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          alt={`${race.race_name} title`}
                          className="h-12 w-20 rounded border border-slate-200 object-cover"
                          src={race.title_image_url}
                        />
                      ) : (
                        <div className="flex h-12 w-20 items-center justify-center rounded border border-dashed border-slate-300 text-[10px] font-semibold text-slate-500">
                          NO IMAGE
                        </div>
                      )}
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-slate-900">{race.race_name}</p>
                        <p className="text-xs text-slate-500">
                          R{race.round_number} · {seasonById.get(race.season_id)?.season_year ?? "-"} ·{" "}
                          {formatDateTime(race.race_date)} · ${Number(race.payout).toFixed(2)}
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {normalizeRacePickFormat(race.pick_format) === "indy_500" ? (
                        <StatusChip tone="info">
                          Indy 500
                        </StatusChip>
                      ) : null}
                      {pickWindowPartnerByRaceId.has(race.id) ? (
                        <StatusChip
                          tone="info"
                          title={`Shares a pick deadline with ${pickWindowPartnerByRaceId.get(race.id)?.race_name ?? "another race"}`}
                        >
                          Shared deadline
                        </StatusChip>
                      ) : null}
                      {race.is_archived ? (
                        <StatusChip tone="warning">
                          Archived
                        </StatusChip>
                      ) : (
                        <StatusChip tone={race.results_status === "published" ? "success" : "warning"}>
                          Results {race.results_status === "published" ? "published" : "draft"}
                        </StatusChip>
                      )}
                    </div>
                  </div>
                </summary>

                <div className="border-t border-slate-200 p-3">
                  <dl className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-5">
                    <div className="rounded-md ui-panel-muted border border-slate-200 bg-slate-50 px-3 py-2">
                      <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                        Qualifying
                      </dt>
                      <dd className="mt-0.5 font-medium text-slate-900">
                        {formatDateTime(race.qualifying_start_at)}
                      </dd>
                    </div>
                    <div className="rounded-md ui-panel-muted border border-slate-200 bg-slate-50 px-3 py-2">
                      <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                        Fantasy Winner
                      </dt>
                      <dd className="mt-0.5 font-medium text-slate-900">
                        {race.winner_profile_id
                          ? teamNameByProfileId.get(race.winner_profile_id) ?? `Team ${race.winner_profile_id}`
                          : "Not set"}
                      </dd>
                    </div>
                    <div className="rounded-md ui-panel-muted border border-slate-200 bg-slate-50 px-3 py-2">
                      <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                        Winner Status
                      </dt>
                      <dd className="mt-0.5 font-medium text-slate-900">
                        {race.winner_auto_eligible_at
                          ? `Auto pending ${formatDateTime(race.winner_auto_eligible_at)}`
                          : race.winner_set_at
                            ? `${race.winner_source === "manual" ? "Manual" : "Auto"} set`
                            : "Awaiting results"}
                      </dd>
                    </div>
                    <div className="rounded-md ui-panel-muted border border-slate-200 bg-slate-50 px-3 py-2">
                      <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                        Pick field
                      </dt>
                      <dd className="mt-0.5 font-medium text-slate-900">
                        {race.field_frozen_at ? "Frozen" : "Editable"}
                      </dd>
                    </div>
                    <div className="rounded-md ui-panel-muted border border-slate-200 bg-slate-50 px-3 py-2">
                      <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                        Archive
                      </dt>
                      <dd className="mt-0.5 font-medium text-slate-900">
                        {race.archived_at ? formatDateTime(race.archived_at) : "-"}
                      </dd>
                    </div>
                  </dl>

                <form
                  action={updateRaceAction}
                  className="mt-3 grid gap-2 md:grid-cols-12"
                  data-testid={`admin-race-edit-form-${race.id}`}
                >
                  <input name="race_id" type="hidden" value={String(race.id)} />
                  <input name="tab" type="hidden" value="races" />

                  <FormField className="md:col-span-1" label="Season">
                    <select
                      required
                      className={fieldControlClassName("px-2 py-2")}
                      defaultValue={String(race.season_id)}
                      disabled={Boolean(
                        race.field_frozen_at || pickWindowPartnerByRaceId.has(race.id)
                      )}
                      name="season_id"
                    >
                      {seasons.map((season) => (
                        <option key={season.id} value={season.id}>
                          {season.season_year}
                        </option>
                      ))}
                    </select>
                  </FormField>

                  <FormField className="md:col-span-1" label="Round">
                    <input
                      required
                      className={fieldControlClassName("px-2 py-2")}
                      defaultValue={race.round_number}
                      disabled={Boolean(
                        race.field_frozen_at || pickWindowPartnerByRaceId.has(race.id)
                      )}
                      max={99}
                      min={1}
                      name="round_number"
                      type="number"
                    />
                  </FormField>

                  <FormField className="md:col-span-3" label="Race name">
                    <input
                      required
                      className={fieldControlClassName("px-2 py-2")}
                      defaultValue={race.race_name}
                      maxLength={200}
                      name="race_name"
                      type="text"
                    />
                  </FormField>

                  <FormField className="md:col-span-2" label="Qualifying start">
                    <input
                      required
                      className={fieldControlClassName("px-2 py-2")}
                      defaultValue={formatDateTimeLocalInput(race.qualifying_start_at)}
                      disabled={pickWindowPartnerByRaceId.has(race.id)}
                      name="qualifying_start_at"
                      type="datetime-local"
                    />
                  </FormField>

                  <FormField className="md:col-span-2" label="Race start">
                    <input
                      required
                      className={fieldControlClassName("px-2 py-2")}
                      defaultValue={formatDateTimeLocalInput(race.race_date)}
                      name="race_date"
                      type="datetime-local"
                    />
                  </FormField>

                  <FormField className="md:col-span-1" label="Payout">
                    <input
                      required
                      className={fieldControlClassName("px-2 py-2")}
                      defaultValue={String(race.payout)}
                      min={0}
                      name="payout"
                      step="0.01"
                      type="number"
                    />
                  </FormField>

                  <FormField className="md:col-span-2" label="Pick rules">
                    <select
                      className={fieldControlClassName("px-2 py-2")}
                      defaultValue={normalizeRacePickFormat(race.pick_format)}
                      disabled={Boolean(
                        race.field_frozen_at || pickWindowPartnerByRaceId.has(race.id)
                      )}
                      name="pick_format"
                    >
                      <option value="standard">Standard rules</option>
                      <option value="indy_500">Indianapolis 500 rules</option>
                    </select>
                  </FormField>

                  {race.field_frozen_at || pickWindowPartnerByRaceId.has(race.id) ? (
                    <>
                      <input name="season_id" type="hidden" value={String(race.season_id)} />
                      <input name="round_number" type="hidden" value={String(race.round_number)} />
                      {pickWindowPartnerByRaceId.has(race.id) ? (
                        <input
                          name="qualifying_start_at"
                          type="hidden"
                          value={formatDateTimeLocalInput(race.qualifying_start_at)}
                        />
                      ) : null}
                      <input
                        name="pick_format"
                        type="hidden"
                        value={normalizeRacePickFormat(race.pick_format)}
                      />
                      {race.field_frozen_at ? (
                        <label className="flex items-center gap-2 rounded-md border ui-status-warning border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900 md:col-span-6">
                          <input name="allow_schedule_correction" type="checkbox" />
                          Confirm a qualifying/race-time correction if submitted picks already
                          exist. Leave unchecked for name, payout, or image changes.
                        </label>
                      ) : (
                        <p className="rounded-md border border-cyan-200 bg-cyan-50 px-3 py-2 text-xs text-cyan-900 md:col-span-6">
                          Qualifying time and race identity are controlled by the shared deadline
                          link below. Unlink before changing them.
                        </p>
                      )}
                    </>
                  ) : null}

                  <FormField className="md:col-span-3" label="Replace title image">
                    <input
                      accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
                      className={fieldControlClassName("px-2 py-2 text-xs")}
                      name="title_image_file"
                      type="file"
                    />
                  </FormField>

                  <FormField className="md:col-span-3" label="Title image URL fallback">
                    <input
                      className={fieldControlClassName("px-2 py-2")}
                      defaultValue={race.title_image_url ?? ""}
                      name="title_image_url"
                      type="url"
                    />
                  </FormField>

                  <SubmitButton
                    className={actionControlClassName("primary", "self-end md:col-span-2")}
                    data-testid={`admin-race-save-${race.id}`}
                    pendingLabel="Saving..."
                  >
                    Save
                  </SubmitButton>
                </form>

                  {normalizeRacePickFormat(race.pick_format) === "standard" &&
                  !race.field_frozen_at &&
                  !race.is_archived ? (
                    <form
                      action={setRacePickWindowAction}
                      className="mt-3 flex flex-wrap items-end gap-2 border-t border-slate-200 pt-3"
                    >
                      <input name="race_id" type="hidden" value={race.id} />
                      <label className="min-w-0 flex-1">
                        <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                          Shared pick deadline
                        </span>
                        <select
                          className="w-full rounded-md ui-control-border border border-slate-300 px-3 py-2 text-sm"
                          defaultValue={
                            pickWindowPartnerByRaceId.get(race.id)?.id
                              ? String(pickWindowPartnerByRaceId.get(race.id)?.id)
                              : ""
                          }
                          name="pick_window_partner_id"
                        >
                          <option value="">Standalone race</option>
                          {races
                            .filter(
                              (candidate) =>
                                candidate.id !== race.id &&
                                candidate.season_id === race.season_id &&
                                Math.abs(candidate.round_number - race.round_number) === 1 &&
                                !candidate.is_archived &&
                                !candidate.field_frozen_at &&
                                normalizeRacePickFormat(candidate.pick_format) === "standard" &&
                                ((racesByPickWindow.get(candidate.pick_window_key)?.length ?? 0) ===
                                  1 ||
                                  candidate.id ===
                                    pickWindowPartnerByRaceId.get(race.id)?.id)
                            )
                            .map((candidate) => (
                              <option key={candidate.id} value={candidate.id}>
                                R{candidate.round_number} · {candidate.race_name}
                              </option>
                            ))}
                        </select>
                      </label>
                      <SubmitButton
                        className="rounded-md border border-cyan-700 bg-white px-3 py-2 text-sm font-semibold text-cyan-800 hover:bg-cyan-50"
                        pendingLabel="Saving..."
                      >
                        Save deadline link
                      </SubmitButton>
                      <p className="w-full text-xs text-slate-500">
                        Linking copies the selected race&apos;s qualifying time. Both forms then
                        freeze and lock together while remaining separately scored.
                      </p>
                    </form>
                  ) : pickWindowPartnerByRaceId.has(race.id) ? (
                    <p className="mt-3 border-t border-slate-200 pt-3 text-xs text-slate-600">
                      Shared with {pickWindowPartnerByRaceId.get(race.id)?.race_name}. This link is
                      locked because the race field has frozen.
                    </p>
                  ) : null}

                  <div className="mt-3 flex flex-wrap justify-end gap-2">
                    <form action={setRaceArchivedAction}>
                      <input name="race_id" type="hidden" value={String(race.id)} />
                      <input name="tab" type="hidden" value="races" />
                      <input name="archive" type="hidden" value={race.is_archived ? "false" : "true"} />
                      <ConfirmSubmitButton
                        className={`rounded-md px-2 py-2 text-xs font-semibold ${
                          race.is_archived
                            ? "border border-emerald-300 text-emerald-700 hover:bg-emerald-50"
                            : "border border-amber-300 text-amber-800 hover:bg-amber-50"
                        }`}
                        confirmMessage={
                          race.is_archived
                            ? pickWindowPartnerByRaceId.has(race.id)
                              ? `Unarchive both ${race.race_name} and ${pickWindowPartnerByRaceId.get(race.id)?.race_name}? They will return to active pick/result workflows together.`
                              : `Unarchive ${race.race_name}? It will return to active pick/result workflows.`
                            : pickWindowPartnerByRaceId.has(race.id)
                              ? `Archive both ${race.race_name} and ${pickWindowPartnerByRaceId.get(race.id)?.race_name}? Their data remains, but both leave active pick/result workflows.`
                              : `Archive ${race.race_name}? This keeps data but removes it from active pick/result workflows.`
                        }
                        data-testid={`admin-race-archive-toggle-${race.id}`}
                        formNoValidate
                        type="submit"
                      >
                        {pickWindowPartnerByRaceId.has(race.id)
                          ? race.is_archived
                            ? "Unarchive doubleheader"
                            : "Archive doubleheader"
                          : race.is_archived
                            ? "Unarchive race"
                            : "Archive race"}
                      </ConfirmSubmitButton>
                    </form>

                    <form action={deleteRaceAction}>
                      <input name="race_id" type="hidden" value={String(race.id)} />
                      <input name="tab" type="hidden" value="races" />
                      <ConfirmSubmitButton
                        className="rounded-md border border-red-300 px-2 py-2 text-xs font-semibold text-red-700 hover:bg-red-50"
                        confirmMessage={`Delete ${race.race_name}? Deletion is allowed only while the race has no picks or results. Otherwise, archive it.`}
                        data-testid={`admin-race-delete-${race.id}`}
                        formNoValidate
                        type="submit"
                      >
                        Delete race
                      </ConfirmSubmitButton>
                    </form>
                  </div>
                </div>
              </details>
            ))
          )}
        </div>
        </section>
  );
}
