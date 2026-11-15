import Link from "next/link";
import { AuthenticatedPageShell } from "@/components/authenticated-page-shell";
import { PickSubmissionSnapshot } from "@/components/pick-submission-snapshot";
import { RaceWeekSummary } from "@/components/race-week-summary";
import { RaceScheduleRefresh } from "@/components/race-schedule-refresh";
import { saveWeeklyPickAction } from "@/app/picks/actions";
import { PickemForm } from "@/components/pickem-form";
import {
  ActionLink,
  CompactNotice,
  StatusChip
} from "@/components/ui-primitives";
import { requireAppUser } from "@/lib/authenticated-user";
import { getPreviousRaceResultsGate } from "@/lib/pickem-results-gate";
import {
  nextPickWindow,
  pickWindowOpensAt,
  pickWindowRoundLabel,
  racesInPickWindow
} from "@/lib/pick-windows";
import { pickDraftStorageKey } from "@/lib/pick-draft";
import { queryStringParam } from "@/lib/query";
import { raceContextLabel } from "@/lib/race-label";
import {
  comparePickFieldDriverOrder,
  groupNumbersForCount,
  normalizeRacePickFormat,
  pickGroupCountForFormat,
  pickLockAtForRace,
  type RacePickFormat
} from "@/lib/race-format";
import { formatLeagueDateTime, LEAGUE_TIME_ZONE } from "@/lib/timezone";

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
  field_frozen_at: string | null;
  id: number;
  pick_format?: RacePickFormat | null;
  pick_window_key: string;
  payout: number | string;
  qualifying_start_at: string;
  race_date: string;
  race_name: string;
  results_status: "draft" | "published";
  round_number: number;
  season_id: number;
  title_image_url: string | null;
};

type PickRow = {
  average_speed: number | string;
  driver_group1_id: number;
  driver_group2_id: number;
  driver_group3_id: number;
  driver_group4_id: number;
  driver_group5_id: number;
  driver_group6_id: number;
  driver_group7_id: number | null;
  driver_group8_id: number | null;
  id: number;
  race_id: number;
  updated_at: string;
};

type RaceDriverGroupRow = {
  driver_id: number;
  group_number: number;
  qualifying_position: number | null;
  race_id: number;
};

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const PICKEM_RACE_SELECT_FIELDS =
  "id,race_name,pick_format,pick_window_key,title_image_url,qualifying_start_at,race_date,payout,season_id,round_number,field_frozen_at,results_status";

const formatRaceDate = (value: string): string =>
  formatLeagueDateTime(value, { dateStyle: "full", timeStyle: "short" });

const parseRaceId = (value: string | undefined): number | null => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

const selectedByGroup = (pick: PickRow | null, groupNumbers: number[]): Record<number, number | null> => {
  const selected: Record<number, number | null> = {};
  groupNumbers.forEach((groupNumber) => {
    const key = `driver_group${groupNumber}_id` as keyof PickRow;
    const value = pick?.[key];
    selected[groupNumber] = typeof value === "number" ? value : null;
  });
  return selected;
};

