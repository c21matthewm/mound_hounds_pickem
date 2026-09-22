import { parseAdminCapabilities } from "@/lib/admin-capabilities";
import { AdminSeasonsWorkspace, type AdminArchiveSummary } from "@/components/admin-seasons-workspace";
import { AdminRaceWeekWorkspace } from "@/components/admin-race-week-workspace";
import { AdminRemindersWorkspace } from "@/components/admin-reminders-workspace";
import { AdminMissingPicks } from "@/components/admin-missing-picks";
import { selectRaceWeekPhase, missingPickParticipants } from "@/lib/admin-race-week";
import { parseAdminAuditQuery, type AdminAuditLogData } from "@/lib/admin-audit-log";
import { loadAdminAuditLog } from "@/lib/admin-audit-log-data";
import { loadAdminAttention } from "@/lib/admin-attention";
import { loadAdminParticipantEmails } from "@/lib/admin-participant-emails";
import {
  cleanupTestFlowDataAction,
  resolveAppErrorAction,
  retryFailedPickRemindersAction
} from "@/app/admin/maintenance-actions";
import { sendPickReminderTestAction } from "@/app/admin/reminder-actions";
import {
  AdminParticipantsWorkspace,
  type AdminParticipantRow
} from "@/components/admin-participants-workspace";
import { AdminFeedbackWorkspace } from "@/components/admin-feedback-workspace";
import { AdminDriversWorkspace } from "@/components/admin-drivers-workspace";
import { AdminRacesWorkspace } from "@/components/admin-races-workspace";
import { AdminResultsWorkspace } from "@/components/admin-results-workspace";
import { AuthenticatedPageShell } from "@/components/authenticated-page-shell";
import { AdminWorkspaceNav } from "@/components/admin-workspace-nav";
import {
  AdminSystemHealth,
  type AdminAppErrorRow,
  type AdminJobRunHealthRow,
  type AdminReminderPreview,
  type AdminReminderQueueHealth,
  type AdminReminderHealthRow
} from "@/components/admin-system-health";
import { SeasonRecoveryCenter } from "@/components/season-recovery-center";
import { CompactNotice } from "@/components/ui-primitives";
import { requireAdmin } from "@/lib/admin";
import { createAdminRequestToken } from "@/lib/admin-request-token";
import { errorReference, reportAppError } from "@/lib/app-error-reporter";
import { buildPickReminderMessage } from "@/lib/pick-reminder-message";
import { getPreviousRaceResultsGate } from "@/lib/pickem-results-gate";
import {
  racesInPickWindow,
  pickWindowDisplayName,
  pickWindowRoundLabel
} from "@/lib/pick-windows";
import { queryStringParam } from "@/lib/query";
import { pickLockAtForRace } from "@/lib/race-format";
import {
  summarizeReminderQueue,
  type ReminderQueueRow
} from "@/lib/reminder-queue";
import {
  getReminderWindow,
  getReminderWindowByType,
  reminderScheduleForDeadline,
  type ReminderType
} from "@/lib/reminder-windows";
import type { SeasonRestorePointSummary } from "@/lib/season-recovery";
import { canonicalSiteOrigin } from "@/lib/site-url";

import type {
  DriverRow,
  FeedbackItemRow,
  HealthRaceRow,
  LeagueSeasonRow,
  PageProps,
  ParticipantPickCountRow,
  PickSummaryRow,
  RaceDriverGroupRow,
  RaceRow,
  ResultRow,
  SeasonParticipantRow,
  WinnerProfileRow
} from "@/app/admin/admin-types";

