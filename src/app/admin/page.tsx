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
  retryFailedPickRemindersAction,
  setLeagueSeasonInviteCodeAction,
  setLeagueSeasonRulesDocumentAction,
  setRaceArchivedAction,
  setRacePickWindowAction,
  setRaceWinnerAction,
  updateRaceAction,
  updateDriverAction,
  updateFeedbackStatusAction,
  upsertResultAction
} from "@/app/admin/actions";
import {
  AdminParticipantsWorkspace,
  type AdminParticipantRow
} from "@/components/admin-participants-workspace";
import { AuthenticatedPageShell } from "@/components/authenticated-page-shell";
import {
  AdminWorkspaceNav,
  type AdminWorkspaceTab
} from "@/components/admin-workspace-nav";
import { AdminResultsImportForm } from "@/components/admin-results-import-form";
import {
  AdminSystemHealth,
  type AdminAuditHealthRow,
  type AdminJobRunHealthRow,
  type AdminReminderQueueHealth,
  type AdminReminderHealthRow
} from "@/components/admin-system-health";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { SeasonRecoveryCenter } from "@/components/season-recovery-center";
import { SubmitButton } from "@/components/submit-button";
import {
  ActionLink,
  AdminWorkspaceHeader,
  CompactNotice,
  Disclosure,
  EmptyState,
  FormField,
  StatusChip,
  actionControlClassName,
  fieldControlClassName
} from "@/components/ui-primitives";
import { requireAdmin } from "@/lib/admin";
import { feedbackCategoryLabel, feedbackTypeLabel } from "@/lib/feedback";
import { getPreviousRaceResultsGate } from "@/lib/pickem-results-gate";
import {
  nextPickWindow,
  pickWindowDisplayName,
  pickWindowRoundLabel
} from "@/lib/pick-windows";
import { queryStringParam } from "@/lib/query";
import {
  computeGroupScoreExtremes,
  pickDriverEntries,
  scorePickSelection
} from "@/lib/scoring-engine";
import {
  normalizeRacePickFormat,
  pickGroupCountForFormat,
  pickLockAtForRace,
  type RacePickFormat
} from "@/lib/race-format";
import {
  summarizeReminderQueue,
  type ReminderQueueRow
} from "@/lib/reminder-queue";
import { getReminderWindow } from "@/lib/reminder-windows";
import { loadAllRows } from "@/lib/supabase/paginated-query";
import {
  formatLeagueDateTime,
  formatLeagueDateTimeLocalInput,
  LEAGUE_TIME_ZONE
} from "@/lib/timezone";
import { assignWeeklyRanks, calculateOfficialSpeedDelta } from "@/lib/weekly-ranking";
import type { SeasonRestorePointSummary } from "@/lib/season-recovery";

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
  field_frozen_at: string | null;
  id: number;
  is_archived: boolean;
  official_winning_average_speed: number | string | null;
  pick_format: RacePickFormat;
  pick_window_key: string;
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

type SeasonParticipantRow = {
  profile_id: string;
  status: "declined" | "registered";
};

type LeagueSeasonRow = {
  activated_at: string | null;
  completed_at: string | null;
  display_name: string;
  id: number;
  registration_code_configured_at: string | null;
  roster_configured_at: string | null;
  rules_document_url: string | null;
  season_year: number;
  status: "active" | "completed" | "upcoming";
};

type ParticipantPickCountRow = {
  race_id: number;
  user_id: string;
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
  resolved_at: string | null;
  status: "in_review" | "new" | "resolved";
  user_id: string;
};

type HealthRaceRow = {
  id: number;
  pick_format: RacePickFormat;
  pick_window_key: string;
  qualifying_start_at: string;
  race_date: string;
  race_name: string;
  results_status: "draft" | "published";
  round_number: number;
  season_id: number;
};

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

type AdminTab = AdminWorkspaceTab;

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
    value === "feedback" ||
    value === "health" ||
    value === "recovery"
  ) {
    return value;
  }

  return "drivers";
};

const parsePositiveQueryInteger = (value: string | undefined): number | null => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
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

const ADMIN_RACE_FIELDS =
  "id,race_name,pick_format,pick_window_key,title_image_url,qualifying_start_at,race_date,payout,official_winning_average_speed,results_status,results_published_at,is_archived,archived_at,winner_profile_id,winner_source,winner_is_manual_override,winner_auto_eligible_at,winner_set_at,season_id,round_number,field_frozen_at";

const loadAdminRaces = async (supabase: SupabaseClient, seasonId: number) =>
  supabase
    .from("races")
    .select(ADMIN_RACE_FIELDS)
    .eq("season_id", seasonId)
    .order("race_date", { ascending: false });

