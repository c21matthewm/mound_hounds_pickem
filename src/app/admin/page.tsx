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
  type AdminAuditHealthRow,
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
  nextPickWindow,
  pickWindowDisplayName,
  pickWindowRoundLabel
} from "@/lib/pick-windows";
import { queryStringParam } from "@/lib/query";
import { normalizeRacePickFormat, pickLockAtForRace } from "@/lib/race-format";
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

  const { profile, supabase, user } = await requireAdmin();
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
      ? activeTab === "health"
        ? supabase
            .from("season_participants")
            .select("profile_id,status,profiles!inner(is_active)")
            .eq("season_id", loadedActiveSeason.id)
            .eq("profiles.is_active", true)
        : supabase
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
            "id,season_id,season_year,label,source,retention_key,snapshot_bytes,schema_version,format_version,row_counts,checksum,created_at"
          )
          .eq("season_id", loadedActiveSeason.id)
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
    await throwAdminLoadError("admin-workspace-load-failed", loadError, `load_${activeTab}`);
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
  let healthReminderPreview: AdminReminderPreview | null = null;
  let healthJobRuns: AdminJobRunHealthRow[] = [];
  let healthJobEvents: AdminJobRunHealthRow[] = [];
  let healthAuditRows: AdminAuditHealthRow[] = [];
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
      nextRaceResponse,
      jobStatusResponse,
      jobEventsResponse,
      auditResponse,
      healthContractResponse,
      appErrorsResponse
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
              "id,race_name,pick_format,pick_window_key,qualifying_start_at,race_date,results_status,season_id,round_number,field_frozen_at"
            )
            .eq("season_id", activeSeason.id)
            .eq("is_archived", false)
            .order("round_number", { ascending: true })
            .returns<HealthRaceRow[]>()
        : Promise.resolve({ data: [], error: null }),
      supabase
        .from("job_status")
        .select("job_name,status,summary,error_message,last_started_at,last_completed_at")
        .order("last_started_at", { ascending: false }),
      supabase
        .from("job_runs")
        .select("job_name,status,summary,error_message,started_at,completed_at")
        .order("started_at", { ascending: false })
        .limit(12),
      supabase
        .from("admin_audit_events")
        .select("action,entity_type,summary,created_at")
        .order("created_at", { ascending: false })
        .limit(8),
      supabase.rpc("get_app_health_contract"),
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
      nextRaceResponse.error ||
      jobStatusResponse.error ||
      jobEventsResponse.error ||
      auditResponse.error ||
      healthContractResponse.error
    ) {
      await throwAdminLoadError(
        "admin-health-load-failed",
        metadataResponse.error?.message ??
          reminderResponse.error?.message ??
          nextRaceResponse.error?.message ??
          jobStatusResponse.error?.message ??
          jobEventsResponse.error?.message ??
          auditResponse.error?.message ??
          healthContractResponse.error?.message ??
          "Failed loading system health.",
        "load_health"
      );
    }

    healthSchemaVersion = metadataResponse.data?.value ?? null;
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
    healthAuditRows = (auditResponse.data ?? []) as AdminAuditHealthRow[];
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
    healthNextRaces = nextPickWindow(nextRaceResponse.data ?? [], new Date());
    healthNextRace = healthNextRaces[0] ?? null;

    if (healthNextRace) {
      const pickDeadline = pickLockAtForRace(healthNextRace);
      const reminderWindow = getReminderWindow(
        Date.parse(pickDeadline) - currentTime
      );
      const [healthPicksResponse, gate, queueResponse, reminderHistoryResponse] = await Promise.all([
        registeredProfileIds.size > 0
          ? supabase
              .from("picks")
              .select("race_id,user_id")
              .in("race_id", healthNextRaces.map((race) => race.id))
              .in("user_id", Array.from(registeredProfileIds))
          : Promise.resolve({ data: [], error: null }),
        getPreviousRaceResultsGate(supabase, healthNextRace),
        reminderWindow
          ? supabase
              .from("pick_reminders")
              .select(
                "id,user_id,channel,recipient,delivery_status,attempt_count,last_attempt_at,lease_expires_at"
              )
              .eq("race_id", healthNextRace.id)
              .eq("reminder_type", reminderWindow.key)
          : Promise.resolve({ data: [], error: null }),
        supabase
          .from("pick_reminders")
          .select("reminder_type,delivery_status,channel")
          .eq("race_id", healthNextRace.id)
          .eq("channel", "email")
      ]);
      if (healthPicksResponse.error || queueResponse.error || reminderHistoryResponse.error) {
        await throwAdminLoadError(
          "admin-reminder-health-load-failed",
          healthPicksResponse.error ?? queueResponse.error ?? reminderHistoryResponse.error,
          "load_reminder_health"
        );
      }
      const healthPickRows = (healthPicksResponse.data ?? []) as Array<{
        race_id: number;
        user_id: string;
      }>;
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
          appErrorInboxReady={healthAppErrorInboxReady}
          appErrorInboxIssue={healthAppErrorInboxIssue}
          appErrors={healthAppErrors}
          auditRows={healthAuditRows}
          cleanupTestFlowDataAction={cleanupTestFlowDataAction}
          currentTime={currentTime}
          emailEnabled={process.env.PICK_EMAILS_ENABLED?.toLowerCase() === "true"}
          healthContract={healthContract}
          jobEvents={healthJobEvents}
          jobRuns={healthJobRuns}
          nextRace={healthNextRace ? {
            expectedPickCount: registeredProfileIds.size * healthNextRaces.length,
            fieldFrozen: healthNextRaces.every((race) => Boolean(race.field_frozen_at)),
            pickLockAt: pickLockAtForRace(healthNextRace),
            pickCount: healthPickCount,
            previousResultsStatus: healthPreviousResultsStatus,
            raceName: pickWindowDisplayName(healthNextRaces, healthNextRace.race_name),
            roundLabel: pickWindowRoundLabel(healthNextRaces),
            roundNumber: healthNextRace.round_number
          } : null}
          registeredTeamCount={registeredProfileIds.size}
          reminderQueue={healthReminderQueue}
          reminderPreview={healthReminderPreview}
          reminderRows={healthReminderRows}
          resolveAppErrorAction={resolveAppErrorAction}
          retryFailedRemindersAction={retryFailedPickRemindersAction}
          sendReminderTestAction={sendPickReminderTestAction}
          schemaVersion={healthSchemaVersion}
          openAppErrorCount={healthOpenAppErrorCount}
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
          requestToken={recoveryRequestToken}
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
        <AdminDriversWorkspace
          activeSeason={activeSeason}
          drivers={drivers}
          seasons={seasons}
        />
      ) : null}

      {activeTab === "races" ? (
        <AdminRacesWorkspace
          activeParticipants={activeParticipants}
          activeSeason={activeSeason}
          currentSeasonRaces={currentSeasonRaces}
          pickWindowPartnerByRaceId={pickWindowPartnerByRaceId}
          races={races}
          racesByPickWindow={racesByPickWindow}
          seasonById={seasonById}
          seasons={seasons}
          selectedRaceSeason={selectedRaceSeason}
          teamNameByProfileId={teamNameByProfileId}
        />
      ) : null}

      {activeTab === "results" ? (
        <AdminResultsWorkspace
          activeIndy500Races={activeIndy500Races}
          activeParticipants={activeParticipants}
          activeSeason={activeSeason}
          canFinalizeSeason={canFinalizeSeason}
          currentSeasonRaces={currentSeasonRaces}
          driverNameById={driverNameById}
          drivers={drivers}
          finalSeasonRace={finalSeasonRace}
          hallOfFameMigrationReady={hallOfFameMigrationReady}
          pickRows={pickRows}
          raceById={raceById}
          raceDriverGroups={raceDriverGroups}
          results={results}
          savedHallOfFameSeason={savedHallOfFameSeason}
          scoringAudits={scoringAudits}
          selectedResultRace={selectedResultRace}
          sortedResults={sortedResults}
          unpublishedSeasonRaces={unpublishedSeasonRaces}
        />
      ) : null}

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
