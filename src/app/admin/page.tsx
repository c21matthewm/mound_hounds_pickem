import type { SupabaseClient } from "@supabase/supabase-js";
import Link from "next/link";
import {
  cleanupTestFlowDataAction,
  activateLeagueSeasonAction,
  createLeagueSeasonAction,
  createDriverAction,
  createRaceAction,
  deleteRaceAction,
  deleteDriverAction,
  finalizeHallOfFameSeasonAction,
  importChampionshipStandingsAction,
  importIndy500QualifyingOrderAction,
  importIndycarResultsAction,
  publishSavedRaceResultsAction,
  setRaceArchivedAction,
  setRaceWinnerAction,
  updateRaceAction,
  updateDriverAction,
  updateParticipantAction,
  upsertResultAction
} from "@/app/admin/actions";
import { AuthenticatedPageShell } from "@/components/authenticated-page-shell";
import { AdminResultsImportForm } from "@/components/admin-results-import-form";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { SignOutButton } from "@/components/sign-out-button";
import { requireAdmin } from "@/lib/admin";
import { feedbackCategoryLabel, feedbackTypeLabel } from "@/lib/feedback";
import { queryStringParam } from "@/lib/query";
import {
  normalizeRacePickFormat,
  pickGroupCountForFormat,
  type RacePickFormat
} from "@/lib/race-format";
import { isMissingColumnError } from "@/lib/supabase/schema-compat";
import { loadAllRows } from "@/lib/supabase/paginated-query";
import {
  formatLeagueDateTime,
  formatLeagueDateTimeLocalInput,
  LEAGUE_TIME_ZONE
} from "@/lib/timezone";
import { assignWeeklyRanks, calculateOfficialSpeedDelta } from "@/lib/weekly-ranking";

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
  official_winning_average_speed: number | string | null;
  pick_format: RacePickFormat;
  payout: number | string;
  qualifying_start_at: string;
  race_date: string;
  race_name: string;
  round_number: number;
  season_id: number;
  results_published_at: string | null;
  results_status: "draft" | "published";
  title_image_url: string | null;
  winner_auto_eligible_at: string | null;
  winner_is_manual_override: boolean;
  winner_profile_id: string | null;
  winner_set_at: string | null;
  winner_source: "auto" | "manual";
};

type WinnerProfileRow = {
  full_name: string | null;
  id: string;
  is_active: boolean;
  role: "admin" | "participant";
  team_name: string;
};

type LeagueSeasonRow = {
  activated_at: string | null;
  completed_at: string | null;
  display_name: string;
  id: number;
  season_year: number;
  status: "active" | "completed" | "upcoming";
};

type ResultRow = {
  driver_id: number;
  id: number;
  points: number;
  race_id: number;
};

type PickSummaryRow = {
  average_speed: number | string;
  driver_group1_id: number;
  driver_group2_id: number;
  driver_group3_id: number;
  driver_group4_id: number;
  driver_group5_id: number;
  driver_group6_id: number;
  driver_group7_id: number | null;
  driver_group8_id: number | null;
  race_id: number;
  user_id: string;
};

type RaceDriverGroupRow = {
  driver_id: number;
  group_number: number;
  qualifying_position: number | null;
  race_id: number;
};

type FeedbackItemRow = {
  category: string;
  created_at: string;
  details: string;
  feedback_type: string;
  id: number;
  user_id: string;
};

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

type AdminTab = "drivers" | "participants" | "races" | "results" | "feedback";

type ScoringAuditDriverCell = {
  driverName: string | null;
  groupNumber: number;
  points: number | null;
};

type ScoringAuditRow = {
  averageSpeed: number | null;
  driverCells: ScoringAuditDriverCell[];
  points: number;
  rank: number;
  submittedPick: boolean;
  teamName: string;
  tiebreakDelta: number | null;
  userId: string;
};

type ScoringAudit = {
  groupCount: number;
  highestPossibleScore: number;
  lowestPossibleScore: number;
  noPickCount: number;
  officialWinningAverageSpeed: number | null;
  pickFormat: RacePickFormat;
  raceDate: string;
  raceId: number;
  raceName: string;
  resultCount: number;
  resultsStatus: "draft" | "published";
  rows: ScoringAuditRow[];
  submittedPickCount: number;
  winnerTeamName: string | null;
};

const formatDateTime = (value: string): string =>
  formatLeagueDateTime(value, { dateStyle: "medium", timeStyle: "short" });

const formatDateTimeLocalInput = (value: string): string =>
  formatLeagueDateTimeLocalInput(value);

const parseAdminTab = (value: string | undefined): AdminTab => {
  if (
    value === "participants" ||
    value === "races" ||
    value === "results" ||
    value === "feedback"
  ) {
    return value;
  }

  return "drivers";
};

const asNumber = (value: number | string | null | undefined): number => {
  if (typeof value === "number") {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }

  return 0;
};

const formatOptionalDecimal = (value: number | null, digits = 3): string =>
  value === null ? "-" : value.toFixed(digits);