const loadAdminFeedback = (
  supabase: SupabaseClient,
  status: string,
  page: number,
  pageSize: number
) => {
  let query = supabase
    .from("feedback_items")
    .select(
      "id,user_id,feedback_type,category,details,status,resolved_at,created_at",
      { count: "exact" }
    )
    .order("created_at", { ascending: false })
    .order("id", { ascending: false });

  if (status !== "all") {
    query = query.eq("status", status);
  }

  const from = (page - 1) * pageSize;
  return query.range(from, from + pageSize - 1);
};

const loadAdminResultRaces = async (
  supabase: SupabaseClient,
  seasonId: number
) =>
  supabase
    .from("races")
    .select(ADMIN_RACE_FIELDS)
    .eq("season_id", seasonId)
    .eq("is_archived", false)
    .order("round_number", { ascending: true })
    .order("id", { ascending: true });

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

const loadRaceDriverGroups = async (supabase: SupabaseClient, raceIds: number[]) =>
  paginatedAdminLoad<RaceDriverGroupRow>("race driver groups", (from, to) =>
    supabase
      .from("race_driver_groups")
      .select("race_id,driver_id,group_number,qualifying_position")
      .in("race_id", raceIds)
      .order("race_id", { ascending: true })
      .order("driver_id", { ascending: true })
      .range(from, to)
  );

const loadAdminPicks = async (supabase: SupabaseClient, raceIds: number[]) =>
  paginatedAdminLoad<PickSummaryRow>("admin picks", (from, to) =>
    supabase
      .from("picks")
      .select(
        "user_id,race_id,average_speed,driver_group1_id,driver_group2_id,driver_group3_id,driver_group4_id,driver_group5_id,driver_group6_id,driver_group7_id,driver_group8_id"
      )
      .in("race_id", raceIds)
      .order("race_id", { ascending: true })
      .order("user_id", { ascending: true })
      .range(from, to)
  );

const keyForRaceDriver = (raceId: number, driverId: number): string => `${raceId}:${driverId}`;
const keyForRaceUser = (raceId: number, userId: string): string => `${raceId}:${userId}`;

const pickDriverIdsForGroupCount = (
  pick: PickSummaryRow | null,
  groupCount: number
): Array<number | null> => {
  const byGroup = new Map(
    (pick ? pickDriverEntries(pick) : []).map(([driverId, groupNumber]) => [groupNumber, driverId])
  );
  return Array.from({ length: groupCount }, (_, index) => byGroup.get(index + 1) ?? null);
};