import {
  buildScoringAudits,
  loadAdminFeedback,
  loadAdminPicks,
  loadAdminRaces,
  loadAdminResultRaces,
  loadRaceDriverGroups,
  paginatedAdminLoad,
  parseAdminTab,
  parsePositiveQueryInteger
} from "@/app/admin/admin-data";
export default async function AdminPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const message = queryStringParam(params.message);
  const error = queryStringParam(params.error);
  const activeTab = parseAdminTab(queryStringParam(params.tab));
  const isRaceWeek = activeTab === "race-week" || activeTab === "results";
  const requestedRaceSeasonId = parsePositiveQueryInteger(
    queryStringParam(params.race_season_id)
  );
  const requestedRecoverySeasonId = parsePositiveQueryInteger(queryStringParam(params.recovery_season_id));
  const requestedResultRaceId = parsePositiveQueryInteger(
    queryStringParam(params.result_race_id)
  );
  const participantQuery = (queryStringParam(params.participant_q) ?? "").trim();
  const requestedParticipantSeasonId = parsePositiveQueryInteger(queryStringParam(params.participant_season_id));
  const participantStatus = queryStringParam(params.participant_status) ?? "all";
  const feedbackStatusInput = queryStringParam(params.feedback_status) ?? "all";
  const feedbackStatus = ["all", "new", "in_review", "resolved"].includes(
    feedbackStatusInput
  )
    ? feedbackStatusInput
    : "all";
  const feedbackPage = parsePositiveQueryInteger(queryStringParam(params.feedback_page)) ?? 1;
  const feedbackPageSize = 20;

  const { profile, supabase, user } = await requireAdmin();
  const currentTime = new Date().getTime();
  const throwAdminLoadError = async (
    code: string,
    loadFailure: unknown,
    operation: string
  ): Promise<never> => {
    const reported = await reportAppError({
      actorProfileId: user.id,
      code,
      context: { operation },
      error: loadFailure,
      route: `/admin?tab=${activeTab}`,
      subsystem: "admin"
    });
    throw new Error(`Admin data could not be loaded safely.${errorReference(reported)}`);
  };
  const recoveryRequestToken =
    activeTab === "recovery"
      ? createAdminRequestToken(user.id, "season-recovery")
      : "";

  const seasonsResponse = await supabase
    .from("league_seasons")
    .select(
      "id,season_year,display_name,status,activated_at,completed_at,registration_code_configured_at,roster_configured_at,rules_document_url"
    )
    .order("season_year", { ascending: false });
  const loadedSeasons = (seasonsResponse.data ?? []) as LeagueSeasonRow[];
  const loadedActiveSeason = loadedSeasons.find((season) => season.status === "active") ?? null;
  const participantSeasons = loadedSeasons.filter(season => season.status !== "completed");
  const selectedParticipantSeason = participantSeasons.find(season => season.id === requestedParticipantSeasonId)
    ?? loadedActiveSeason ?? participantSeasons[0] ?? null;
  const selectedRaceSeason =
    loadedSeasons.find((season) => season.id === requestedRaceSeasonId) ??
    loadedActiveSeason ??
    loadedSeasons[0] ??
    null;
  const selectedRecoverySeason = loadedSeasons.find(season => season.id === requestedRecoverySeasonId)
    ?? loadedActiveSeason ?? loadedSeasons.find(season => season.status === "completed") ?? loadedSeasons[0] ?? null;
  const emptyResponse = { data: [], error: null };
  const emptyCountResponse = { count: 0, data: [], error: null };

  const hasActiveCalendar = isRaceWeek || activeTab === "seasons" ||
    (activeTab === "races" && selectedRaceSeason?.id === loadedActiveSeason?.id);
  const [
    attention,
    driversResponse,
    racesResponse,
    profilesResponse,
    feedbackResponse,
    seasonParticipantsResponse,
    selectedParticipantsResponse,
    participantPicksResponse,
    restorePointsResponse
  ] = await Promise.all([
    loadAdminAttention(supabase, {seasonId:loadedActiveSeason?.id ?? null, now:currentTime,
      loadErrors:activeTab !== "health", loadRaces:!hasActiveCalendar}),
    activeTab === "drivers" || isRaceWeek ? supabase
      .from("drivers")
      .select("id,driver_name,image_url,current_standing,group_number,is_active,championship_points")
      .order("current_standing", { ascending: true }) : emptyResponse,
    activeTab === "races" && selectedRaceSeason
      ? loadAdminRaces(supabase, selectedRaceSeason.id)
      : (isRaceWeek || activeTab === "seasons") && loadedActiveSeason
        ? loadAdminResultRaces(supabase, loadedActiveSeason.id)
        : emptyResponse,
    activeTab === "participants" || activeTab === "races" || isRaceWeek || activeTab === "feedback"
      ? paginatedAdminLoad<WinnerProfileRow>("admin profiles", (from, to) => supabase.from("profiles")
        .select("id,full_name,team_name,role,is_active").in("role", ["participant", "admin"])
        .order("team_name", { ascending: true }).order("id", { ascending: true }).range(from, to).returns<WinnerProfileRow[]>())
      : emptyResponse,
    activeTab === "feedback"
      ? loadAdminFeedback(supabase, feedbackStatus, feedbackPage, feedbackPageSize)
      : emptyCountResponse,
    loadedActiveSeason && (activeTab === "participants" || isRaceWeek)
      ? paginatedAdminLoad<SeasonParticipantRow>("season participants", (from, to) => {
          let query = supabase.from("season_participants")
            .select(isRaceWeek ? "profile_id,status,profiles!inner(is_active)" : "profile_id,status")
            .eq("season_id", loadedActiveSeason.id).order("profile_id", {ascending: true});
          if (isRaceWeek) query = query.eq("profiles.is_active", true);
          return query.range(from, to).returns<SeasonParticipantRow[]>();
        })
      : emptyResponse,
    activeTab === "participants" && selectedParticipantSeason && selectedParticipantSeason.id !== loadedActiveSeason?.id
      ? paginatedAdminLoad<SeasonParticipantRow>("selected season participants", (from, to) => supabase
        .from("season_participants").select("profile_id,status").eq("season_id", selectedParticipantSeason.id)
        .order("profile_id", {ascending:true}).range(from, to).returns<SeasonParticipantRow[]>())
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
    selectedRecoverySeason && activeTab === "recovery"
      ? supabase
          .from("season_restore_points")
          .select(
            "id,season_id,season_year,label,source,retention_key,snapshot_bytes,schema_version,format_version,row_counts,checksum,created_at"
          )
          .eq("season_id", selectedRecoverySeason.id)
          .order("created_at", { ascending: false })
          .limit(1000)
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
  const raceWeekPhase = selectRaceWeekPhase(activeTab === "results" ? "results" : queryStringParam(params.phase), selectedResultRace, currentTime);
  const resultRaceIds = selectedResultRace ? [selectedResultRace.id] : [];
  const loadResults = isRaceWeek && raceWeekPhase === "results" && resultRaceIds.length > 0;
  const loadField = isRaceWeek && resultRaceIds.length > 0 &&
    (raceWeekPhase === "results" || (raceWeekPhase === "preparation" && selectedResultRace?.field_frozen_at));
  const [resultsResponse, picksResponse, raceDriverGroupsResponse] = await Promise.all([
    loadResults ? paginatedAdminLoad<ResultRow>("active-season race results", (from, to) =>
      supabase.from("results").select("id,race_id,driver_id,points")
        .in("race_id", resultRaceIds).order("race_id", { ascending: false })
        .order("points", { ascending: false }).order("id", { ascending: true })
        .range(from, to)
    ) : emptyResponse,
    loadResults ? loadAdminPicks(supabase, resultRaceIds) : emptyResponse,
    loadField ? loadRaceDriverGroups(supabase, resultRaceIds) : emptyResponse
  ]);

  const loadError =
    driversResponse.error?.message ??
    racesResponse.error?.message ??
    resultsResponse.error?.message ??
    profilesResponse.error?.message ??
    feedbackResponse.error?.message ??
    picksResponse.error?.message ??
    raceDriverGroupsResponse.error?.message ??
    seasonParticipantsResponse.error?.message ??
    selectedParticipantsResponse.error?.message ??
    participantPicksResponse.error?.message ??
    restorePointsResponse.error?.message ??
    seasonsResponse.error?.message;

  if (loadError) {
    await throwAdminLoadError("admin-workspace-load-failed", loadError, `load_${activeTab}`);
  }

  const drivers: DriverRow[] = (driversResponse.data ?? []) as DriverRow[];
  const races = loadedRaces;
  const results: ResultRow[] = (resultsResponse.data ?? []) as ResultRow[];
  const winnerProfiles: WinnerProfileRow[] = (profilesResponse.data ?? []) as WinnerProfileRow[];
  const seasonParticipants = (seasonParticipantsResponse.data ?? []) as SeasonParticipantRow[];
  const selectedSeasonDecisions = selectedParticipantSeason?.id === loadedActiveSeason?.id
    ? seasonParticipants : (selectedParticipantsResponse.data ?? []) as SeasonParticipantRow[];
  const selectedDecisionById = new Map(selectedSeasonDecisions.map(row => [row.profile_id, row.status]));
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
  const participantEmails = activeTab === "participants" || (isRaceWeek && raceWeekPhase === "picks")
    ? await loadAdminParticipantEmails(winnerProfiles.map(participant => participant.id))
    : {emailsByProfileId: new Map<string,string>(), warning: null};
  const adminParticipantRows: AdminParticipantRow[] = winnerProfiles.map((participant) => ({
    email: participantEmails.emailsByProfileId.get(participant.id) ?? null,
    fullName: participant.full_name,
    id: participant.id,
    isActive: participant.is_active,
    pickCount: participantPickCounts.get(participant.id) ?? 0,
    registered: registeredProfileIds.has(participant.id),
    enrollmentStatus: selectedDecisionById.get(participant.id) ?? null,
    role: participant.role,
    teamName: participant.team_name
  }));
  const seasons = loadedSeasons;
  const activeSeason = loadedActiveSeason;
  const feedbackItems: FeedbackItemRow[] = (feedbackResponse.data ?? []) as FeedbackItemRow[];
  const feedbackCount = feedbackResponse.count ?? 0;
  const feedbackPageCount = Math.max(1, Math.ceil(feedbackCount / feedbackPageSize));
  const restorePoints = (restorePointsResponse.data ?? []) as SeasonRestorePointSummary[];
  const pickRows: PickSummaryRow[] = (picksResponse.data ?? []) as PickSummaryRow[];
  const raceDriverGroups: RaceDriverGroupRow[] = (
    raceDriverGroupsResponse.data ?? []
  ) as RaceDriverGroupRow[];
  const unpublishedSeasonRaces = currentSeasonRaces.filter(
    (race) => race.results_status !== "published"
  );
  const finalSeasonRace = [...currentSeasonRaces]
    .sort((a, b) => Date.parse(a.race_date) - Date.parse(b.race_date))
    .at(-1);
  const canFinalizeSeason =
    currentSeasonRaces.length > 0 &&
    unpublishedSeasonRaces.length === 0 &&
    Boolean(finalSeasonRace && Date.parse(finalSeasonRace.race_date) <= currentTime);
  const archiveResponse = activeTab === "seasons"
    ? await supabase.from("hall_of_fame_seasons")
      .select("id,season_year,champion_team_name,champion_total_points,finalized_at,participant_count,race_count")
      .order("season_year", {ascending: false})
    : emptyResponse;
  if (archiveResponse.error) await throwAdminLoadError("admin-archive-load-failed", archiveResponse.error, "load_archives");
  const archives = (archiveResponse.data ?? []) as AdminArchiveSummary[];
  const activeArchive = archives.find(archive => archive.season_year === activeSeason?.season_year);
  const refreshableArchiveResponse = activeArchive
    ? await supabase.from("hall_of_fame_entries").select("id")
      .eq("season_id", activeArchive.id).neq("race_breakdown", "[]").limit(1)
    : emptyResponse;
  if (refreshableArchiveResponse.error) await throwAdminLoadError("admin-archive-source-load-failed", refreshableArchiveResponse.error, "load_archive_source");
  const canRefreshArchive = !activeArchive || Boolean(refreshableArchiveResponse.data?.length);
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
  let healthCapabilities = parseAdminCapabilities(null, true);
  let healthReminderRows: AdminReminderHealthRow[] = [];
  let healthReminderQueue: AdminReminderQueueHealth | null = null;
  let healthReminderPreview: AdminReminderPreview | null = null;
  let healthJobRuns: AdminJobRunHealthRow[] = [];
  let healthJobEvents: AdminJobRunHealthRow[] = [];
  let healthAuditLog: AdminAuditLogData | null = null;
  let healthAppErrors: AdminAppErrorRow[] = [];
  let healthAppErrorInboxReady = true;
  let healthAppErrorInboxIssue: string | null = null;
  let healthOpenAppErrorCount = 0;
  let healthContract: {
    healthy: boolean;
    missing: string[];
    version: string;
  } | null = null;

  if (activeTab === "health") {
    const [
      metadataResponse,
      reminderResponse,
      jobStatusResponse,
      jobEventsResponse,
      auditResponse,
      healthContractResponse,
      capabilityResponse,
      appErrorsResponse
    ] = await Promise.all([
      supabase.from("app_metadata").select("value").eq("key", "schema_version").maybeSingle(),
      supabase
        .from("pick_reminders")
        .select("delivery_status,reminder_type,attempt_count,last_error,updated_at")
        .order("updated_at", { ascending: false })
        .limit(10),
      supabase
        .from("job_status")
        .select("job_name,status,summary,error_message,last_started_at,last_completed_at")
        .order("last_started_at", { ascending: false }),
      supabase
        .from("job_runs")
        .select("job_name,status,summary,error_message,started_at,completed_at")
        .order("started_at", { ascending: false })
        .limit(12),
      loadAdminAuditLog(supabase, parseAdminAuditQuery(params)),
      supabase.rpc("get_app_health_contract"),
      supabase.rpc("get_admin_capability_status"),
      supabase
        .from("app_error_events")
        .select(
          "id,correlation_id,error_code,subsystem,severity,route,technical_summary,occurrence_count,first_seen_at,last_seen_at",
          { count: "exact" }
        )
        .eq("status", "open")
        .order("last_seen_at", { ascending: false })
        .limit(20)
    ]);

    if (
      metadataResponse.error ||
      reminderResponse.error ||
      jobStatusResponse.error ||
      jobEventsResponse.error ||
      healthContractResponse.error
    ) {
      await throwAdminLoadError(
        "admin-health-load-failed",
        metadataResponse.error?.message ??
          reminderResponse.error?.message ??
          jobStatusResponse.error?.message ??
          jobEventsResponse.error?.message ??
          healthContractResponse.error?.message ??
          "Failed loading system health.",
        "load_health"
      );
    }

    healthSchemaVersion = metadataResponse.data?.value ?? null;
    healthCapabilities = parseAdminCapabilities(capabilityResponse.data, Boolean(capabilityResponse.error));
    healthReminderRows = (reminderResponse.data ?? []) as AdminReminderHealthRow[];
    healthJobRuns = (jobStatusResponse.data ?? []).map((row) => ({
      completed_at: row.last_completed_at,
      error_message: row.error_message,
      job_name: row.job_name,
      started_at: row.last_started_at,
      status: row.status,
      summary: row.summary
    })) as AdminJobRunHealthRow[];
    healthJobEvents = (jobEventsResponse.data ?? []) as AdminJobRunHealthRow[];
    healthAuditLog = auditResponse;
    healthAppErrorInboxReady = !appErrorsResponse.error;
    healthAppErrorInboxIssue = appErrorsResponse.error
      ? /app_error_events|relation .* does not exist|schema cache/i.test(
          appErrorsResponse.error.message
        )
        ? "Application error tracking is not installed. Apply the latest application-error inbox migration."
        : "Application error tracking could not be loaded. Check the Supabase logs and retry this page."
      : null;
    healthAppErrors = healthAppErrorInboxReady
      ? ((appErrorsResponse.data ?? []) as AdminAppErrorRow[])
      : [];
    healthOpenAppErrorCount = healthAppErrorInboxReady
      ? (appErrorsResponse.count ?? healthAppErrors.length)
      : 0;
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
  }

  let missingParticipants: WinnerProfileRow[] = [];
  if (isRaceWeek && raceWeekPhase === "picks" && selectedResultRace) {
    healthNextRaces = racesInPickWindow(currentSeasonRaces, selectedResultRace);
    healthNextRace = healthNextRaces[0] ?? null;
    if (healthNextRace) {
      const pickDeadline = pickLockAtForRace(healthNextRace);
      const reminderWindow = getReminderWindow(
        Date.parse(pickDeadline) - currentTime
      );
      const [healthPicksResponse, gate, queueResponse, reminderHistoryResponse] = await Promise.all([
        registeredProfileIds.size > 0
          ? paginatedAdminLoad<{race_id:number; user_id:string}>("pick-window submissions", (from,to) => supabase
              .from("picks").select("race_id,user_id").in("race_id", healthNextRaces.map(race => race.id))
              .order("race_id", {ascending:true}).order("user_id", {ascending:true}).range(from,to))
          : Promise.resolve({data: [], error: null}),
        getPreviousRaceResultsGate(supabase, healthNextRace, {
          includeDiagnostics: true,
          seasonRaces: currentSeasonRaces
        }),
        reminderWindow
          ? paginatedAdminLoad<ReminderQueueRow>("reminder queue", (from,to) => supabase
              .from("pick_reminders")
              .select("id,user_id,channel,recipient,delivery_status,attempt_count,last_attempt_at,lease_expires_at")
              .eq("race_id", healthNextRace!.id).eq("reminder_type", reminderWindow.key)
              .order("id", {ascending:true}).range(from,to).returns<ReminderQueueRow[]>())
          : Promise.resolve({data: [], error: null}),
        paginatedAdminLoad<{reminder_type:string; delivery_status:string; channel:string}>("reminder history", (from,to) => supabase
          .from("pick_reminders").select("reminder_type,delivery_status,channel")
          .eq("race_id", healthNextRace!.id).eq("channel", "email")
          .order("id", {ascending:true}).range(from,to))
      ]);
      if (healthPicksResponse.error || queueResponse.error || reminderHistoryResponse.error) {
        await throwAdminLoadError(
          "admin-reminder-health-load-failed",
          healthPicksResponse.error ?? queueResponse.error ?? reminderHistoryResponse.error,
          "load_reminder_health"
        );
      }
      const healthPickRows = ((healthPicksResponse.data ?? []) as Array<{
        race_id: number;
        user_id: string;
      }>).filter(row => registeredProfileIds.has(row.user_id));
      missingParticipants = missingPickParticipants(activeParticipants, healthNextRaces.map(race => race.id), healthPickRows);
      healthPickCount = healthPickRows.length;
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

      const pickedRaceIdsByUser = new Map<string, Set<number>>();
      healthPickRows.forEach((pick) => {
        const pickedRaceIds = pickedRaceIdsByUser.get(pick.user_id) ?? new Set<number>();
        pickedRaceIds.add(pick.race_id);
        pickedRaceIdsByUser.set(pick.user_id, pickedRaceIds);
      });
      const missingParticipantCount = Array.from(registeredProfileIds).filter(
        (profileId) =>
          (pickedRaceIdsByUser.get(profileId)?.size ?? 0) < healthNextRaces.length
      ).length;
      const sentCountByType = new Map<ReminderType, number>();
      (reminderHistoryResponse.data ?? []).forEach((row) => {
        const reminderType = row.reminder_type as ReminderType;
        if (row.delivery_status === "sent") {
          sentCountByType.set(reminderType, (sentCountByType.get(reminderType) ?? 0) + 1);
        }
      });
      const schedule = reminderScheduleForDeadline(pickDeadline);
      const previewType =
        reminderWindow?.key ??
        schedule.find((item) => Date.parse(item.sendAt) > currentTime)?.key ??
        "4h";
      const previewMessage = buildPickReminderMessage({
        missingRaces: healthNextRaces,
        races: healthNextRaces,
        recipientName: profile.full_name,
        reminderWindow: getReminderWindowByType(previewType),
        siteUrl: canonicalSiteOrigin()
      });
      healthReminderPreview = {
        from: process.env.RESEND_FROM_EMAIL?.trim() || null,
        html: previewMessage.html,
        missingParticipantCount,
        raceId: healthNextRace.id,
        raceName: pickWindowDisplayName(healthNextRaces, healthNextRace.race_name),
        recipientEmail: user.email ?? null,
        reminderType: previewType,
        schedule: schedule.map((item) => {
          const sentCount = sentCountByType.get(item.key) ?? 0;
          const sendTime = Date.parse(item.sendAt);
          const status = sentCount > 0
            ? "sent"
            : reminderWindow?.key === item.key
              ? "due"
              : sendTime <= currentTime
                ? "passed"
                : "scheduled";
          return { ...item, sentCount, status };
        }),
        subject: previewMessage.subject,
        text: previewMessage.text
      };
    }
  }

  return (
    <AuthenticatedPageShell
      description={
        <>
          Signed in as <span className="font-semibold text-slate-900">{profile.team_name}</span>.
        </>
      }
      eyebrow="League Ops"
      maxWidth="max-w-7xl"
      showMobileNavigation={false}
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
          data-testid={isRaceWeek ? "admin-results-save-alert" : undefined}
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

      <AdminWorkspaceNav activeTab={activeTab}
        openErrorCount={activeTab === "health" ? (healthAppErrorInboxReady ? healthOpenAppErrorCount : null) : attention.openErrors}
        unpublishedRaceCount={hasActiveCalendar ? currentSeasonRaces.filter(race => race.results_status !== "published" && Date.parse(race.race_date) <= currentTime).length : attention.unpublishedRaces} />

      {activeTab === "health" ? (
        <AdminSystemHealth
          appErrorInboxReady={healthAppErrorInboxReady}
          appErrorInboxIssue={healthAppErrorInboxIssue}
          appErrors={healthAppErrors}
          auditLog={healthAuditLog!}
          cleanupTestFlowDataAction={cleanupTestFlowDataAction}
          currentTime={currentTime}
          emailEnabled={process.env.PICK_EMAILS_ENABLED?.toLowerCase() === "true"}
          healthContract={healthContract}
          capabilities={healthCapabilities}
          activeSeasonYear={activeSeason?.season_year ?? null}
          jobEvents={healthJobEvents}
          jobRuns={healthJobRuns}
          reminderRows={healthReminderRows}
          resolveAppErrorAction={resolveAppErrorAction}
          schemaVersion={healthSchemaVersion}
          openAppErrorCount={healthOpenAppErrorCount}
        />
      ) : null}

      {activeTab === "recovery" ? (
        <SeasonRecoveryCenter
          key={selectedRecoverySeason?.id ?? "no-season"}
          seasons={seasons.map(season => ({id:season.id,seasonYear:season.season_year,status:season.status}))}
          selectedSeasonId={selectedRecoverySeason?.id ?? null}
          activeSeason={
            activeSeason
              ? { id: activeSeason.id, seasonYear: activeSeason.season_year }
              : null
          }
          requestToken={recoveryRequestToken}
          restorePoints={restorePoints}
        />
      ) : null}

      {activeTab === "participants" ? (
        <AdminParticipantsWorkspace
          key={selectedParticipantSeason?.id ?? "no-season"}
          activeSeasonId={activeSeason?.id ?? null}
          selectedParticipantSeasonId={selectedParticipantSeason?.id ?? null}
          participantSeasons={participantSeasons.map(season => ({id:season.id,seasonYear:season.season_year,status:season.status as "active"|"upcoming"}))}
          currentAdminId={user.id}
          emailWarning={participantEmails.warning}
          activeSeasonYear={activeSeason?.season_year ?? null}
          initialQuery={participantQuery}
          initialStatus={participantStatus}
          participants={adminParticipantRows}
        />
      ) : null}

      {activeTab === "drivers" ? (
        <AdminDriversWorkspace
          activeSeason={activeSeason}
          drivers={drivers}
          seasons={seasons}
        />
      ) : null}

      {activeTab === "seasons" ? <AdminSeasonsWorkspace activeSeason={activeSeason} seasons={seasons} archives={archives}
        currentSeasonRaces={currentSeasonRaces} canFinalizeSeason={canFinalizeSeason} canRefreshArchive={canRefreshArchive} finalSeasonRace={finalSeasonRace}
        unpublishedSeasonRaces={unpublishedSeasonRaces} siteOrigin={canonicalSiteOrigin()} /> : null}

      {activeTab === "races" ? (
        <AdminRacesWorkspace activeSeason={activeSeason} pickWindowPartnerByRaceId={pickWindowPartnerByRaceId}
          races={races} racesByPickWindow={racesByPickWindow} seasonById={seasonById} seasons={seasons}
          selectedRaceSeason={selectedRaceSeason} teamNameByProfileId={teamNameByProfileId} />
      ) : null}

      {isRaceWeek ? <AdminRaceWeekWorkspace key={`${selectedResultRace?.id}-${raceWeekPhase}`} race={selectedResultRace}
        drivers={drivers} snapshot={raceDriverGroups} currentTime={currentTime} races={currentSeasonRaces} phase={raceWeekPhase} participants={activeParticipants} teamNameByProfileId={teamNameByProfileId}>
        {raceWeekPhase === "results" ? <AdminResultsWorkspace activeParticipants={activeParticipants}
          driverNameById={driverNameById} drivers={drivers} pickRows={pickRows} raceById={raceById}
          raceDriverGroups={raceDriverGroups} scoringAudits={scoringAudits}
          selectedResultRace={selectedResultRace} sortedResults={sortedResults} /> : null}
        {raceWeekPhase === "picks" && selectedResultRace ? <>
          <AdminMissingPicks participants={missingParticipants.map(participant => ({id:participant.id, teamName:participant.team_name, email:participantEmails.emailsByProfileId.get(participant.id) ?? null}))}
            total={activeParticipants.length} emailWarning={participantEmails.warning} />
          <AdminRemindersWorkspace selectedRaceId={selectedResultRace.id} emailEnabled={process.env.PICK_EMAILS_ENABLED?.toLowerCase() === "true"}
            reminderQueue={healthReminderQueue} reminderPreview={healthReminderPreview}
            retryFailedRemindersAction={retryFailedPickRemindersAction} sendReminderTestAction={sendPickReminderTestAction}
            nextRace={healthNextRace ? {
              expectedPickCount: registeredProfileIds.size * healthNextRaces.length,
              pickLockAt: pickLockAtForRace(healthNextRace), pickCount: healthPickCount,
              previousResultsStatus: healthPreviousResultsStatus,
              raceName: pickWindowDisplayName(healthNextRaces, healthNextRace.race_name),
              roundLabel: pickWindowRoundLabel(healthNextRaces), roundNumber: healthNextRace.round_number
            } : null} />
        </> : null}
      </AdminRaceWeekWorkspace> : null}

      {activeTab === "feedback" ? (
        <AdminFeedbackWorkspace
          feedbackCount={feedbackCount}
          feedbackItems={feedbackItems}
          feedbackPage={feedbackPage}
          feedbackPageCount={feedbackPageCount}
          feedbackStatus={feedbackStatus}
          teamNameByProfileId={teamNameByProfileId}
        />
      ) : null}
    </AuthenticatedPageShell>
  );
}
