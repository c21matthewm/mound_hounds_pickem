import Link from "next/link";
import { AuthenticatedPageShell } from "@/components/authenticated-page-shell";
import { MobileBottomNav } from "@/components/mobile-bottom-nav";
import { PickSubmissionSnapshot } from "@/components/pick-submission-snapshot";
import { saveWeeklyPickAction } from "@/app/picks/actions";
import { PickemForm } from "@/components/pickem-form";
import {
  ActionLink,
  CompactNotice
} from "@/components/ui-primitives";
import { requireAppUser } from "@/lib/authenticated-user";
import { getPreviousRaceResultsGate } from "@/lib/pickem-results-gate";
import { nextPickWindow, pickWindowRoundLabel } from "@/lib/pick-windows";
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
  id: number;
  pick_format?: RacePickFormat | null;
  pick_window_key: string;
  payout: number | string;
  qualifying_start_at: string;
  race_date: string;
  race_name: string;
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
  "id,race_name,pick_format,pick_window_key,title_image_url,qualifying_start_at,race_date,payout,season_id,round_number";

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
    requireSeasonDecision: true
  });

  const now = new Date();

  if (!activeSeason) {
    return (
      <AuthenticatedPageShell
        eyebrow="Race Picks"
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

  const pickWindow = nextPickWindow(raceRows ?? [], now);

  if (pickWindow.length === 0) {
    return (
      <AuthenticatedPageShell
        eyebrow="Race Picks"
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

  const [previousResultsGate, driversResponse, raceDriverGroupsResponse] =
    await Promise.all([
      getPreviousRaceResultsGate(supabase, selectedRace),
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
  const blockedPreviousResultsGate =
    previousResultsGate.status === "blocked" ? previousResultsGate : null;
  const previousResultsBlocked = Boolean(blockedPreviousResultsGate);

  if (driversResponse.error) {
    throw new Error(`Failed loading the race driver field: ${driversResponse.error.message}`);
  }

  if (raceDriverGroupsResponse.error) {
    throw new Error(`Failed loading race driver groups: ${raceDriverGroupsResponse.error.message}`);
  }
  const raceDriverGroups = (raceDriverGroupsResponse.data ?? []) as RaceDriverGroupRow[];

  const allDrivers: DriverRow[] = (driversResponse.data ?? []) as DriverRow[];
  const activeDrivers = allDrivers.filter((driver) => driver.is_active);
  const selectedMap = selectedByGroup(existingPick, groupNumbers);
  const picksLocked = Date.parse(pickLockAt) <= now.getTime();
  const driverNameById = new Map<number, string>();
  const driverById = new Map<number, DriverRow>();
  allDrivers.forEach((driver) => {
    driverNameById.set(driver.id, driver.driver_name);
    driverById.set(driver.id, driver);
  });
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
    activeDrivers.forEach((driver) => {
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
  const raceStatusClass = previousResultsBlocked
    ? "border-cyan-300/60 bg-cyan-300/15 text-cyan-100"
    : picksLocked
      ? "border-amber-300/60 bg-amber-300/15 text-amber-100"
      : "border-emerald-300/60 bg-emerald-300/15 text-emerald-100";

  return (
    <AuthenticatedPageShell
      actions={
        <ActionLink href="/dashboard" variant="secondary">
          Dashboard
        </ActionLink>
      }
      description={
        <>
          Team <span className="font-semibold text-slate-900">{profile.team_name}</span>
        </>
      }
      eyebrow="Race Picks"
      maxWidth="max-w-6xl"
      title="Pick'em Form"
    >
      {pickWindow.length > 1 ? (
        <section className="mt-6 border-y border-slate-200 bg-white py-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-cyan-700">
                {pickWindowRoundLabel(pickWindow)} · Doubleheader
              </p>
              <h2 className="mt-1 text-base font-semibold text-slate-950">
                Two separate race submissions
              </h2>
            </div>
            <span className="text-sm font-semibold text-slate-700">
              {savedRaceCount}/{pickWindow.length} saved
            </span>
          </div>
          <nav
            aria-label="Doubleheader race forms"
            className="mt-3 grid gap-2 sm:grid-cols-2"
          >
            {pickWindow.map((race) => {
              const isSelected = race.id === selectedRace.id;
              const isSaved = pickByRaceId.has(race.id);

              return (
                <Link
                  aria-current={isSelected ? "page" : undefined}
                  className={`flex min-w-0 items-center justify-between gap-3 rounded-md border px-3 py-2.5 text-left transition ${
                    isSelected
                      ? "border-cyan-700 bg-cyan-50"
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
                    <span className="mt-0.5 block truncate text-sm font-semibold text-slate-950">
                      {race.race_name}
                    </span>
                  </span>
                  <span
                    className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                      isSaved
                        ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                        : "border-amber-200 bg-amber-50 text-amber-800"
                    }`}
                  >
                    {isSaved ? "Saved" : "Needs picks"}
                  </span>
                </Link>
              );
            })}
          </nav>
          <p className="mt-2 text-xs text-slate-500">
            Each race has its own drivers and speed tie-breaker. Both forms lock at{" "}
            {formatRaceDate(pickLockAt)}.
          </p>
        </section>
      ) : null}

      <section className="mt-6 overflow-hidden rounded-lg border border-slate-200 bg-white">
        {selectedRace.title_image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            alt={`${selectedRace.race_name} banner`}
            className="h-44 w-full object-cover md:h-64"
            src={selectedRace.title_image_url}
          />
        ) : null}

        <div className="bg-[radial-gradient(circle_at_top_left,_#0ea5e9,_transparent_28%),linear-gradient(135deg,_#0f172a,_#1e293b)] p-6 text-white md:p-7">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-200">
                {raceContextLabel({
                  roundNumber: selectedRace.round_number,
                  seasonYear: activeSeason.seasonYear
                })}
              </p>
              <h2 className="mt-2 text-3xl font-semibold tracking-tight">{selectedRace.race_name}</h2>
            </div>
            <span
              className={`rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-wide ${raceStatusClass}`}
            >
              Status: {raceStatusLabel}
            </span>
          </div>
          <div className="mt-5 grid gap-3 text-sm md:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-md border border-white/15 bg-white/10 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-300">
                {isIndy500Pickem ? "Pick Lock (Race Start)" : "Pick Deadline"}
              </p>
              <p className="mt-1 font-medium">{formatRaceDate(pickLockAt)}</p>
            </div>
            <div className="rounded-md border border-white/15 bg-white/10 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-300">Race Start</p>
              <p className="mt-1 font-medium">{formatRaceDate(selectedRace.race_date)}</p>
            </div>
            <div className="rounded-md border border-white/15 bg-white/10 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-300">Payout</p>
              <p className="mt-1 font-medium">${Number(selectedRace.payout).toFixed(2)}</p>
            </div>
            <div className="rounded-md border border-white/15 bg-white/10 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-300">
                {isIndy500Pickem ? "Pick Format" : "Timezone"}
              </p>
              <p className="mt-1 font-medium">
                {isIndy500Pickem ? "Indy 500: 8 picks" : LEAGUE_TIME_ZONE}
              </p>
            </div>
          </div>
          <p className="mt-3 text-xs text-slate-300">
            Visit the official{" "}
            <a
              className="font-semibold text-cyan-200 underline decoration-cyan-300/60 underline-offset-2 hover:text-cyan-100"
              href="https://www.indycar.com/"
              rel="noreferrer"
              target="_blank"
            >
              INDYCAR
            </a>{" "}
            website for more information.
          </p>
          {isIndy500Pickem ? (
            <p className="mt-4 rounded-md border border-cyan-300/30 bg-cyan-300/10 px-3 py-2 text-xs text-cyan-50">
              Indianapolis 500 picks use qualifying-order groups and lock when the race starts.
            </p>
          ) : null}
        </div>
      </section>

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

      {!previousResultsBlocked && missingGroups.length > 0 ? (
        <CompactNotice className="mt-6" tone="warning">
          {isIndy500Pickem
            ? "Picks are unavailable until admin imports the Indianapolis 500 qualifying order with all 33 drivers."
            : "Picks are unavailable because these groups have no active drivers: "}
          {!isIndy500Pickem
            ? `${missingGroups.map((group) => `Group ${group}`).join(", ")}. Update drivers in admin.`
            : null}
        </CompactNotice>
      ) : null}
      {!previousResultsBlocked ? (
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

      <MobileBottomNav />
    </AuthenticatedPageShell>
  );
}