const buildPickedDriverGroupByRaceDriver = (picks: PickSummaryRow[]): Map<string, number> => {
  const pickedDriverGroupByRaceDriver = new Map<string, number>();

  picks.forEach((pick) => {
    pickDriverEntries(pick).forEach(([driverId, groupNumber]) => {
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
  return computeGroupScoreExtremes(
    groupCount,
    results,
    (result) =>
      resolveRaceDriverGroup(
        raceId,
        result.driver_id,
        raceDriverGroupByRaceDriver,
        pickedDriverGroupByRaceDriver,
        currentDriverGroupById
      ),
    (result) => result.points
  );
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
            ? scorePickSelection(pick, groupCount, (driverId) =>
                resultPointsByRaceDriver.get(keyForRaceDriver(race.id, driverId))
              )
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
  const requestedRaceSeasonId = parsePositiveQueryInteger(
    queryStringParam(params.race_season_id)
  );
  const requestedResultRaceId = parsePositiveQueryInteger(
    queryStringParam(params.result_race_id)
  );
  const participantQuery = (queryStringParam(params.participant_q) ?? "").trim();
  const participantStatus = queryStringParam(params.participant_status) ?? "all";
  const feedbackStatusInput = queryStringParam(params.feedback_status) ?? "all";
  const feedbackStatus = ["all", "new", "in_review", "resolved"].includes(
    feedbackStatusInput
  )
    ? feedbackStatusInput
    : "all";
  const feedbackPage = parsePositiveQueryInteger(queryStringParam(params.feedback_page)) ?? 1;
  const feedbackPageSize = 20;

  const { profile, supabase } = await requireAdmin();

  const seasonsResponse = await supabase
    .from("league_seasons")
    .select(
      "id,season_year,display_name,status,activated_at,completed_at,registration_code_configured_at,roster_configured_at,rules_document_url"
    )
    .order("season_year", { ascending: false });
  const loadedSeasons = (seasonsResponse.data ?? []) as LeagueSeasonRow[];
  const loadedActiveSeason = loadedSeasons.find((season) => season.status === "active") ?? null;
  const selectedRaceSeason =
    loadedSeasons.find((season) => season.id === requestedRaceSeasonId) ??
    loadedActiveSeason ??
    loadedSeasons[0] ??
    null;
  const emptyResponse = { data: [], error: null };
  const emptyCountResponse = { count: 0, data: [], error: null };

  const [
    driversResponse,
    racesResponse,
    profilesResponse,
    feedbackResponse,
    seasonParticipantsResponse,
    participantPicksResponse,
    restorePointsResponse
  ] = await Promise.all([
    activeTab === "drivers" || activeTab === "results" ? supabase
      .from("drivers")
      .select("id,driver_name,image_url,current_standing,group_number,is_active,championship_points")
      .order("current_standing", { ascending: true }) : emptyResponse,
    activeTab === "races" && selectedRaceSeason
      ? loadAdminRaces(supabase, selectedRaceSeason.id)
      : activeTab === "results" && loadedActiveSeason
        ? loadAdminResultRaces(supabase, loadedActiveSeason.id)
        : emptyResponse,
    activeTab === "participants" || activeTab === "races" || activeTab === "results" || activeTab === "feedback" ? supabase
      .from("profiles")
      .select("id,full_name,team_name,role,is_active")
      .in("role", ["participant", "admin"])
      .order("team_name", { ascending: true }) : emptyResponse,
    activeTab === "feedback"
      ? loadAdminFeedback(supabase, feedbackStatus, feedbackPage, feedbackPageSize)
      : emptyCountResponse,
    loadedActiveSeason && (activeTab === "participants" || activeTab === "races" || activeTab === "results" || activeTab === "health")
      ? supabase
          .from("season_participants")
          .select("profile_id,status")
          .eq("season_id", loadedActiveSeason.id)
      : emptyResponse,
    loadedActiveSeason && activeTab === "participants"
      ? paginatedAdminLoad<ParticipantPickCountRow>("participant pick counts", (from, to) =>
          supabase
            .from("picks")
            .select("user_id,race_id,races!inner(season_id)")
            .eq("races.season_id", loadedActiveSeason.id)
            .order("race_id", { ascending: true })
            .order("user_id", { ascending: true })
            .range(from, to)
        )
      : emptyResponse,
    loadedActiveSeason && activeTab === "recovery"
      ? supabase
          .from("season_restore_points")
          .select(
            "id,season_id,season_year,label,source,schema_version,format_version,row_counts,checksum,created_at"
          )
          .eq("season_id", loadedActiveSeason.id)
          .order("created_at", { ascending: false })
          .limit(30)
      : emptyResponse
  ]);

  const loadedRaces = (racesResponse.data ?? []) as RaceRow[];
  const currentSeasonRaces = loadedRaces
    .filter((race) => race.season_id === loadedActiveSeason?.id && !race.is_archived)
    .sort((left, right) => left.round_number - right.round_number || left.id - right.id);
  const selectedResultRace =
    currentSeasonRaces.find((race) => race.id === requestedResultRaceId) ??
    currentSeasonRaces.find((race) => race.results_status !== "published") ??
    currentSeasonRaces.at(-1) ??
    null;
  const resultRaceIds = selectedResultRace ? [selectedResultRace.id] : [];
  const [resultsResponse, picksResponse, raceDriverGroupsResponse] =
    activeTab === "results" && resultRaceIds.length > 0
      ? await Promise.all([
          paginatedAdminLoad<ResultRow>("active-season race results", (from, to) =>
            supabase
              .from("results")
              .select("id,race_id,driver_id,points")
              .in("race_id", resultRaceIds)
              .order("race_id", { ascending: false })
              .order("points", { ascending: false })
              .order("id", { ascending: true })
              .range(from, to)
          ),
          loadAdminPicks(supabase, resultRaceIds),
          loadRaceDriverGroups(supabase, resultRaceIds)
        ])
      : [emptyResponse, emptyResponse, emptyResponse];

  const loadError =
    driversResponse.error?.message ??
    racesResponse.error?.message ??
    resultsResponse.error?.message ??
    profilesResponse.error?.message ??
    feedbackResponse.error?.message ??
    picksResponse.error?.message ??
    raceDriverGroupsResponse.error?.message ??
    seasonParticipantsResponse.error?.message ??
    participantPicksResponse.error?.message ??
    restorePointsResponse.error?.message ??
    seasonsResponse.error?.message;

  if (loadError) {
    throw new Error(`Admin data could not be loaded safely: ${loadError}`);
  }

  const drivers: DriverRow[] = (driversResponse.data ?? []) as DriverRow[];
  const races = loadedRaces;
  const results: ResultRow[] = (resultsResponse.data ?? []) as ResultRow[];
  const winnerProfiles: WinnerProfileRow[] = (profilesResponse.data ?? []) as WinnerProfileRow[];
  const seasonParticipants = (seasonParticipantsResponse.data ?? []) as SeasonParticipantRow[];
  const registeredProfileIds = new Set(
    seasonParticipants
      .filter((participant) => participant.status === "registered")
      .map((participant) => participant.profile_id)
  );
  const participantPickCounts = new Map<string, number>();
  ((participantPicksResponse.data ?? []) as ParticipantPickCountRow[]).forEach((pick) => {
    participantPickCounts.set(
      pick.user_id,
      (participantPickCounts.get(pick.user_id) ?? 0) + 1
    );
  });
  const activeParticipants = winnerProfiles.filter((participant) =>
    participant.is_active && registeredProfileIds.has(participant.id)
  );
  const adminParticipantRows: AdminParticipantRow[] = winnerProfiles.map((participant) => ({
    fullName: participant.full_name,
    id: participant.id,
    isActive: participant.is_active,
    pickCount: participantPickCounts.get(participant.id) ?? 0,
    registered: registeredProfileIds.has(participant.id),
    role: participant.role,
    teamName: participant.team_name
  }));
  const seasons = loadedSeasons;
  const activeSeason = loadedActiveSeason;
  const feedbackItems: FeedbackItemRow[] = (feedbackResponse.data ?? []) as FeedbackItemRow[];
  const feedbackCount = feedbackResponse.count ?? 0;
  const feedbackPageCount = Math.max(1, Math.ceil(feedbackCount / feedbackPageSize));
  const feedbackPageHref = (page: number): string => {
    const nextParams = new URLSearchParams({
      feedback_page: String(Math.max(1, page)),
      feedback_status: feedbackStatus,
      tab: "feedback"
    });
    return `/admin?${nextParams.toString()}`;
  };
  const restorePoints = (restorePointsResponse.data ?? []) as SeasonRestorePointSummary[];
  const pickRows: PickSummaryRow[] = (picksResponse.data ?? []) as PickSummaryRow[];
  const raceDriverGroups: RaceDriverGroupRow[] = (
    raceDriverGroupsResponse.data ?? []
  ) as RaceDriverGroupRow[];
  const activeIndy500Races =
    selectedResultRace &&
    normalizeRacePickFormat(selectedResultRace.pick_format) === "indy_500"
      ? [selectedResultRace]
      : [];
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
  const hallOfFameSeasonResponse = activeSeason && activeTab === "results"
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
    races: selectedResultRace ? [selectedResultRace] : [],
    results
  });

  const driverNameById = new Map(drivers.map((driver) => [driver.id, driver.driver_name]));
  const teamNameByProfileId = new Map(winnerProfiles.map((profile) => [profile.id, profile.team_name]));
  const raceById = new Map(races.map((race) => [race.id, race]));
  const racesByPickWindow = new Map<string, RaceRow[]>();
  races.forEach((race) => {
    const windowRaces = racesByPickWindow.get(race.pick_window_key) ?? [];
    windowRaces.push(race);
    racesByPickWindow.set(race.pick_window_key, windowRaces);
  });
  const pickWindowPartnerByRaceId = new Map<number, RaceRow>();
  racesByPickWindow.forEach((windowRaces) => {
    if (windowRaces.length !== 2) {
      return;
    }
    pickWindowPartnerByRaceId.set(windowRaces[0].id, windowRaces[1]);
    pickWindowPartnerByRaceId.set(windowRaces[1].id, windowRaces[0]);
  });
  const seasonById = new Map(seasons.map((season) => [season.id, season]));

  const sortedResults = [...results].sort(
    (left, right) => right.points - left.points || left.id - right.id
  );

  let healthNextRace: HealthRaceRow | null = null;
  let healthNextRaces: HealthRaceRow[] = [];
  let healthPickCount = 0;
  let healthPreviousResultsStatus = "No upcoming race is scheduled.";
  let healthSchemaVersion: string | null = null;
  let healthReminderRows: AdminReminderHealthRow[] = [];
  let healthReminderQueue: AdminReminderQueueHealth | null = null;
  let healthJobRuns: AdminJobRunHealthRow[] = [];
  let healthAuditRows: AdminAuditHealthRow[] = [];
  let healthContract: {
    healthy: boolean;
    missing: string[];
    version: string;
  } | null = null;

  if (activeTab === "health") {
    const [
      metadataResponse,
      reminderResponse,
      nextRaceResponse,
      jobRunsResponse,
      auditResponse,
      healthContractResponse
    ] = await Promise.all([
      supabase.from("app_metadata").select("value").eq("key", "schema_version").maybeSingle(),
      supabase
        .from("pick_reminders")
        .select("delivery_status,reminder_type,attempt_count,last_error,updated_at")
        .order("updated_at", { ascending: false })
        .limit(10),
      activeSeason
        ? supabase
            .from("races")
            .select(
              "id,race_name,pick_format,pick_window_key,qualifying_start_at,race_date,results_status,season_id,round_number"
            )
            .eq("season_id", activeSeason.id)
            .eq("is_archived", false)
            .order("round_number", { ascending: true })
            .returns<HealthRaceRow[]>()
        : Promise.resolve({ data: [], error: null })
      ,
      supabase
        .from("job_runs")
        .select("job_name,status,summary,error_message,started_at,completed_at")
        .order("started_at", { ascending: false })
        .limit(32),
      supabase
        .from("admin_audit_events")
        .select("action,entity_type,summary,created_at")
        .order("created_at", { ascending: false })
        .limit(8),
      supabase.rpc("get_app_health_contract")
    ]);

    if (
      metadataResponse.error ||
      reminderResponse.error ||
      nextRaceResponse.error ||
      jobRunsResponse.error ||
      auditResponse.error ||
      healthContractResponse.error
    ) {
      throw new Error(
        metadataResponse.error?.message ??
          reminderResponse.error?.message ??
          nextRaceResponse.error?.message ??
          jobRunsResponse.error?.message ??
          auditResponse.error?.message ??
          healthContractResponse.error?.message ??
          "Failed loading system health."
      );
    }

    healthSchemaVersion = metadataResponse.data?.value ?? null;
    healthReminderRows = (reminderResponse.data ?? []) as AdminReminderHealthRow[];
    healthJobRuns = (jobRunsResponse.data ?? []) as AdminJobRunHealthRow[];
    healthAuditRows = (auditResponse.data ?? []) as AdminAuditHealthRow[];
    healthContract =
      healthContractResponse.data &&
      typeof healthContractResponse.data === "object" &&
      !Array.isArray(healthContractResponse.data)
        ? (healthContractResponse.data as {
            healthy: boolean;
            missing: string[];
            version: string;
          })
        : null;
    healthNextRaces = nextPickWindow(nextRaceResponse.data ?? [], new Date());
    healthNextRace = healthNextRaces[0] ?? null;

    if (healthNextRace) {
      const reminderWindow = getReminderWindow(
        Date.parse(pickLockAtForRace(healthNextRace)) - currentTime
      );
      const [{ count }, gate, queueResponse] = await Promise.all([
        supabase
          .from("picks")
          .select("id", { count: "exact", head: true })
          .in("race_id", healthNextRaces.map((race) => race.id)),
        getPreviousRaceResultsGate(supabase, healthNextRace),
        reminderWindow
          ? supabase
              .from("pick_reminders")
              .select(
                "id,user_id,channel,recipient,delivery_status,attempt_count,last_attempt_at,lease_expires_at"
              )
              .eq("race_id", healthNextRace.id)
              .eq("reminder_type", reminderWindow.key)
          : Promise.resolve({ data: [], error: null })
      ]);
      if (queueResponse.error) {
        throw new Error(`Failed loading reminder queue health: ${queueResponse.error.message}`);
      }
      healthPickCount = count ?? 0;
      healthPreviousResultsStatus =
        gate.status === "ready" ? "Ready: previous results are published." : gate.shortMessage;
      if (reminderWindow) {
        const queueRows = (queueResponse.data ?? []) as ReminderQueueRow[];
        const queueSummary = summarizeReminderQueue(queueRows);
        healthReminderQueue = {
          pending: queueSummary.pending,
          permanentFailed: queueSummary.permanentFailed,
          raceId: healthNextRace.id,
          raceName: pickWindowDisplayName(
            healthNextRaces,
            healthNextRace.race_name
          ),
          reminderType: reminderWindow.key,
          retrying: queueSummary.retrying,
          sent: queueSummary.sent
        };
      }
    }
  }

  return (
    <AuthenticatedPageShell
      actions={
        <ActionLink href="/dashboard" variant="secondary">
          Back to dashboard
        </ActionLink>
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
        <CompactNotice className="mt-6" tone="danger">
          {error}
        </CompactNotice>
      ) : null}

      {message ? (
        <CompactNotice
          className="mt-6"
          data-testid={activeTab === "results" ? "admin-results-save-alert" : undefined}
          tone="success"
        >
          {message}
        </CompactNotice>
      ) : null}

      {loadError ? (
        <CompactNotice className="mt-6" tone="danger">
          Failed to load admin data: {loadError}
        </CompactNotice>
      ) : null}

      <AdminWorkspaceNav activeTab={activeTab} />

      {activeTab === "health" ? (
        <AdminSystemHealth
          activeSeasonName={activeSeason?.display_name ?? null}
          auditRows={healthAuditRows}
          cleanupTestFlowDataAction={cleanupTestFlowDataAction}
          emailEnabled={process.env.PICK_EMAILS_ENABLED?.toLowerCase() === "true"}
          healthContract={healthContract}
          jobRuns={healthJobRuns}
          nextRace={healthNextRace ? {
            expectedPickCount: registeredProfileIds.size * healthNextRaces.length,
            pickCount: healthPickCount,
            previousResultsStatus: healthPreviousResultsStatus,
            raceName: pickWindowDisplayName(healthNextRaces, healthNextRace.race_name),
            roundLabel: pickWindowRoundLabel(healthNextRaces),
            roundNumber: healthNextRace.round_number
          } : null}
          registeredTeamCount={registeredProfileIds.size}
          reminderQueue={healthReminderQueue}
          reminderRows={healthReminderRows}
          retryFailedRemindersAction={retryFailedPickRemindersAction}
          schemaVersion={healthSchemaVersion}
          smsEnabled={process.env.REMINDER_SMS_ENABLED?.toLowerCase() === "true"}
        />
      ) : null}

      {activeTab === "recovery" ? (
        <SeasonRecoveryCenter
          activeSeason={
            activeSeason
              ? { id: activeSeason.id, seasonYear: activeSeason.season_year }
              : null
          }
          restorePoints={restorePoints}
        />
      ) : null}

      {activeTab === "participants" ? (
        <AdminParticipantsWorkspace
          activeSeasonYear={activeSeason?.season_year ?? null}
          initialQuery={participantQuery}
          initialStatus={participantStatus}
          participants={adminParticipantRows}
        />
      ) : null}

      {activeTab === "drivers" ? (
        <section className="mt-6 rounded-lg border border-slate-200 bg-white p-4 sm:p-6">
        <AdminWorkspaceHeader
          description="Opening order comes from the prior final standings. Published results update current points and groups."
          title="Drivers"
        />

        <Disclosure
          className="mt-5 bg-slate-50"
          description="Import the prior championship order before the first published race."
          summary="Preseason seed tools"
        >
          <form
            action={importChampionshipStandingsAction}
            data-testid="admin-standings-import-form"
          >
            <input name="tab" type="hidden" value="drivers" />
            <h3 className="text-sm font-semibold text-slate-900">Import Opening Seed</h3>
            <p className="mt-1 text-xs text-slate-600">
              Use before the first published race. The importer maps Rank and Driver, while the new
              season starts every driver at 0 points.
            </p>
            <label className="mt-3 block max-w-xs">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">
                Season being prepared
              </span>
              <select
                required
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                defaultValue={
                  seasons.find((season) => season.status === "upcoming")?.id ??
                  activeSeason?.id ??
                  ""
                }
                name="season_id"
              >
                <option value="">Select season</option>
                {seasons
                  .filter((season) => season.status !== "completed")
                  .map((season) => (
                    <option key={`roster-season-${season.id}`} value={season.id}>
                      {season.season_year} ({season.status})
                    </option>
                  ))}
              </select>
            </label>
            <textarea
              required
              className="mt-3 h-36 w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-xs"
              data-testid="admin-standings-import-input"
              name="standings_paste"
              placeholder={"1\tAlex Palou\tHonda\t711\t0\t17\t8\t6\t14\t15\t778"}
            />
            <SubmitButton
              className="mt-3 rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700"
              data-testid="admin-standings-import-submit"
              pendingLabel="Synchronizing..."
            >
              Import opening seed
            </SubmitButton>
          </form>
        </Disclosure>

        <form
          action={createDriverAction}
          className="mt-5 grid gap-3 rounded-md border border-slate-200 bg-slate-50 p-4 md:grid-cols-5"
          data-testid="admin-driver-create-form"
        >
          <input name="tab" type="hidden" value="drivers" />
          <FormField className="md:col-span-3" label="Driver name">
            <input
              required
              className={fieldControlClassName()}
              data-testid="admin-driver-create-name"
              maxLength={100}
              name="driver_name"
              type="text"
            />
          </FormField>

          <FormField className="md:col-span-2" label="Driver image">
            <input
              accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
              className={fieldControlClassName("text-xs")}
              data-testid="admin-driver-create-image-file"
              name="image_file"
              type="file"
            />
          </FormField>

          <Disclosure
            className="md:col-span-5"
            description="Use a direct URL only when an image file cannot be uploaded."
            summary="Advanced image option"
          >
            <FormField label="Image URL fallback">
              <input
                className={fieldControlClassName()}
                data-testid="admin-driver-create-image-url"
                name="image_url"
                type="url"
              />
            </FormField>
          </Disclosure>

          <div className="md:col-span-5 flex items-end justify-between gap-3">
            <label className="inline-flex items-center gap-2 text-sm text-slate-700">
              <input defaultChecked name="is_active" type="checkbox" />
              Active
            </label>
            <SubmitButton
              className={actionControlClassName("primary")}
              data-testid="admin-driver-create-submit"
              pendingLabel="Adding..."
            >
              Add driver
            </SubmitButton>
          </div>
        </form>
        <p className="mt-2 text-xs text-slate-600">
          Manually added drivers start at 0 championship points and are auto-ranked to the bottom
          on refresh.
        </p>

        <div className="mt-5 grid gap-3">
          {drivers.length === 0 ? (
            <EmptyState
              description="Add the first driver above or import the preseason opening seed."
              title="No drivers yet"
            />
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
                    <StatusChip tone={driver.is_active ? "success" : "neutral"}>
                      {driver.is_active ? "Active" : "Inactive"}
                    </StatusChip>
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

                    <FormField className="md:col-span-3" label="Driver name">
                      <input
                        required
                        className={fieldControlClassName("px-2 py-2")}
                        defaultValue={driver.driver_name}
                        maxLength={100}
                        name="driver_name"
                        type="text"
                      />
                    </FormField>

                    <FormField className="md:col-span-2" label="Replace image">
                      <input
                        accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
                        className={fieldControlClassName("px-2 py-2 text-xs")}
                        name="image_file"
                        type="file"
                      />
                    </FormField>

                    <FormField className="md:col-span-3" label="Image URL fallback">
                      <input
                        className={fieldControlClassName("px-2 py-2")}
                        defaultValue={driver.image_url ?? ""}
                        name="image_url"
                        type="url"
                      />
                    </FormField>

                    <label className="inline-flex min-h-11 items-center gap-2 self-end text-sm text-slate-700 md:col-span-1">
                      <input defaultChecked={driver.is_active} name="is_active" type="checkbox" />
                      Active
                    </label>

                    <SubmitButton
                      className={actionControlClassName("primary", "w-full self-end px-2 py-2 md:col-span-1")}
                      data-testid={`admin-driver-save-${driver.id}`}
                      pendingLabel="Saving..."
                    >
                      Save
                    </SubmitButton>
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
        <section className="mt-6 rounded-lg border border-slate-200 bg-white p-4 sm:p-6">
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
                  className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
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
                className="rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold"
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
                  className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-slate-200 bg-white px-3 py-2"
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
                            className="w-52 rounded-md border border-slate-300 px-2.5 py-2 text-xs"
                            defaultValue={season.rules_document_url ?? ""}
                            name="rules_document_url"
                            placeholder="/docs/2027-rules.pdf"
                            type="text"
                          />
                        </label>
                        <SubmitButton
                          className="rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-100"
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
                            className="w-44 rounded-md border border-slate-300 px-2.5 py-2 text-xs"
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
                            className="w-44 rounded-md border border-slate-300 px-2.5 py-2 text-xs"
                            maxLength={64}
                            minLength={8}
                            name="invite_code_confirmation"
                            type="text"
                          />
                        </label>
                        <SubmitButton
                          className="rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-100"
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
                          className="rounded-md bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-700 disabled:bg-slate-400"
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
                        className="rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-100"
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
                  className="w-36 rounded-md border border-slate-300 px-3 py-2 text-sm"
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
                  className="w-48 rounded-md border border-slate-300 px-3 py-2 text-sm"
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
                  className="w-48 rounded-md border border-slate-300 px-3 py-2 text-sm"
                  maxLength={64}
                  minLength={8}
                  name="invite_code_confirmation"
                  placeholder="Enter code again"
                  type="text"
                />
              </label>
              <SubmitButton
                className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-100"
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
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
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
              <SubmitButton
                className="w-full rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700"
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
                        Pick field
                      </dt>
                      <dd className="mt-0.5 font-medium text-slate-900">
                        {race.field_frozen_at ? "Frozen" : "Editable"}
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
                        <label className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900 md:col-span-6">
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
                          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
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
      ) : null}

      {activeTab === "results" ? (
        <section
          className="mt-6 rounded-lg border border-slate-200 bg-white p-4 sm:p-6"
          key={`results-workspace-${selectedResultRace?.id ?? "empty"}`}
        >
        <AdminWorkspaceHeader
          description="Select one race, validate its official results, then publish or correct that race."
          title="Race Results"
        />

        <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-3">
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
                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
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
              className="self-end rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700"
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
                      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                      : "border-amber-200 bg-amber-50 text-amber-800"
                  }`}
                >
                  {selectedResultRace.results_status === "published" ? "Published" : "Draft"}
                </span>
                <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 font-semibold text-slate-700">
                  {pickRows.length} picks
                </span>
                <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 font-semibold text-slate-700">
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
                  className="h-32 w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-xs"
                  data-testid="admin-indy-qualifying-paste"
                  name="qualifying_order_paste"
                  placeholder={"1\t10\tAlex Palou\n2\t5\tPato O'Ward\n3\t2\tJosef Newgarden"}
                />
              </label>
            </div>
            <SubmitButton
              className="mt-3 rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700"
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
            <input
              name="result_race_id"
              type="hidden"
              value={String(selectedResultRace?.id ?? "")}
            />
            <input name="race_id" type="hidden" value={String(selectedResultRace?.id ?? "")} />
            <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
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

            <label className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900 md:col-span-4">
              <input className="mt-0.5" name="confirm_results_correction" type="checkbox" />
              Check only when intentionally editing a published race. The race will return to
              draft until the complete corrected field is republished.
            </label>

            <div className="flex items-end">
              <SubmitButton
                className="w-full rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700"
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
            <div className="rounded-md border border-slate-200 bg-white px-3 py-2">
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
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                max={300}
                min={0.001}
                name="official_winning_average_speed"
                step={0.001}
                type="number"
              />
            </label>
            <div className="flex items-end">
              <SubmitButton
                className="w-full rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700"
                pendingLabel="Publishing..."
              >
                Publish complete draft
              </SubmitButton>
            </div>
            <label className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900 md:col-span-3">
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
                  Hall of Fame database setup is incomplete. Review System Health before using this control.
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
        </Disclosure>

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
        <section className="mt-6 rounded-lg border border-slate-200 bg-white p-4 sm:p-6">
          <AdminWorkspaceHeader
            description="Review participant bug reports and improvement ideas in manageable batches."
            meta={
              <span className="text-sm font-semibold text-slate-700">
                {feedbackCount} submission{feedbackCount === 1 ? "" : "s"}
              </span>
            }
            title="Participant Feedback"
          />

          <form
            action="/admin"
            className="mt-4 flex flex-col gap-2 border-y border-slate-200 py-3 sm:flex-row sm:items-end"
            method="get"
          >
            <input name="tab" type="hidden" value="feedback" />
            <label className="block sm:max-w-56">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">
                Status
              </span>
              <select
                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
                defaultValue={feedbackStatus}
                name="feedback_status"
              >
                <option value="all">All feedback</option>
                <option value="new">New</option>
                <option value="in_review">In review</option>
                <option value="resolved">Resolved</option>
              </select>
            </label>
            <button
              className="min-h-10 rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold"
              type="submit"
            >
              Apply
            </button>
          </form>

          <div className="mt-5 grid gap-3">
            {feedbackItems.length === 0 ? (
              <EmptyState
                description="Choose another status or check again after participants submit feedback."
                title="No matching feedback"
              />
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
                      <div className="flex items-center gap-2">
                        <StatusChip
                          tone={
                            item.status === "resolved"
                              ? "success"
                              : item.status === "in_review"
                                ? "warning"
                                : "info"
                          }
                        >
                          {item.status.replace("_", " ")}
                        </StatusChip>
                        <StatusChip tone={item.feedback_type === "bug" ? "danger" : "neutral"}>
                          {feedbackTypeLabel(item.feedback_type)}
                        </StatusChip>
                      </div>
                    </div>
                  </summary>
                  <div className="border-t border-slate-200 px-3 py-3 text-sm text-slate-700">
                    <p className="whitespace-pre-wrap">{item.details}</p>
                    <form
                      action={updateFeedbackStatusAction}
                      className="mt-4 flex flex-col gap-2 border-t border-slate-200 pt-3 sm:flex-row sm:items-end"
                    >
                      <input name="feedback_id" type="hidden" value={item.id} />
                      <input name="feedback_page" type="hidden" value={feedbackPage} />
                      <input name="feedback_status" type="hidden" value={feedbackStatus} />
                      <label className="block sm:max-w-48">
                        <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">
                          Workflow status
                        </span>
                        <select
                          className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
                          defaultValue={item.status}
                          name="status"
                        >
                          <option value="new">New</option>
                          <option value="in_review">In review</option>
                          <option value="resolved">Resolved</option>
                        </select>
                      </label>
                      <SubmitButton
                        className="min-h-10 rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold"
                        pendingLabel="Updating..."
                      >
                        Update status
                      </SubmitButton>
                      {item.resolved_at ? (
                        <span className="self-center text-xs text-slate-500">
                          Resolved {formatDateTime(item.resolved_at)}
                        </span>
                      ) : null}
                    </form>
                  </div>
                </details>
              ))
            )}
          </div>

          {feedbackPageCount > 1 ? (
            <nav
              aria-label="Feedback pages"
              className="mt-4 flex items-center justify-between gap-3 border-t border-slate-200 pt-4"
            >
              <Link
                aria-disabled={feedbackPage <= 1}
                className={`rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold ${
                  feedbackPage <= 1 ? "pointer-events-none opacity-50" : ""
                }`}
                href={feedbackPageHref(feedbackPage - 1)}
              >
                Previous
              </Link>
              <span className="text-sm text-slate-600">
                Page {Math.min(feedbackPage, feedbackPageCount)} of {feedbackPageCount}
              </span>
              <Link
                aria-disabled={feedbackPage >= feedbackPageCount}
                className={`rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold ${
                  feedbackPage >= feedbackPageCount ? "pointer-events-none opacity-50" : ""
                }`}
                href={feedbackPageHref(feedbackPage + 1)}
              >
                Next
              </Link>
            </nav>
          ) : null}

        </section>
      ) : null}
    </AuthenticatedPageShell>
  );
}
