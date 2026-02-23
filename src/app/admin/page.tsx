import Link from "next/link";
import {
  cleanupTestFlowDataAction,
  createDriverAction,
  createRaceAction,
  deleteRaceAction,
  deleteDriverAction,
  importChampionshipStandingsAction,
  importIndycarResultsAction,
  setRaceArchivedAction,
  setRaceWinnerAction,
  updateRaceAction,
  updateDriverAction,
  upsertResultAction
} from "@/app/admin/actions";
import { AdminResultsImportForm } from "@/components/admin-results-import-form";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { SignOutButton } from "@/components/sign-out-button";
import { requireAdmin } from "@/lib/admin";
import { feedbackCategoryLabel, feedbackTypeLabel } from "@/lib/feedback";
import { queryStringParam } from "@/lib/query";
import {
  formatLeagueDateTime,
  formatLeagueDateTimeLocalInput,
  LEAGUE_TIME_ZONE
} from "@/lib/timezone";

type DriverRow = {
  championship_points: number;
  current_standing: number;
  driver_name: string;
  group_number: number;
  id: number;
  image_url: string | null;
  is_active: boolean;
};

type RaceRow = {
  archived_at: string | null;
  id: number;
  is_archived: boolean;
  payout: number | string;
  qualifying_start_at: string;
  race_date: string;
  race_name: string;
  title_image_url: string | null;
  winner_auto_eligible_at: string | null;
  winner_is_manual_override: boolean;
  winner_profile_id: string | null;
  winner_set_at: string | null;
  winner_source: "auto" | "manual";
};

type WinnerProfileRow = {
  id: string;
  role: "admin" | "participant";
  team_name: string;
};

type ResultRow = {
  driver_id: number;
  id: number;
  points: number;
  race_id: number;
};

type FeedbackItemRow = {
  category: string;
  context_page: string | null;
  created_at: string;
  details: string;
  feedback_type: string;
  id: number;
  user_id: string;
};

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

type AdminTab = "drivers" | "races" | "results" | "feedback";

const formatDateTime = (value: string): string =>
  formatLeagueDateTime(value, { dateStyle: "medium", timeStyle: "short" });

const formatDateTimeLocalInput = (value: string): string =>
  formatLeagueDateTimeLocalInput(value);

const parseAdminTab = (value: string | undefined): AdminTab => {
  if (value === "races" || value === "results" || value === "feedback") {
    return value;
  }

  return "drivers";
};