export default async function PicksPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const error = queryStringParam(params.error);
  const message = queryStringParam(params.message);
  const requestedRaceId = parseRaceId(queryStringParam(params.race_id));

  const { activeSeason, profile, supabase, user } = await requireAppUser({
    requireRegistration: true,
    requireSeasonDecision: true,
    seasonRegistrationNext: requestedRaceId ? "/picks?race_id=" + requestedRaceId : "/picks"
  });

  const now = new Date();

  if (!activeSeason) {
    return (
      <AuthenticatedPageShell
        maxWidth="max-w-4xl"
        title="Pick'em Form"
      >
        <CompactNotice className="mt-4">
          No league season is currently active.
        </CompactNotice>
        <ActionLink className="mt-4 w-fit" href="/dashboard" variant="secondary">
          Back to dashboard
        </ActionLink>
      </AuthenticatedPageShell>
    );
  }

  const { data: raceRows, error: upcomingRaceError } = await supabase
    .from("races")
    .select(PICKEM_RACE_SELECT_FIELDS)
    .eq("is_archived", false)
    .eq("season_id", activeSeason.id)
    .order("round_number", { ascending: true })
    .returns<RaceRow[]>();

  if (upcomingRaceError) {
    throw new Error(`Failed loading the next race: ${upcomingRaceError.message}`);
  }

  const seasonRaces = raceRows ?? [];
  const requestedRace = seasonRaces.find((race) => race.id === requestedRaceId);
  const requestedLockedRace = requestedRace && Date.parse(pickLockAtForRace(requestedRace)) <= now.getTime()
    ? requestedRace
    : null;
  const pickWindow = requestedLockedRace
    ? racesInPickWindow(seasonRaces, requestedLockedRace)
    : nextPickWindow(seasonRaces, now);

  if (pickWindow.length === 0) {
    return (
      <AuthenticatedPageShell
        maxWidth="max-w-4xl"
        title="Pick'em Form"
      >
        <CompactNotice className="mt-4">
          No future race is scheduled yet for the {activeSeason.seasonYear} season.
          {profile.role === "admin"
            ? " Add the next race from the admin dashboard."
            : " The league administrator will post the next race when it is ready."}
        </CompactNotice>
        <ActionLink className="mt-4 w-fit" href="/dashboard" variant="secondary">
          Back to dashboard
        </ActionLink>
      </AuthenticatedPageShell>
    );
  }

  const pickOpenAt = pickWindowOpensAt(seasonRaces, pickWindow);
  if (!requestedLockedRace && pickOpenAt && Date.parse(pickOpenAt) > now.getTime()) {
    const openingRace = pickWindow[0];
    return (
      <AuthenticatedPageShell
        description={`${raceContextLabel({
          roundNumber: openingRace.round_number,
          seasonYear: activeSeason.seasonYear
        })} · ${openingRace.race_name}`}
        maxWidth="max-w-4xl"
        title="Pick'em Form"
      >
        <CompactNotice className="mt-5" tone="info">
          <h2 className="font-semibold text-slate-950">Opening-round picks are scheduled</h2>
          <p className="mt-1 text-sm leading-6">
            The form opens six days before qualifying, on {formatRaceDate(pickOpenAt)}. Your
            season registration is already confirmed.
          </p>
        </CompactNotice>
        <ActionLink className="mt-4 w-fit" href="/dashboard" variant="secondary">
          Back to dashboard
        </ActionLink>
      </AuthenticatedPageShell>
    );
  }

  const pickWindowIds = pickWindow.map((race) => race.id);
  const { data: windowPickRows, error: windowPicksError } = await supabase
    .from("picks")
    .select(
      "id,race_id,driver_group1_id,driver_group2_id,driver_group3_id,driver_group4_id,driver_group5_id,driver_group6_id,driver_group7_id,driver_group8_id,average_speed,updated_at"
    )
    .eq("user_id", user.id)
    .in("race_id", pickWindowIds)
    .returns<PickRow[]>();

  if (windowPicksError) {
    throw new Error(`Failed loading your saved picks: ${windowPicksError.message}`);
  }

  const pickByRaceId = new Map((windowPickRows ?? []).map((pick) => [pick.race_id, pick]));
  const selectedRace =
    pickWindow.find((race) => race.id === requestedRaceId) ??
    pickWindow.find((race) => !pickByRaceId.has(race.id)) ??
    pickWindow[0];
  const existingPick = pickByRaceId.get(selectedRace.id) ?? null;
  const savedRaceCount = pickWindow.filter((race) => pickByRaceId.has(race.id)).length;
  const racePickFormat = normalizeRacePickFormat(selectedRace.pick_format);
  const groupCount = pickGroupCountForFormat(racePickFormat);
  const groupNumbers = groupNumbersForCount(groupCount);
  const pickLockAt = pickLockAtForRace(selectedRace);
  const isIndy500Pickem = racePickFormat === "indy_500";

  const picksLocked = Date.parse(pickLockAt) <= now.getTime();
  const selectedMap = selectedByGroup(existingPick, groupNumbers);
  const selectedDriverIds = Object.values(selectedMap).filter((id) => id !== null);
  const editableField = picksLocked ? null : await Promise.all([
    getPreviousRaceResultsGate(supabase, selectedRace, {
      includeDiagnostics: profile.role === "admin",
      seasonRaces
    }),
    supabase
      .from("drivers")
      .select("id,driver_name,image_url,championship_points,current_standing,group_number,is_active")
      .order("group_number", { ascending: true })
      .order("current_standing", { ascending: true }),
    supabase
      .from("race_driver_groups")
      .select("race_id,driver_id,group_number,qualifying_position")
      .eq("race_id", selectedRace.id)
      .order("group_number", { ascending: true })
      .order("qualifying_position", { ascending: true })
  ]);
  const [previousResultsGate, driversResponse, raceDriverGroupsResponse] = editableField ?? [];
  const blockedPreviousResultsGate =
    previousResultsGate?.status === "blocked" ? previousResultsGate : null;
  const previousResultsBlocked = Boolean(blockedPreviousResultsGate);

  if (driversResponse?.error) {
    throw new Error("Failed loading the race driver field: " + driversResponse.error.message);
  }

  if (raceDriverGroupsResponse?.error) {
    throw new Error("Failed loading race driver groups: " + raceDriverGroupsResponse.error.message);
  }
  const raceDriverGroups = (raceDriverGroupsResponse?.data ?? []) as RaceDriverGroupRow[];
  const allDrivers = (driversResponse?.data ?? []) as DriverRow[];

  let receiptDrivers: Pick<DriverRow, "id" | "driver_name">[] = allDrivers;
  if (picksLocked && selectedDriverIds.length > 0) {
    const { data, error } = await supabase
      .from("drivers")
      .select("id,driver_name")
      .in("id", selectedDriverIds);
    if (error) {
      throw new Error("Failed loading saved driver names: " + error.message);
    }
    receiptDrivers = data ?? [];
  }

  const driverNameById = new Map(receiptDrivers.map((driver) => [driver.id, driver.driver_name]));
  const savedPickSummary = groupNumbers.flatMap((groupNumber) => {
    const driverId = selectedMap[groupNumber];
    if (!driverId) {
      return [];
    }

    return [
      {
        driverName: driverNameById.get(driverId) ?? `Driver #${driverId}`,
        groupNumber
      }
    ];
  });

  const driverById = new Map(allDrivers.map((driver) => [driver.id, driver]));
  const driversByGroup = new Map<number, Array<DriverRow & { qualifyingPosition?: number | null }>>();
  groupNumbers.forEach((groupNumber) => driversByGroup.set(groupNumber, []));
  if (raceDriverGroups.length > 0) {
    raceDriverGroups.forEach((raceGroup) => {
      const driver = driverById.get(raceGroup.driver_id);
      if (!driver || raceGroup.group_number < 1 || raceGroup.group_number > groupCount) {
        return;
      }

      const existing = driversByGroup.get(raceGroup.group_number) ?? [];
      existing.push({
        ...driver,
        qualifyingPosition: raceGroup.qualifying_position
      });
      driversByGroup.set(raceGroup.group_number, existing);
    });
  } else {
    allDrivers.forEach((driver) => {
      if (!driver.is_active) return;
      const existing = driversByGroup.get(driver.group_number) ?? [];
      existing.push(driver);
      driversByGroup.set(driver.group_number, existing);
    });
  }

  driversByGroup.forEach((drivers, groupNumber) => {
    drivers.sort((left, right) =>
      comparePickFieldDriverOrder(
        racePickFormat,
        {
          currentStanding: left.current_standing,
          driverName: left.driver_name,
          qualifyingPosition: left.qualifyingPosition
        },
        {
          currentStanding: right.current_standing,
          driverName: right.driver_name,
          qualifyingPosition: right.qualifyingPosition
        }
      )
    );
    driversByGroup.set(groupNumber, drivers);
  });

  const missingGroups = groupNumbers.filter(
    (groupNumber) => (driversByGroup.get(groupNumber) ?? []).length === 0
  );
  const canSubmit = missingGroups.length === 0 && !picksLocked && !previousResultsBlocked;
  const pickGroups = groupNumbers.map((groupNumber) => ({
    drivers: (driversByGroup.get(groupNumber) ?? []).map((driver) => ({
      championshipPoints: driver.championship_points,
      detailText:
        isIndy500Pickem && driver.qualifyingPosition
          ? `Qualifying Position: ${driver.qualifyingPosition}`
          : undefined,
      driverName: driver.driver_name,
      id: driver.id,
      imageUrl: driver.image_url
    })),
    groupNumber,
    isTopGroup: !isIndy500Pickem && groupNumber <= 5,
    selectionLabel: isIndy500Pickem
      ? groupNumber < groupCount
        ? "Pick 1 of 4"
        : "Pick 1 of 5"
      : groupNumber <= 5
        ? "Pick 1 of 4"
        : "Pick 1"
  }));
  const raceStatusLabel = previousResultsBlocked
    ? "Waiting on Results"
    : picksLocked
      ? "Locked"
      : "Open";
  const savedFormLabel = picksLocked ? "Saved & locked" : "Saved";
  const unsavedFormLabel = picksLocked
    ? "Locked"
    : previousResultsBlocked ? "Results Needed" : "Needs picks";

  return (
    <AuthenticatedPageShell
      description={
        <>
          Team <span className="font-semibold text-slate-900">{profile.team_name}</span>
        </>
      }
      maxWidth="max-w-6xl"
      title="Pick'em Form"
    >
      <RaceScheduleRefresh
        lockedDraftKey={picksLocked ? pickDraftStorageKey(user.id, selectedRace.id) : undefined}
        pickLockAt={pickLockAt}
        pollWhileBlocked={previousResultsBlocked || missingGroups.length > 0}
        raceId={selectedRace.id}
        raceStartAt={selectedRace.race_date}
      />
      <RaceWeekSummary
        banner={picksLocked ? null : selectedRace.title_image_url}
        context={raceContextLabel({ roundNumber: selectedRace.round_number, seasonYear: activeSeason.seasonYear })}
        status={raceStatusLabel}
        timing={{ label: isIndy500Pickem ? "Pick Lock (Race Start)" : "Pick deadline", dateTime: pickLockAt }}
        title={selectedRace.race_name}
        tone={previousResultsBlocked ? "warning" : picksLocked ? "neutral" : "info"}
      >
        {pickWindow.length > 1 || !picksLocked ? (
          <>
            {pickWindow.length > 1 ? (
              <>
                <p className="text-xs font-semibold text-slate-700">
                  {pickWindowRoundLabel(pickWindow)} · Doubleheader · {savedRaceCount}/{pickWindow.length} saved
                </p>
                <nav
                  aria-label="Doubleheader race forms"
                  className="mt-2 grid gap-2 sm:grid-cols-2"
                >
                  {pickWindow.map((race) => {
                    const isSelected = race.id === selectedRace.id;
                    const isSaved = pickByRaceId.has(race.id);

                    return (
                      <Link
                        aria-current={isSelected ? "page" : undefined}
                        className={`grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-md border px-3 py-2 text-left transition ${
                          isSelected
                            ? "border-cyan-700 bg-cyan-50 shadow-sm"
                            : "border-slate-200 bg-white hover:border-slate-400 hover:bg-slate-50"
                        }`}
                        href={`/picks?race_id=${race.id}`}
                        key={race.id}
                      >
                        <span className="min-w-0">
                          <span className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                            R{race.round_number} ·{" "}
                            {formatLeagueDateTime(race.race_date, { weekday: "long" })}
                          </span>
                          <span className="mt-1 block text-sm font-semibold leading-5 text-slate-950">
                            {race.race_name}
                          </span>
                        </span>
                        <StatusChip
                          className="mt-0.5 shrink-0"
                          tone={isSaved ? "success" : picksLocked ? "neutral" : "warning"}
                        >
                          {isSaved ? savedFormLabel : unsavedFormLabel}
                        </StatusChip>
                      </Link>
                    );
                  })}
                </nav>
              </>
            ) : null}
            {!picksLocked ? (
              <details className="mt-2">
                <summary className="min-h-11 w-fit cursor-pointer py-2.5 text-sm font-semibold text-blue-800">Race details</summary>
                <div className="border-t border-slate-200 py-3 text-sm text-slate-700">
                  <dl className="flex flex-wrap gap-x-6 gap-y-3">
                    <div>
                      <dt className="text-xs font-semibold text-slate-600">Race start</dt>
                      <dd>{formatRaceDate(selectedRace.race_date)}</dd>
                    </div>
                    <div>
                      <dt className="text-xs font-semibold text-slate-600">Payout</dt>
                      <dd>${Number(selectedRace.payout).toFixed(2)}</dd>
                    </div>
                    <div>
                      <dt className="text-xs font-semibold text-slate-600">Timezone</dt>
                      <dd>{LEAGUE_TIME_ZONE}</dd>
                    </div>
                  </dl>
                  {isIndy500Pickem ? (
                    <p className="mt-3">Indianapolis 500 picks use qualifying-order groups and lock when the race starts.</p>
                  ) : null}
                  <a className="mt-3 inline-block font-semibold text-blue-800 underline" href="https://www.indycar.com/" rel="noreferrer" target="_blank">
                    Official INDYCAR website
                  </a>
                </div>
              </details>
            ) : null}
          </>
        ) : null}
      </RaceWeekSummary>

      {message ? (
        <CompactNotice className="mt-6" tone="success">
          {message}
        </CompactNotice>
      ) : null}

      {error ? (
        <CompactNotice className="mt-6" tone="danger">
          {error}
        </CompactNotice>
      ) : null}

      {!previousResultsBlocked ? (
        <PickSubmissionSnapshot
          latestSavedAt={existingPick?.updated_at ?? null}
          lockedRaceId={picksLocked ? selectedRace.id : undefined}
          savedAverageSpeed={existingPick ? String(existingPick.average_speed) : null}
          savedPicks={savedPickSummary}
        />
      ) : null}

      {blockedPreviousResultsGate ? (
        <section className="mt-6 rounded-lg border border-cyan-200 bg-cyan-50 p-4 text-sm text-cyan-950">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="font-semibold text-cyan-950">Form paused until results are posted</h3>
              <p className="mt-1 text-cyan-900">{blockedPreviousResultsGate.message}</p>
            </div>
            {profile.role === "admin" ? (
              <ActionLink href="/admin?tab=results">
                Upload Results
              </ActionLink>
            ) : (
              <ActionLink href="/leaderboard" variant="secondary">
                View Leaderboard
              </ActionLink>
            )}
          </div>
        </section>
      ) : null}

      {!picksLocked && !previousResultsBlocked && missingGroups.length > 0 ? (
        <CompactNotice className="mt-6" tone="warning">
          {isIndy500Pickem
            ? "Picks are unavailable until admin imports the Indianapolis 500 qualifying order with all 33 drivers."
            : "Picks are unavailable because these groups have no active drivers: "}
          {!isIndy500Pickem
            ? `${missingGroups.map((group) => `Group ${group}`).join(", ")}. Update drivers in admin.`
            : null}
        </CompactNotice>
      ) : null}
      {!picksLocked && !previousResultsBlocked ? (
        <PickemForm
          action={saveWeeklyPickAction}
          canSubmit={canSubmit}
          draftOwnerId={user.id}
          existingAverageSpeed={existingPick ? String(existingPick.average_speed) : ""}
          existingSavedAt={existingPick?.updated_at ?? null}
          groups={pickGroups}
          key={selectedRace.id}
          picksLocked={picksLocked}
          raceId={selectedRace.id}
          savedSelection={selectedMap}
        />
      ) : null}
    </AuthenticatedPageShell>
  );
}