const loadAdminRaces = async (supabase: SupabaseClient) => {
  const fields =
    "id,race_name,pick_format,title_image_url,qualifying_start_at,race_date,payout,official_winning_average_speed,results_status,results_published_at,is_archived,archived_at,winner_profile_id,winner_source,winner_is_manual_override,winner_auto_eligible_at,winner_set_at,season_id,round_number";
  const legacyFields =
    "id,race_name,title_image_url,qualifying_start_at,race_date,payout,official_winning_average_speed,results_status,results_published_at,is_archived,archived_at,winner_profile_id,winner_source,winner_is_manual_override,winner_auto_eligible_at,winner_set_at";

  const response = await supabase.from("races").select(fields).order("race_date", { ascending: false });
  if (!response.error || !isMissingColumnError(response.error, "pick_format")) {
    return response;
  }

  const legacyResponse = await supabase
    .from("races")
    .select(legacyFields)
    .order("race_date", { ascending: false });

  return {
    ...legacyResponse,
    data: (legacyResponse.data ?? []).map((race) => ({
      ...race,
      pick_format: "standard" as const
    }))
  };
};

const paginatedAdminLoad = async <T,>(
  label: string,
  loadPage: Parameters<typeof loadAllRows<T>>[1]
): Promise<{ data: T[] | null; error: { message: string } | null }> => {
  try {
    return { data: await loadAllRows<T>(label, loadPage), error: null };
  } catch (error) {
    return {
      data: null,
      error: { message: error instanceof Error ? error.message : `Failed to load ${label}.` }
    };
  }
};

const loadRaceDriverGroups = async (supabase: SupabaseClient) =>
  paginatedAdminLoad<RaceDriverGroupRow>("race driver groups", (from, to) =>
    supabase
      .from("race_driver_groups")
      .select("race_id,driver_id,group_number,qualifying_position")
      .order("race_id", { ascending: true })
      .order("driver_id", { ascending: true })
      .range(from, to)
  );

const loadAdminPicks = async (supabase: SupabaseClient) =>
  paginatedAdminLoad<PickSummaryRow>("admin picks", (from, to) =>
    supabase
      .from("picks")
      .select(
        "user_id,race_id,average_speed,driver_group1_id,driver_group2_id,driver_group3_id,driver_group4_id,driver_group5_id,driver_group6_id,driver_group7_id,driver_group8_id"
      )
      .order("race_id", { ascending: true })
      .order("user_id", { ascending: true })
      .range(from, to)
  );

const keyForRaceDriver = (raceId: number, driverId: number): string => `${raceId}:${driverId}`;
const keyForRaceUser = (raceId: number, userId: string): string => `${raceId}:${userId}`;

const pickDriverIdsForGroupCount = (
  pick: PickSummaryRow | null,
  groupCount: number
): Array<number | null> =>
  [
    pick?.driver_group1_id ?? null,
    pick?.driver_group2_id ?? null,
    pick?.driver_group3_id ?? null,
    pick?.driver_group4_id ?? null,
    pick?.driver_group5_id ?? null,
    pick?.driver_group6_id ?? null,
    pick?.driver_group7_id ?? null,
    pick?.driver_group8_id ?? null
  ].slice(0, groupCount);

const buildPickedDriverGroupByRaceDriver = (picks: PickSummaryRow[]): Map<string, number> => {
  const pickedDriverGroupByRaceDriver = new Map<string, number>();

  picks.forEach((pick) => {
    const groupedDriverIds: Array<[number, number]> = [
      [pick.driver_group1_id, 1],
      [pick.driver_group2_id, 2],
      [pick.driver_group3_id, 3],
      [pick.driver_group4_id, 4],
      [pick.driver_group5_id, 5],
      [pick.driver_group6_id, 6],
      [pick.driver_group7_id, 7],
      [pick.driver_group8_id, 8]
    ].filter((row): row is [number, number] => row[0] !== null);

    groupedDriverIds.forEach(([driverId, groupNumber]) => {
      const key = keyForRaceDriver(pick.race_id, driverId);
      if (!pickedDriverGroupByRaceDriver.has(key)) {
        pickedDriverGroupByRaceDriver.set(key, groupNumber);
      }
    });
  });

  return pickedDriverGroupByRaceDriver;
};

const resolveRaceDriverGroup = (
  raceId: number,
  driverId: number,
  raceDriverGroupByRaceDriver: Map<string, number>,
  pickedDriverGroupByRaceDriver: Map<string, number>,
  currentDriverGroupById: Map<number, number>
): number | undefined =>
  raceDriverGroupByRaceDriver.get(keyForRaceDriver(raceId, driverId)) ??
  pickedDriverGroupByRaceDriver.get(keyForRaceDriver(raceId, driverId)) ??
  currentDriverGroupById.get(driverId);