export default async function AdminPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const message = queryStringParam(params.message);
  const error = queryStringParam(params.error);
  const activeTab = parseAdminTab(queryStringParam(params.tab));

  const { profile, supabase } = await requireAdmin();

  const [driversResponse, racesResponse, resultsResponse, profilesResponse, feedbackResponse] =
    await Promise.all([
    supabase
      .from("drivers")
      .select("id,driver_name,image_url,current_standing,group_number,is_active,championship_points")
      .order("current_standing", { ascending: true }),
    supabase
      .from("races")
      .select(
        "id,race_name,title_image_url,qualifying_start_at,race_date,payout,is_archived,archived_at,winner_profile_id,winner_source,winner_is_manual_override,winner_auto_eligible_at,winner_set_at"
      )
      .order("race_date", { ascending: false }),
    supabase
      .from("results")
      .select("id,race_id,driver_id,points")
      .order("race_id", { ascending: false })
      .order("points", { ascending: false }),
    supabase
      .from("profiles")
      .select("id,team_name,role")
      .in("role", ["participant", "admin"])
      .order("team_name", { ascending: true }),
    supabase
      .from("feedback_items")
      .select("id,user_id,feedback_type,category,context_page,details,created_at")
      .order("created_at", { ascending: false })
  ]);

  const loadError =
    driversResponse.error?.message ??
    racesResponse.error?.message ??
    resultsResponse.error?.message ??
    profilesResponse.error?.message ??
    feedbackResponse.error?.message;

  const drivers: DriverRow[] = (driversResponse.data ?? []) as DriverRow[];
  const races: RaceRow[] = (racesResponse.data ?? []) as RaceRow[];
  const activeRaces = races.filter((race) => !race.is_archived);
  const results: ResultRow[] = (resultsResponse.data ?? []) as ResultRow[];
  const winnerProfiles: WinnerProfileRow[] = (profilesResponse.data ?? []) as WinnerProfileRow[];
  const feedbackItems: FeedbackItemRow[] = (feedbackResponse.data ?? []) as FeedbackItemRow[];

  const driverNameById = new Map(drivers.map((driver) => [driver.id, driver.driver_name]));
  const teamNameByProfileId = new Map(winnerProfiles.map((profile) => [profile.id, profile.team_name]));
  const raceById = new Map(races.map((race) => [race.id, race]));

  const sortedResults = [...results].sort((a, b) => {
    const aRaceDate = raceById.get(a.race_id)?.race_date ?? "1970-01-01T00:00:00.000Z";
    const bRaceDate = raceById.get(b.race_id)?.race_date ?? "1970-01-01T00:00:00.000Z";
    return new Date(bRaceDate).getTime() - new Date(aRaceDate).getTime() || b.points - a.points;
  });

  const feedbackDetailPreview = (value: string): string =>
    value.length > 220 ? `${value.slice(0, 217)}...` : value;

  const tabLinkClass = (tab: AdminTab): string =>
    `rounded-md px-3 py-2 text-sm font-medium ${
      activeTab === tab
        ? "bg-slate-900 text-white"
        : "border border-slate-300 text-slate-700 hover:bg-slate-100"
    }`;

  return (
    <main className="mx-auto flex min-h-screen max-w-7xl flex-col px-6 py-10">
      <header className="relative flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="inline-flex rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-blue-700">
            League Ops
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight">Admin Dashboard</h1>
          <p className="mt-2 text-sm text-slate-600">
            League admin tools for drivers, races, and official results.
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Signed in as <span className="font-semibold">{profile.team_name}</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
            href="/dashboard"
          >
            Back to dashboard
          </Link>
          <SignOutButton />
        </div>
      </header>

      {error ? (
        <p className="mt-6 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      {message ? (
        <p className="mt-6 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {message}
        </p>
      ) : null}

      {loadError ? (
        <p className="mt-6 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          Failed to load admin data: {loadError}
        </p>
      ) : null}

      <nav className="mt-6 flex flex-wrap gap-2">
        <Link className={tabLinkClass("drivers")} data-testid="admin-tab-drivers" href="/admin?tab=drivers">
          Drivers
        </Link>
        <Link className={tabLinkClass("races")} data-testid="admin-tab-races" href="/admin?tab=races">
          Races
        </Link>
        <Link className={tabLinkClass("results")} data-testid="admin-tab-results" href="/admin?tab=results">
          Race Results
        </Link>
        <Link className={tabLinkClass("feedback")} data-testid="admin-tab-feedback" href="/admin?tab=feedback">
          Feedback
        </Link>
      </nav>

      {activeTab === "drivers" ? (
        <section className="mt-6 rounded-lg border border-slate-200 bg-white p-6">
        <h2 className="text-xl font-semibold text-slate-900">Drivers</h2>
        <p className="mt-2 text-sm text-slate-600">
          Import championship standings mainly for preseason seeding or corrections. Weekly
          championship points and group placement update automatically from race results.
        </p>

        <form
          action={importChampionshipStandingsAction}
          className="mt-5 rounded-md border border-slate-200 bg-slate-50 p-4"
          data-testid="admin-standings-import-form"
        >
          <input name="tab" type="hidden" value="drivers" />
          <h3 className="text-sm font-semibold text-slate-900">Import Championship Standings</h3>
          <p className="mt-1 text-xs text-slate-600">
            Paste rows like your `sample2.txt` (Rank, Driver, Engine, Points, ...). The importer
            maps Rank, Driver, and Points for one-time seed/correction updates.
          </p>
          <textarea
            required
            className="mt-3 h-36 w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-xs"
            data-testid="admin-standings-import-input"
            name="standings_paste"
            placeholder={"1\tAlex Palou\tHonda\t711\t0\t17\t8\t6\t14\t15\t778"}
          />
          <button
            className="mt-3 rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700"
            data-testid="admin-standings-import-submit"
            type="submit"
          >
            Import standings
          </button>
        </form>

        <form
          action={createDriverAction}
          className="mt-5 grid gap-3 rounded-md border border-slate-200 bg-slate-50 p-4 md:grid-cols-5"
          data-testid="admin-driver-create-form"
        >
          <input name="tab" type="hidden" value="drivers" />
          <label className="block md:col-span-2">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">
              Driver name
            </span>
            <input
              required
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              data-testid="admin-driver-create-name"
              name="driver_name"
              type="text"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">
              Image upload
            </span>
            <input
              accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              data-testid="admin-driver-create-image-file"
              name="image_file"
              type="file"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">
              Image URL (fallback)
            </span>
            <input
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              data-testid="admin-driver-create-image-url"
              name="image_url"
              type="url"
            />
          </label>

          <div className="md:col-span-5 flex items-end justify-between gap-3">
            <label className="inline-flex items-center gap-2 text-sm text-slate-700">
              <input defaultChecked name="is_active" type="checkbox" />
              Active
            </label>
            <button
              className="rounded-md bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-700"
              data-testid="admin-driver-create-submit"
              type="submit"
            >
              Add driver
            </button>
          </div>
        </form>
        <p className="mt-2 text-xs text-slate-600">
          Manually added drivers start at 0 championship points and are auto-ranked to the bottom
          on refresh.
        </p>

        <div className="mt-5 grid gap-3">
          {drivers.length === 0 ? (
            <p className="rounded-md border border-dashed border-slate-300 bg-slate-50 px-3 py-3 text-sm text-slate-600">
              No drivers yet.
            </p>
          ) : (
            drivers.map((driver) => (
              <div key={driver.id} className="rounded-md border border-slate-200 p-3">
                <p className="mb-2 text-xs text-slate-600">
                  Group <span className="font-semibold">{driver.group_number}</span> | Rank{" "}
                  <span className="font-semibold">#{driver.current_standing}</span> | Pts{" "}
                  <span className="font-semibold">{driver.championship_points}</span>
                </p>

                <div className="grid gap-2 md:grid-cols-12">
                  <div className="md:col-span-1 flex items-center">
                    {driver.image_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        alt={driver.driver_name}
                        className="h-10 w-10 rounded-full border border-slate-300 object-cover"
                        src={driver.image_url}
                      />
                    ) : (
                      <div className="flex h-10 w-10 items-center justify-center rounded-full border border-dashed border-slate-400 text-[10px] font-semibold text-slate-500">
                        IMG
                      </div>
                    )}
                  </div>

                  <form
                    action={updateDriverAction}
                    className="grid gap-2 md:col-span-10 md:grid-cols-10"
                    data-testid={`admin-driver-edit-form-${driver.id}`}
                  >
                    <input name="driver_id" type="hidden" value={String(driver.id)} />
                    <input name="tab" type="hidden" value="drivers" />

                    <input
                      required
                      className="w-full rounded-md border border-slate-300 px-2 py-2 text-sm md:col-span-3"
                      defaultValue={driver.driver_name}
                      name="driver_name"
                      placeholder="Driver name"
                      type="text"
                    />

                    <input
                      accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
                      className="w-full rounded-md border border-slate-300 px-2 py-2 text-xs md:col-span-2"
                      name="image_file"
                      type="file"
                    />

                    <input
                      className="w-full rounded-md border border-slate-300 px-2 py-2 text-sm md:col-span-3"
                      defaultValue={driver.image_url ?? ""}
                      name="image_url"
                      placeholder="Image URL (optional)"
                      type="url"
                    />

                    <label className="inline-flex items-center gap-2 text-sm text-slate-700 md:col-span-1">
                      <input defaultChecked={driver.is_active} name="is_active" type="checkbox" />
                      Active
                    </label>

                    <button
                      className="w-full rounded-md bg-slate-900 px-2 py-2 text-sm font-semibold text-white hover:bg-slate-700 md:col-span-1"
                      data-testid={`admin-driver-save-${driver.id}`}
                      type="submit"
                    >
                      Save
                    </button>
                  </form>

                  <form action={deleteDriverAction} className="md:col-span-1 flex md:justify-end">
                    <input name="driver_id" type="hidden" value={String(driver.id)} />
                    <input name="tab" type="hidden" value="drivers" />
                    <ConfirmSubmitButton
                      className="rounded-md border border-red-300 px-2 py-2 text-xs font-semibold text-red-700 hover:bg-red-50"
                      confirmMessage={`Delete ${driver.driver_name}? This cannot be undone.`}
                      data-testid={`admin-driver-delete-${driver.id}`}
                      formNoValidate
                      type="submit"
                    >
                      Delete
                    </ConfirmSubmitButton>
                  </form>
                </div>
              </div>
            ))
          )}
        </div>
        </section>
      ) : null}

      {activeTab === "races" ? (
        <section className="mt-6 rounded-lg border border-slate-200 bg-white p-6">
        <h2 className="text-xl font-semibold text-slate-900">Races</h2>
        <p className="mt-2 text-sm text-slate-600">
          Create race weeks with qualifying start (pick deadline), race start, payout, and an
          optional race title image shown on the Pick&apos;em Form.
        </p>
        <p className="mt-1 text-xs text-slate-500">
          All race times are interpreted and displayed in {LEAGUE_TIME_ZONE}.
        </p>

        <form
          action={createRaceAction}
          className="mt-5 grid gap-3 md:grid-cols-6"
          data-testid="admin-race-create-form"
        >
          <input name="tab" type="hidden" value="races" />
          <label className="block md:col-span-2">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">
              Race name
            </span>
            <input
              required
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              data-testid="admin-race-create-name"
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
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
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
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
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
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              data-testid="admin-race-create-payout"
              min={0}
              name="payout"
              step="0.01"
              type="number"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">
              Title image upload
            </span>
            <input
              accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              data-testid="admin-race-create-image-file"
              name="title_image_file"
              type="file"
            />
          </label>

          <label className="block md:col-span-2">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">
              Title image URL (fallback)
            </span>
            <input
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              data-testid="admin-race-create-image-url"
              name="title_image_url"
              type="url"
            />
          </label>

          <div className="md:col-span-6">
            <button
              className="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700"
              data-testid="admin-race-create-submit"
              type="submit"
            >
              Add race
            </button>
          </div>
        </form>

        <form
          action={setRaceWinnerAction}
          className="mt-6 grid gap-3 rounded-md border border-slate-200 bg-slate-50 p-4 md:grid-cols-3"
          data-testid="admin-race-winner-form"
        >
          <input name="tab" type="hidden" value="races" />
          <label className="block">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">
              Race
            </span>
            <select
              required
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              data-testid="admin-race-winner-race-select"
              name="race_id"
            >
              <option value="">{activeRaces.length > 0 ? "Select race" : "No active races"}</option>
              {activeRaces.map((race) => (
                <option key={race.id} value={String(race.id)}>
                  {race.race_name} (Qualifying: {formatDateTime(race.qualifying_start_at)})
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">
              Fantasy winner
            </span>
            <select
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              data-testid="admin-race-winner-profile-select"
              name="winner_profile_id"
            >
              <option value="">Auto-calculate now (clear manual override)</option>
              {winnerProfiles.map((winnerProfile) => (
                <option key={winnerProfile.id} value={winnerProfile.id}>
                  {winnerProfile.team_name}
                </option>
              ))}
            </select>
          </label>

          <div className="flex items-end">
            <button
              className="w-full rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700"
              data-testid="admin-race-winner-submit"
              type="submit"
            >
              Save fantasy winner
            </button>
          </div>
        </form>
        <p className="mt-2 text-xs text-slate-500">
          Auto winner uses highest weekly points, then lower average-speed prediction as tiebreaker.
          When race results are updated, auto-calculation is rescheduled for about 15 minutes later.
        </p>

        <div className="mt-5 overflow-x-auto rounded-md border border-slate-200">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-50 text-slate-700">
              <tr>
                <th className="px-3 py-2 font-semibold">Race</th>
                <th className="px-3 py-2 font-semibold">Title Image</th>
                <th className="px-3 py-2 font-semibold">Qualifying</th>
                <th className="px-3 py-2 font-semibold">Race Start</th>
                <th className="px-3 py-2 font-semibold">Payout</th>
                <th className="px-3 py-2 font-semibold">Status</th>
                <th className="px-3 py-2 font-semibold">Fantasy Winner</th>
              </tr>
            </thead>
            <tbody>
              {races.length === 0 ? (
                <tr>
                  <td className="px-3 py-3 text-slate-600" colSpan={7}>
                    No races yet.
                  </td>
                </tr>
              ) : (
                races.map((race) => (
                  <tr key={race.id} className="border-t border-slate-200">
                    <td className="px-3 py-2">{race.race_name}</td>
                    <td className="px-3 py-2">
                      {race.title_image_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          alt={`${race.race_name} title`}
                          className="h-10 w-20 rounded border border-slate-200 object-cover"
                          src={race.title_image_url}
                        />
                      ) : (
                        <span className="text-xs text-slate-500">No image</span>
                      )}
                    </td>
                    <td className="px-3 py-2">{formatDateTime(race.qualifying_start_at)}</td>
                    <td className="px-3 py-2">{formatDateTime(race.race_date)}</td>
                    <td className="px-3 py-2">${Number(race.payout).toFixed(2)}</td>
                    <td className="px-3 py-2">
                      {race.is_archived ? (
                        <div>
                          <div className="inline-flex rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-800">
                            Archived
                          </div>
                          <div className="mt-1 text-xs text-slate-500">
                            {race.archived_at ? formatDateTime(race.archived_at) : "-"}
                          </div>
                        </div>
                      ) : (
                        <span className="inline-flex rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-800">
                          Active
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <div className="font-medium text-slate-900">
                        {race.winner_profile_id
                          ? teamNameByProfileId.get(race.winner_profile_id) ?? `Team ${race.winner_profile_id}`
                          : "Not set"}
                      </div>
                      <div className="mt-1 text-xs text-slate-500">
                        {race.winner_auto_eligible_at
                          ? `Auto pending ${formatDateTime(race.winner_auto_eligible_at)}`
                          : race.winner_set_at
                            ? `${race.winner_source === "manual" ? "Manual" : "Auto"} set ${formatDateTime(race.winner_set_at)}`
                            : "Awaiting race results"}
                      </div>
                      {race.winner_is_manual_override ? (
                        <div className="mt-1 text-xs font-medium text-amber-700">Manual override enabled</div>
                      ) : null}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="mt-6">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-700">
            Edit Existing Races
          </h3>
          <p className="mt-1 text-xs text-slate-500">
            Update race fields inline, or delete a race if needed.
          </p>
        </div>

        <div className="mt-3 grid gap-3">
          {races.length === 0 ? (
            <p className="rounded-md border border-dashed border-slate-300 bg-slate-50 px-3 py-3 text-sm text-slate-600">
              No races to edit.
            </p>
          ) : (
            races.map((race) => (
              <div key={`race-edit-${race.id}`} className="rounded-md border border-slate-200 p-3">
                <form
                  action={updateRaceAction}
                  className="grid gap-2 md:grid-cols-12"
                  data-testid={`admin-race-edit-form-${race.id}`}
                >
                  <input name="race_id" type="hidden" value={String(race.id)} />
                  <input name="tab" type="hidden" value="races" />

                  <input
                    required
                    className="w-full rounded-md border border-slate-300 px-2 py-2 text-sm md:col-span-2"
                    defaultValue={race.race_name}
                    name="race_name"
                    placeholder="Race name"
                    type="text"
                  />

                  <input
                    required
                    className="w-full rounded-md border border-slate-300 px-2 py-2 text-sm md:col-span-2"
                    defaultValue={formatDateTimeLocalInput(race.qualifying_start_at)}
                    name="qualifying_start_at"
                    type="datetime-local"
                  />

                  <input
                    required
                    className="w-full rounded-md border border-slate-300 px-2 py-2 text-sm md:col-span-2"
                    defaultValue={formatDateTimeLocalInput(race.race_date)}
                    name="race_date"
                    type="datetime-local"
                  />

                  <input
                    required
                    className="w-full rounded-md border border-slate-300 px-2 py-2 text-sm md:col-span-1"
                    defaultValue={String(race.payout)}
                    min={0}
                    name="payout"
                    step="0.01"
                    type="number"
                  />

                  <input
                    accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
                    className="w-full rounded-md border border-slate-300 px-2 py-2 text-xs md:col-span-2"
                    name="title_image_file"
                    type="file"
                  />

                  <input
                    className="w-full rounded-md border border-slate-300 px-2 py-2 text-sm md:col-span-2"
                    defaultValue={race.title_image_url ?? ""}
                    name="title_image_url"
                    placeholder="Title image URL (optional)"
                    type="url"
                  />

                  <button
                    className="rounded-md bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-700 md:col-span-1"
                    data-testid={`admin-race-save-${race.id}`}
                    type="submit"
                  >
                    Save
                  </button>
                </form>

                <form action={deleteRaceAction} className="mt-2 flex justify-end">
                  <input name="race_id" type="hidden" value={String(race.id)} />
                  <input name="tab" type="hidden" value="races" />
                  <ConfirmSubmitButton
                    className="rounded-md border border-red-300 px-2 py-2 text-xs font-semibold text-red-700 hover:bg-red-50"
                    confirmMessage={`Delete ${race.race_name}? This will remove all picks and race results for this event.`}
                    data-testid={`admin-race-delete-${race.id}`}
                    formNoValidate
                    type="submit"
                  >
                    Delete race
                  </ConfirmSubmitButton>
                </form>

                <form action={setRaceArchivedAction} className="mt-2 flex justify-end">
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
                        ? `Unarchive ${race.race_name}? It will return to active pick/result workflows.`
                        : `Archive ${race.race_name}? This keeps data but removes it from active pick/result workflows.`
                    }
                    data-testid={`admin-race-archive-toggle-${race.id}`}
                    formNoValidate
                    type="submit"
                  >
                    {race.is_archived ? "Unarchive race" : "Archive race"}
                  </ConfirmSubmitButton>
                </form>
              </div>
            ))
          )}
        </div>
        </section>
      ) : null}

      {activeTab === "results" ? (
        <section className="mt-6 rounded-lg border border-slate-200 bg-white p-6">
        <h2 className="text-xl font-semibold text-slate-900">Race Results</h2>
        <p className="mt-2 text-sm text-slate-600">
          Enter official points for each race/driver combination. Existing entries are updated.
        </p>
        {message ? (
          <p
            className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800"
            data-testid="admin-results-save-alert"
          >
            Latest update: {message}
          </p>
        ) : null}

        <AdminResultsImportForm
          action={importIndycarResultsAction}
          activeRaces={activeRaces.map((race) => ({ id: race.id, raceName: race.race_name }))}
          drivers={drivers.map((driver) => ({ driverName: driver.driver_name, id: driver.id }))}
        />

        <form
          action={upsertResultAction}
          className="mt-5 grid gap-3 md:grid-cols-4"
          data-testid="admin-results-manual-form"
        >
          <input name="tab" type="hidden" value="results" />
          <label className="block">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">
              Race
            </span>
            <select
              required
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              data-testid="admin-results-manual-race-select"
              name="race_id"
            >
              <option value="">{activeRaces.length > 0 ? "Select race" : "No active races"}</option>
              {activeRaces.map((race) => (
                <option key={race.id} value={String(race.id)}>
                  {race.race_name}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">
              Driver
            </span>
            <select
              required
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
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
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              data-testid="admin-results-manual-points"
              min={0}
              name="points"
              step={1}
              type="number"
            />
          </label>

          <div className="flex items-end">
            <button
              className="w-full rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700"
              data-testid="admin-results-manual-submit"
              type="submit"
            >
              Save result
            </button>
          </div>
        </form>

        <div className="mt-5 overflow-x-auto rounded-md border border-slate-200">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-50 text-slate-700">
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
        </section>
      ) : null}

      {activeTab === "feedback" ? (
        <section className="mt-6 rounded-lg border border-slate-200 bg-white p-6">
          <h2 className="text-xl font-semibold text-slate-900">Participant Feedback</h2>
          <p className="mt-2 text-sm text-slate-600">
            Bug reports and improvement ideas submitted by participants.
          </p>
          <p className="mt-1 text-xs text-slate-500">Times shown in {LEAGUE_TIME_ZONE}.</p>

          <form action={cleanupTestFlowDataAction} className="mt-4">
            <input name="tab" type="hidden" value="feedback" />
            <ConfirmSubmitButton
              className="rounded-md border border-amber-300 px-3 py-2 text-sm font-semibold text-amber-800 hover:bg-amber-50"
              confirmMessage="Delete all [TEST FLOW ...] seeded races, test users, and test feedback?"
              data-testid="admin-feedback-cleanup-test-data"
              formNoValidate
              type="submit"
            >
              Cleanup test flow data
            </ConfirmSubmitButton>
          </form>

          <div className="mt-5 overflow-x-auto rounded-md border border-slate-200">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-slate-50 text-slate-700">
                <tr>
                  <th className="px-3 py-2 font-semibold">Submitted</th>
                  <th className="px-3 py-2 font-semibold">Team</th>
                  <th className="px-3 py-2 font-semibold">Type</th>
                  <th className="px-3 py-2 font-semibold">Category</th>
                  <th className="px-3 py-2 font-semibold">Context</th>
                  <th className="px-3 py-2 font-semibold">Details</th>
                </tr>
              </thead>
              <tbody>
                {feedbackItems.length === 0 ? (
                  <tr>
                    <td className="px-3 py-3 text-slate-600" colSpan={6}>
                      No feedback submissions yet.
                    </td>
                  </tr>
                ) : (
                  feedbackItems.map((item) => (
                    <tr key={item.id} className="border-t border-slate-200 align-top">
                      <td className="px-3 py-2 whitespace-nowrap">{formatDateTime(item.created_at)}</td>
                      <td className="px-3 py-2">
                        {teamNameByProfileId.get(item.user_id) ?? `User ${item.user_id}`}
                      </td>
                      <td className="px-3 py-2">{feedbackTypeLabel(item.feedback_type)}</td>
                      <td className="px-3 py-2">{feedbackCategoryLabel(item.category)}</td>
                      <td className="px-3 py-2">{item.context_page || "-"}</td>
                      <td className="px-3 py-2">{feedbackDetailPreview(item.details)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </main>
  );
}