const computeRaceExtremes = ({
  currentDriverGroupById,
  groupCount,
  pickedDriverGroupByRaceDriver,
  raceDriverGroupByRaceDriver,
  raceId,
  results
}: {
  currentDriverGroupById: Map<number, number>;
  groupCount: number;
  pickedDriverGroupByRaceDriver: Map<string, number>;
  raceDriverGroupByRaceDriver: Map<string, number>;
  raceId: number;
  results: ResultRow[];
}): { highest: number; lowest: number } => {
  const pointsByGroup = new Map<number, number[]>();
  for (let groupNumber = 1; groupNumber <= groupCount; groupNumber += 1) {
    pointsByGroup.set(groupNumber, []);
  }

  results.forEach((result) => {
    const groupNumber = resolveRaceDriverGroup(
      raceId,
      result.driver_id,
      raceDriverGroupByRaceDriver,
      pickedDriverGroupByRaceDriver,
      currentDriverGroupById
    );
    if (!groupNumber || groupNumber < 1 || groupNumber > groupCount) {
      return;
    }

    const groupPoints = pointsByGroup.get(groupNumber) ?? [];
    groupPoints.push(asNumber(result.points));
    pointsByGroup.set(groupNumber, groupPoints);
  });

  let highest = 0;
  let lowest = 0;
  for (let groupNumber = 1; groupNumber <= groupCount; groupNumber += 1) {
    const groupPoints = pointsByGroup.get(groupNumber) ?? [];
    if (groupPoints.length === 0) {
      continue;
    }

    highest += Math.max(...groupPoints);
    lowest += Math.min(...groupPoints);
  }

  return { highest, lowest };
};

const buildScoringAudits = ({
  drivers,
  participants,
  picks,
  raceDriverGroups,
  races,
  results
}: {
  drivers: DriverRow[];
  participants: WinnerProfileRow[];
  picks: PickSummaryRow[];
  raceDriverGroups: RaceDriverGroupRow[];
  races: RaceRow[];
  results: ResultRow[];
}): ScoringAudit[] => {
  const driverNameById = new Map(drivers.map((driver) => [driver.id, driver.driver_name]));
  const currentDriverGroupById = new Map(drivers.map((driver) => [driver.id, driver.group_number]));
  const pickedDriverGroupByRaceDriver = buildPickedDriverGroupByRaceDriver(picks);
  const raceDriverGroupByRaceDriver = new Map(
    raceDriverGroups.map((row) => [keyForRaceDriver(row.race_id, row.driver_id), row.group_number])
  );
  const resultPointsByRaceDriver = new Map(
    results.map((result) => [keyForRaceDriver(result.race_id, result.driver_id), asNumber(result.points)])
  );
  const resultsByRaceId = new Map<number, ResultRow[]>();
  results.forEach((result) => {
    const raceResults = resultsByRaceId.get(result.race_id) ?? [];
    raceResults.push(result);
    resultsByRaceId.set(result.race_id, raceResults);
  });
  const pickByRaceUser = new Map(picks.map((pick) => [keyForRaceUser(pick.race_id, pick.user_id), pick]));

  return races
    .flatMap((race) => {
      const raceResults = resultsByRaceId.get(race.id) ?? [];
      if (raceResults.length === 0) {
        return [];
      }

      const pickFormat = normalizeRacePickFormat(race.pick_format);
      const groupCount = pickGroupCountForFormat(pickFormat);
      const officialWinningAverageSpeed =
        race.official_winning_average_speed === null
          ? null
          : asNumber(race.official_winning_average_speed);
      const extremes = computeRaceExtremes({
        currentDriverGroupById,
        groupCount,
        pickedDriverGroupByRaceDriver,
        raceDriverGroupByRaceDriver,
        raceId: race.id,
        results: raceResults
      });
      const submittedUserIds = new Set(
        picks.filter((pick) => pick.race_id === race.id).map((pick) => pick.user_id)
      );
      const rankedRows = assignWeeklyRanks(
        participants.map((participant) => {
          const pick = pickByRaceUser.get(keyForRaceUser(race.id, participant.id)) ?? null;
          const driverCells = pickDriverIdsForGroupCount(pick, groupCount).map((driverId, index) => ({
            driverName: driverId === null ? null : (driverNameById.get(driverId) ?? `Driver #${driverId}`),
            groupNumber: index + 1,
            points:
              driverId === null
                ? null
                : (resultPointsByRaceDriver.get(keyForRaceDriver(race.id, driverId)) ?? 0)
          }));
          const points = pick
            ? driverCells.reduce((sum, cell) => sum + (cell.points ?? 0), 0)
            : extremes.lowest;

          return {
            averageSpeed: pick ? asNumber(pick.average_speed) : null,
            driverCells,
            points,
            submittedPick: pick !== null,
            teamName: participant.team_name,
            userId: participant.id
          };
        }),
        officialWinningAverageSpeed
      );

      return [
        {
          groupCount,
          highestPossibleScore: extremes.highest,
          lowestPossibleScore: extremes.lowest,
          noPickCount: Math.max(0, participants.length - submittedUserIds.size),
          officialWinningAverageSpeed,
          pickFormat,
          raceDate: race.race_date,
          raceId: race.id,
          raceName: race.race_name,
          resultCount: raceResults.length,
          resultsStatus: race.results_status,
          rows: rankedRows.map((row) => ({
            averageSpeed: row.averageSpeed,
            driverCells: row.driverCells,
            points: row.points,
            rank: row.rank,
            submittedPick: row.submittedPick,
            teamName: row.teamName,
            tiebreakDelta: calculateOfficialSpeedDelta(row.averageSpeed, officialWinningAverageSpeed),
            userId: row.userId
          })),
          submittedPickCount: submittedUserIds.size,
          winnerTeamName: rankedRows[0]?.teamName ?? null
        }
      ];
    })
    .sort((a, b) => new Date(b.raceDate).getTime() - new Date(a.raceDate).getTime());
};

export default async function AdminPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const message = queryStringParam(params.message);
  const error = queryStringParam(params.error);
  const activeTab = parseAdminTab(queryStringParam(params.tab));

  const { profile, supabase } = await requireAdmin();

  const [
    driversResponse,
    racesResponse,
    resultsResponse,
    profilesResponse,
    seasonsResponse,
    feedbackResponse,
    picksResponse,
    raceDriverGroupsResponse
  ] = await Promise.all([
    supabase
      .from("drivers")
      .select("id,driver_name,image_url,current_standing,group_number,is_active,championship_points")
      .order("current_standing", { ascending: true }),
    loadAdminRaces(supabase),
    paginatedAdminLoad<ResultRow>("admin race results", (from, to) =>
      supabase
        .from("results")
        .select("id,race_id,driver_id,points")
        .order("race_id", { ascending: false })
        .order("points", { ascending: false })
        .order("id", { ascending: true })
        .range(from, to)
    ),
    supabase
      .from("profiles")
      .select("id,full_name,team_name,role,is_active")
      .in("role", ["participant", "admin"])
      .order("team_name", { ascending: true }),
    supabase
      .from("league_seasons")
      .select("id,season_year,display_name,status,activated_at,completed_at")
      .order("season_year", { ascending: false }),
    paginatedAdminLoad<FeedbackItemRow>("participant feedback", (from, to) =>
      supabase
        .from("feedback_items")
        .select("id,user_id,feedback_type,category,details,created_at")
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .range(from, to)
    ),
    loadAdminPicks(supabase),
    loadRaceDriverGroups(supabase)
  ]);

  const loadError =
    driversResponse.error?.message ??
    racesResponse.error?.message ??
    resultsResponse.error?.message ??
    profilesResponse.error?.message ??
    seasonsResponse.error?.message ??
    feedbackResponse.error?.message ??
    picksResponse.error?.message ??
    raceDriverGroupsResponse.error?.message;

  const drivers: DriverRow[] = (driversResponse.data ?? []) as DriverRow[];
  const races: RaceRow[] = (racesResponse.data ?? []) as RaceRow[];
  const activeRaces = races.filter((race) => !race.is_archived);
  const results: ResultRow[] = (resultsResponse.data ?? []) as ResultRow[];
  const winnerProfiles: WinnerProfileRow[] = (profilesResponse.data ?? []) as WinnerProfileRow[];
  const activeParticipants = winnerProfiles.filter((participant) => participant.is_active);
  const seasons: LeagueSeasonRow[] = (seasonsResponse.data ?? []) as LeagueSeasonRow[];
  const activeSeason = seasons.find((season) => season.status === "active") ?? null;
  const feedbackItems: FeedbackItemRow[] = (feedbackResponse.data ?? []) as FeedbackItemRow[];
  const pickRows: PickSummaryRow[] = (picksResponse.data ?? []) as PickSummaryRow[];
  const raceDriverGroups: RaceDriverGroupRow[] = (
    raceDriverGroupsResponse.data ?? []
  ) as RaceDriverGroupRow[];
  const currentSeasonRaces = activeRaces.filter(
    (race) => race.season_id === activeSeason?.id
  );
  const activeIndy500Races = currentSeasonRaces.filter(
    (race) => normalizeRacePickFormat(race.pick_format) === "indy_500"
  );
  const unpublishedSeasonRaces = currentSeasonRaces.filter(
    (race) => race.results_status !== "published"
  );
  const finalSeasonRace = [...currentSeasonRaces]
    .sort((a, b) => Date.parse(a.race_date) - Date.parse(b.race_date))
    .at(-1);
  const currentTime = new Date().getTime();
  const canFinalizeSeason =
    currentSeasonRaces.length > 0 &&
    unpublishedSeasonRaces.length === 0 &&
    Boolean(finalSeasonRace && Date.parse(finalSeasonRace.race_date) <= currentTime);
  const hallOfFameSeasonResponse = activeSeason
    ? await supabase
      .from("hall_of_fame_seasons")
      .select("id,finalized_at,participant_count,race_count")
      .eq("season_year", activeSeason.season_year)
      .maybeSingle<{
      finalized_at: string;
      id: number;
      participant_count: number;
      race_count: number;
      }>()
    : { data: null, error: null };
  const savedHallOfFameSeason = hallOfFameSeasonResponse.data ?? null;
  const hallOfFameMigrationReady = !hallOfFameSeasonResponse.error;
  const scoringAudits = buildScoringAudits({
    drivers,
    participants: activeParticipants,
    picks: pickRows,
    raceDriverGroups,
    races: currentSeasonRaces,
    results
  });

  const driverNameById = new Map(drivers.map((driver) => [driver.id, driver.driver_name]));
  const teamNameByProfileId = new Map(winnerProfiles.map((profile) => [profile.id, profile.team_name]));
  const raceById = new Map(races.map((race) => [race.id, race]));
  const seasonById = new Map(seasons.map((season) => [season.id, season]));

  const currentSeasonRaceIds = new Set(currentSeasonRaces.map((race) => race.id));
  const sortedResults = results.filter((result) => currentSeasonRaceIds.has(result.race_id)).sort((a, b) => {
    const aRaceDate = raceById.get(a.race_id)?.race_date ?? "1970-01-01T00:00:00.000Z";
    const bRaceDate = raceById.get(b.race_id)?.race_date ?? "1970-01-01T00:00:00.000Z";
    return new Date(bRaceDate).getTime() - new Date(aRaceDate).getTime() || b.points - a.points;
  });

  const tabLinkClass = (tab: AdminTab): string =>
    `rounded-md px-3 py-2 text-sm font-medium ${
      activeTab === tab
        ? "bg-slate-900 text-white"
        : "border border-slate-300 text-slate-700 hover:bg-slate-100"
    }`;

  return (
    <AuthenticatedPageShell
      actions={
        <>
          <Link
            className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
            href="/dashboard"
          >
            Back to dashboard
          </Link>
          <SignOutButton className="static" />
        </>
      }
      description={
        <>
          Signed in as <span className="font-semibold text-slate-900">{profile.team_name}</span>.
        </>
      }
      eyebrow="League Ops"
      maxWidth="max-w-7xl"
      title="Admin Dashboard"
    >

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
        <Link
          className={tabLinkClass("participants")}
          data-testid="admin-tab-participants"
          href="/admin?tab=participants"
        >
          Participants
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

      {activeTab === "participants" ? (
        <section className="mt-6 rounded-lg border border-slate-200 bg-white p-4 sm:p-6">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold text-slate-900">Participants</h2>
              <p className="mt-1 text-sm text-slate-600">
                Active teams appear in current standings, picks, analytics, and email reminders.
              </p>
            </div>
            <p className="text-sm font-semibold text-slate-700">
              {winnerProfiles.filter((participant) => participant.is_active).length} active ·{" "}
              {winnerProfiles.length} total
            </p>
          </div>

          <div className="mt-5 grid gap-2">
            {winnerProfiles.map((participant) => (
              <details
                className="rounded-md border border-slate-200 bg-white"
                key={participant.id}
              >
                <summary className="cursor-pointer px-3 py-3">
                  <div className="flex min-w-0 items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-900">
                        {participant.team_name}
                      </p>
                      <p className="truncate text-xs text-slate-500">
                        {participant.full_name || "Name not set"} · {participant.role}
                      </p>
                    </div>
                    <span
                      className={`shrink-0 rounded-full border px-2 py-0.5 text-xs font-semibold ${
                        participant.is_active
                          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                          : "border-slate-200 bg-slate-50 text-slate-600"
                      }`}
                    >
                      {participant.is_active ? "Active" : "Inactive"}
                    </span>
                  </div>
                </summary>
                <form
                  action={updateParticipantAction}
                  className="grid gap-3 border-t border-slate-200 p-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_auto_auto]"
                >
                  <input name="profile_id" type="hidden" value={participant.id} />
                  <label className="block">
                    <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">
                      Name
                    </span>
                    <input
                      className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                      defaultValue={participant.full_name ?? ""}
                      name="full_name"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">
                      Team name
                    </span>
                    <input
                      required
                      className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                      defaultValue={participant.team_name}
                      name="team_name"
                    />
                  </label>
                  <label className="flex items-center gap-2 self-end rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700">
                    <input defaultChecked={participant.is_active} name="is_active" type="checkbox" />
                    Active
                  </label>
                  <button
                    className="self-end rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700"
                    type="submit"
                  >
                    Save
                  </button>
                </form>
              </details>
            ))}
          </div>
        </section>
      ) : null}

      {activeTab === "drivers" ? (
        <section className="mt-6 rounded-lg border border-slate-200 bg-white p-6">
        <h2 className="text-xl font-semibold text-slate-900">Drivers</h2>
        <p className="mt-2 text-sm text-slate-600">
          Opening order comes from the prior final standings. Current-season points and groups then
          update automatically from published race results.
        </p>

        <details className="mt-5 rounded-md border border-slate-200 bg-slate-50">
          <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-slate-900">
            Preseason seed tools
          </summary>
          <form
            action={importChampionshipStandingsAction}
            className="border-t border-slate-200 p-4"
            data-testid="admin-standings-import-form"
          >
            <input name="tab" type="hidden" value="drivers" />
            <h3 className="text-sm font-semibold text-slate-900">Import Opening Seed</h3>
            <p className="mt-1 text-xs text-slate-600">
              Use before the first published race. The importer maps Rank and Driver, while the new
              season starts every driver at 0 points.
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
              Import opening seed
            </button>
          </form>
        </details>

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
              <details key={driver.id} className="rounded-md border border-slate-200 bg-white">
                <summary className="cursor-pointer px-3 py-3">
                  <div className="inline-flex w-full flex-wrap items-center justify-between gap-3 align-middle">
                    <div className="flex min-w-0 items-center gap-3">
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
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-slate-900">{driver.driver_name}</p>
                        <p className="text-xs text-slate-500">
                          Group {driver.group_number} · Rank #{driver.current_standing} · {driver.championship_points} pts
                        </p>
                      </div>
                    </div>
                    <span
                      className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${
                        driver.is_active
                          ? "border-emerald-300 bg-emerald-50 text-emerald-800"
                          : "border-slate-300 bg-slate-50 text-slate-600"
                      }`}
                    >
                      {driver.is_active ? "Active" : "Inactive"}
                    </span>
                  </div>
                </summary>

                <div className="grid gap-2 border-t border-slate-200 p-3 md:grid-cols-12">
                  <form
                    action={updateDriverAction}
                    className="grid gap-2 md:col-span-11 md:grid-cols-10"
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
              </details>
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

        <details className="mt-5 rounded-md border border-slate-200 bg-slate-50">
          <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-slate-900">
            Season management · {activeSeason ? `${activeSeason.season_year} active` : "No active season"}
          </summary>
          <div className="border-t border-slate-200 p-4">
            <div className="grid gap-2">
              {seasons.map((season) => (
                <div
                  className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-slate-200 bg-white px-3 py-2"
                  key={season.id}
                >
                  <div>
                    <p className="text-sm font-semibold text-slate-900">{season.display_name}</p>
                    <p className="text-xs capitalize text-slate-500">{season.status}</p>
                  </div>
                  {season.status === "upcoming" ? (
                    <form action={activateLeagueSeasonAction}>
                      <input name="season_id" type="hidden" value={season.id} />
                      <ConfirmSubmitButton
                        className="rounded-md bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-700"
                        confirmMessage={`Activate ${season.season_year}? The current season must already be saved to the Hall of Fame. Driver points will reset to zero while final ranking order is retained for opening groups.`}
                        type="submit"
                      >
                        Activate season
                      </ConfirmSubmitButton>
                    </form>
                  ) : null}
                </div>
              ))}
            </div>
            <form action={createLeagueSeasonAction} className="mt-3 flex flex-wrap items-end gap-2">
              <label className="block">
                <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">
                  New season year
                </span>
                <input
                  className="w-36 rounded-md border border-slate-300 px-3 py-2 text-sm"
                  max={2100}
                  min={2000}
                  name="season_year"
                  placeholder="2027"
                  required
                  type="number"
                />
              </label>
              <button
                className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-100"
                type="submit"
              >
                Create season
              </button>
            </form>
          </div>
        </details>

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
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
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
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              defaultValue={
                currentSeasonRaces.length > 0
                  ? Math.max(...currentSeasonRaces.map((race) => race.round_number)) + 1
                  : 1
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
              Pick rules
            </span>
            <select
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              data-testid="admin-race-create-pick-format"
              defaultValue="standard"
              name="pick_format"
            >
              <option value="standard">Standard (6 picks, locks at qualifying)</option>
              <option value="indy_500">Indianapolis 500 (8 picks, locks at race start)</option>
            </select>
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

        <details className="mt-6 rounded-md border border-slate-200 bg-slate-50">
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
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
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
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
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
              <button
                className="w-full rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700"
                data-testid="admin-race-winner-submit"
                type="submit"
              >
                Save fantasy winner
              </button>
            </div>
            <p className="text-xs text-slate-500 md:col-span-3">
              Auto winner uses highest weekly points, then closest official average speed tiebreak, then team name.
            </p>
          </form>
        </details>

        <div className="mt-5 grid gap-3">
          {races.length === 0 ? (
            <p className="rounded-md border border-dashed border-slate-300 bg-slate-50 px-3 py-3 text-sm text-slate-600">
              No races yet.
            </p>
          ) : (
            races.map((race) => (
              <details key={`race-edit-${race.id}`} className="rounded-md border border-slate-200 bg-white">
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
                        <span className="rounded-full border border-cyan-300 bg-cyan-50 px-2 py-0.5 text-xs font-semibold text-cyan-800">
                          Indy 500
                        </span>
                      ) : (
                        <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-semibold text-slate-600">
                          Standard
                        </span>
                      )}
                      {race.is_archived ? (
                        <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-800">
                          Archived
                        </span>
                      ) : (
                        <span className="rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-800">
                          Active
                        </span>
                      )}
                      <span
                        className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${
                          race.results_status === "published"
                            ? "border-emerald-300 bg-emerald-50 text-emerald-800"
                            : "border-amber-300 bg-amber-50 text-amber-800"
                        }`}
                      >
                        Results {race.results_status === "published" ? "Published" : "Draft"}
                      </span>
                    </div>
                  </div>
                </summary>

                <div className="border-t border-slate-200 p-3">
                  <dl className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
                    <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                      <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                        Qualifying
                      </dt>
                      <dd className="mt-0.5 font-medium text-slate-900">
                        {formatDateTime(race.qualifying_start_at)}
                      </dd>
                    </div>
                    <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                      <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                        Fantasy Winner
                      </dt>
                      <dd className="mt-0.5 font-medium text-slate-900">
                        {race.winner_profile_id
                          ? teamNameByProfileId.get(race.winner_profile_id) ?? `Team ${race.winner_profile_id}`
                          : "Not set"}
                      </dd>
                    </div>
                    <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
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
                    <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
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

                  <select
                    required
                    className="w-full rounded-md border border-slate-300 px-2 py-2 text-sm md:col-span-1"
                    defaultValue={String(race.season_id)}
                    name="season_id"
                  >
                    {seasons.map((season) => (
                      <option key={season.id} value={season.id}>
                        {season.season_year}
                      </option>
                    ))}
                  </select>

                  <input
                    required
                    className="w-full rounded-md border border-slate-300 px-2 py-2 text-sm md:col-span-1"
                    defaultValue={race.round_number}
                    max={99}
                    min={1}
                    name="round_number"
                    placeholder="Round"
                    type="number"
                  />

                  <input
                    required
                    className="w-full rounded-md border border-slate-300 px-2 py-2 text-sm md:col-span-3"
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

                  <select
                    className="w-full rounded-md border border-slate-300 px-2 py-2 text-sm md:col-span-2"
                    defaultValue={normalizeRacePickFormat(race.pick_format)}
                    name="pick_format"
                  >
                    <option value="standard">Standard rules</option>
                    <option value="indy_500">Indianapolis 500 rules</option>
                  </select>

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

                    <form action={deleteRaceAction}>
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
                  </div>
                </div>
              </details>
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

        <div className="mt-5 grid gap-2 text-sm md:grid-cols-4">
          {["Qualifying setup", "Bulk preview", "Publish results", "Audit"].map((step, index) => (
            <div key={step} className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Step {index + 1}
              </p>
              <p className="mt-0.5 font-semibold text-slate-900">{step}</p>
            </div>
          ))}
        </div>

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
            <p className="text-xs text-slate-600">
              For Indy 500 races only: paste the 33-car qualifying order to create 8 pick groups.
            </p>
            <div className="mt-3 grid gap-3 md:grid-cols-4">
              <label className="block md:col-span-1">
                <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">
                  Indy 500 race
                </span>
                <select
                  required
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  data-testid="admin-indy-qualifying-race-select"
                  name="race_id"
                >
                  <option value="">
                    {activeIndy500Races.length > 0 ? "Select race" : "No active Indy 500 races"}
                  </option>
                  {activeIndy500Races.map((race) => (
                    <option key={race.id} value={String(race.id)}>
                      R{race.round_number} · {race.race_name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block md:col-span-3">
                <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">
                  Qualifying order paste
                </span>
                <textarea
                  required
                  className="h-32 w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-xs"
                  data-testid="admin-indy-qualifying-paste"
                  name="qualifying_order_paste"
                  placeholder={"1\t10\tAlex Palou\n2\t5\tPato O'Ward\n3\t2\tJosef Newgarden"}
                />
              </label>
            </div>
            <button
              className="mt-3 rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700"
              data-testid="admin-indy-qualifying-submit"
              type="submit"
            >
              Import qualifying order
            </button>
          </form>
        </details>

        <AdminResultsImportForm
          action={importIndycarResultsAction}
          activeRaces={currentSeasonRaces.map((race) => ({
            id: race.id,
            pickFormat: normalizeRacePickFormat(race.pick_format),
            raceName: race.race_name
          }))}
          drivers={drivers.map((driver) => ({
            driverName: driver.driver_name,
            groupNumber: driver.group_number,
            id: driver.id,
            isActive: driver.is_active
          }))}
          participants={winnerProfiles.map((winnerProfile) => ({
            id: winnerProfile.id,
            teamName: winnerProfile.team_name
          }))}
          picks={pickRows}
          raceDriverGroups={raceDriverGroups}
        />

        <details
          className="mt-5 rounded-lg border border-slate-200 bg-slate-50"
          data-testid="admin-scoring-audit"
        >
          <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-slate-900">
            <span className="inline-flex w-full flex-wrap items-center justify-between gap-3 align-middle">
              <span>Scoring Audit</span>
            <span className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700">
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
                  className="rounded-md border border-slate-200 bg-white"
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
                      <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                        <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                          Results
                        </dt>
                        <dd className="mt-0.5 font-semibold text-slate-900">
                          {audit.resultCount} rows
                        </dd>
                      </div>
                      <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                        <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                          Picks
                        </dt>
                        <dd className="mt-0.5 font-semibold text-slate-900">
                          {audit.submittedPickCount} submitted / {audit.noPickCount} fallback
                        </dd>
                      </div>
                      <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                        <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                          Range
                        </dt>
                        <dd className="mt-0.5 font-semibold text-slate-900">
                          {audit.lowestPossibleScore}-{audit.highestPossibleScore}
                        </dd>
                      </div>
                      <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
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
                        <thead className="bg-slate-50 text-slate-700">
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

        <details className="mt-5 rounded-md border border-slate-200 bg-white">
          <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-slate-900">
            Manual result entry
          </summary>
          <form
            action={upsertResultAction}
            className="grid gap-3 border-t border-slate-200 p-4 md:grid-cols-4"
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
                Save draft result
              </button>
            </div>
          </form>

          <form
            action={publishSavedRaceResultsAction}
            className="grid gap-3 border-t border-slate-200 bg-emerald-50/50 p-4 md:grid-cols-3"
          >
            <input name="tab" type="hidden" value="results" />
            <label className="block">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">
                Complete draft race
              </span>
              <select
                required
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                name="race_id"
              >
                <option value="">Select race</option>
                {currentSeasonRaces.map((race) => (
                  <option key={`publish-draft-${race.id}`} value={String(race.id)}>
                    R{race.round_number} · {race.race_name}
                    {race.results_status === "published" ? " (published correction)" : " (draft)"}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">
                Official winning average speed
              </span>
              <input
                required
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                min={0.001}
                name="official_winning_average_speed"
                step={0.001}
                type="number"
              />
            </label>
            <div className="flex items-end">
              <button
                className="w-full rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700"
                type="submit"
              >
                Publish complete draft
              </button>
            </div>
            <p className="text-xs text-slate-600 md:col-span-3">
              Manual publication requires one saved row per snapshotted driver; enter 0 for
              nonstarters. Bulk import adds those zero rows automatically.
            </p>
          </form>
        </details>

        <section className="mt-5 rounded-md border border-cyan-200 bg-cyan-50 p-4">
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
                  Apply supabase/migrations/20260717_add_hall_of_fame.sql before using this control.
                </p>
              ) : null}
            </div>
            <form action={finalizeHallOfFameSeasonAction}>
              <input name="tab" type="hidden" value="results" />
              <input name="season_id" type="hidden" value={String(activeSeason?.id ?? "")} />
              <ConfirmSubmitButton
                className="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
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
        </section>

        <details className="mt-5 rounded-md border border-slate-200 bg-white">
          <summary className="cursor-pointer px-3 py-3 text-sm font-semibold text-slate-900">
            Saved result rows ({sortedResults.length})
          </summary>
          <div className="max-h-96 overflow-auto border-t border-slate-200">
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
        </details>
        </section>
      ) : null}

      {activeTab === "feedback" ? (
        <section className="mt-6 rounded-lg border border-slate-200 bg-white p-6">
          <h2 className="text-xl font-semibold text-slate-900">Participant Feedback</h2>
          <p className="mt-2 text-sm text-slate-600">
            Bug reports and improvement ideas submitted by participants.
          </p>
          <p className="mt-1 text-xs text-slate-500">Times shown in {LEAGUE_TIME_ZONE}.</p>

          <div className="mt-5 grid gap-3">
            {feedbackItems.length === 0 ? (
              <p className="rounded-md border border-dashed border-slate-300 bg-slate-50 px-3 py-3 text-sm text-slate-600">
                No feedback submissions yet.
              </p>
            ) : (
              feedbackItems.map((item) => (
                <details key={item.id} className="rounded-md border border-slate-200 bg-white">
                  <summary className="cursor-pointer px-3 py-3">
                    <div className="inline-flex w-full flex-wrap items-center justify-between gap-3 align-middle">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-slate-900">
                          {teamNameByProfileId.get(item.user_id) ?? `User ${item.user_id}`}
                        </p>
                        <p className="mt-0.5 text-xs text-slate-500">
                          {formatDateTime(item.created_at)} · {feedbackCategoryLabel(item.category)}
                        </p>
                      </div>
                      <span
                        className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${
                          item.feedback_type === "bug"
                            ? "border-red-200 bg-red-50 text-red-700"
                            : "border-cyan-200 bg-cyan-50 text-cyan-800"
                        }`}
                      >
                        {feedbackTypeLabel(item.feedback_type)}
                      </span>
                    </div>
                  </summary>
                  <div className="border-t border-slate-200 px-3 py-3 text-sm text-slate-700">
                    <p>{item.details}</p>
                  </div>
                </details>
              ))
            )}
          </div>

          <details className="mt-5 rounded-md border border-amber-200 bg-amber-50">
            <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-amber-900">
              Advanced maintenance
            </summary>
            <form action={cleanupTestFlowDataAction} className="border-t border-amber-200 p-4">
              <input name="tab" type="hidden" value="feedback" />
              <ConfirmSubmitButton
                className="rounded-md border border-amber-300 bg-white px-3 py-2 text-sm font-semibold text-amber-800 hover:bg-amber-50"
                confirmMessage="Delete all [TEST FLOW ...] seeded races, test users, and test feedback?"
                data-testid="admin-feedback-cleanup-test-data"
                formNoValidate
                type="submit"
              >
                Cleanup test flow data
              </ConfirmSubmitButton>
            </form>
          </details>
        </section>
      ) : null}
    </AuthenticatedPageShell>
  );
}
