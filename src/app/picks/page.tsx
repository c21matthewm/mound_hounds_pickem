import Link from "next/link";
import { AuthenticatedPageShell } from "@/components/authenticated-page-shell";
import { MobileBottomNav } from "@/components/mobile-bottom-nav";
import { PickSubmissionSnapshot } from "@/components/pick-submission-snapshot";
import { SignOutButton } from "@/components/sign-out-button";
import { saveWeeklyPickAction } from "@/app/picks/actions";
import { PickemForm } from "@/components/pickem-form";
import { requireAppUser } from "@/lib/authenticated-user";
import { getPreviousRaceResultsGate } from "@/lib/pickem-results-gate";
import { queryStringParam } from "@/lib/query";
import { raceContextLabel } from "@/lib/race-label";
import {
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
  "id,race_name,pick_format,title_image_url,qualifying_start_at,race_date,payout,season_id,round_number";

const formatRaceDate = (value: string): string =>
  formatLeagueDateTime(value, { dateStyle: "full", timeStyle: "short" });

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

  const { activeSeason, profile, supabase, user } = await requireAppUser({
    requireRegistration: true,
    requireSeasonDecision: true
  });

  const now = new Date();
  const nowIso = now.toISOString();

  if (!activeSeason) {
    return (
      <AuthenticatedPageShell
        actions={<SignOutButton className="static" />}
        eyebrow="Race Picks"
        maxWidth="max-w-4xl"
        title="Pick'em Form"
      >
        <p className="mt-4 rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
          No league season is currently active.
        </p>
        <Link className="mt-4 text-sm font-semibold text-slate-900 underline" href="/dashboard">
          Back to dashboard
        </Link>
      </AuthenticatedPageShell>
    );
  }

  const { data: upcomingRace } = await supabase
    .from("races")
    .select(PICKEM_RACE_SELECT_FIELDS)
    .eq("is_archived", false)
    .eq("season_id", activeSeason.id)
    .gt("race_date", nowIso)
    .order("round_number", { ascending: true })
    .limit(1)
    .maybeSingle<RaceRow>();

  if (!upcomingRace) {
    return (
      <AuthenticatedPageShell
        actions={<SignOutButton className="static" />}
        eyebrow="Race Picks"
        maxWidth="max-w-4xl"
        title="Pick'em Form"
      >
        <p className="mt-4 rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
          No future race is scheduled yet for the {activeSeason.seasonYear} season. Add a race in
          admin with a start date in the future.
        </p>
        <Link className="mt-4 text-sm font-semibold text-slate-900 underline" href="/dashboard">
          Back to dashboard
        </Link>
      </AuthenticatedPageShell>
    );
  }

  const racePickFormat = normalizeRacePickFormat(upcomingRace.pick_format);
  const groupCount = pickGroupCountForFormat(racePickFormat);
  const groupNumbers = groupNumbersForCount(groupCount);
  const pickLockAt = pickLockAtForRace(upcomingRace);
  const isIndy500Pickem = racePickFormat === "indy_500";

  const [previousResultsGate, driversResponse, existingPickResponse, raceDriverGroupsResponse] =
    await Promise.all([
      getPreviousRaceResultsGate(supabase, upcomingRace),
      supabase
        .from("drivers")
        .select("id,driver_name,image_url,championship_points,current_standing,group_number,is_active")
        .eq("is_active", true)
        .order("group_number", { ascending: true })
        .order("current_standing", { ascending: true }),
      supabase
        .from("picks")
        .select(
          "id,driver_group1_id,driver_group2_id,driver_group3_id,driver_group4_id,driver_group5_id,driver_group6_id,driver_group7_id,driver_group8_id,average_speed,updated_at"
        )
        .eq("race_id", upcomingRace.id)
        .eq("user_id", user.id)
        .maybeSingle<PickRow>(),
      supabase
        .from("race_driver_groups")
        .select("race_id,driver_id,group_number,qualifying_position")
        .eq("race_id", upcomingRace.id)
        .order("group_number", { ascending: true })
        .order("qualifying_position", { ascending: true })
    ]);
  const blockedPreviousResultsGate =
    previousResultsGate.status === "blocked" ? previousResultsGate : null;
  const previousResultsBlocked = Boolean(blockedPreviousResultsGate);

  if (existingPickResponse.error) {
    throw new Error(`Failed loading your saved picks: ${existingPickResponse.error.message}`);
  }
  const existingPick = existingPickResponse.data ?? null;

  if (raceDriverGroupsResponse.error) {
    throw new Error(`Failed loading race driver groups: ${raceDriverGroupsResponse.error.message}`);
  }
  const raceDriverGroups = (raceDriverGroupsResponse.data ?? []) as RaceDriverGroupRow[];

  const activeDrivers: DriverRow[] = (driversResponse.data ?? []) as DriverRow[];
  const selectedMap = selectedByGroup(existingPick, groupNumbers);
  const picksLocked = Date.parse(pickLockAt) <= now.getTime();
  const driverNameById = new Map<number, string>();
  const driverById = new Map<number, DriverRow>();
  activeDrivers.forEach((driver) => {
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
  if (isIndy500Pickem) {
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
        <>
          <Link
            className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
            href="/dashboard"
          >
            Dashboard
          </Link>
          <Link
            className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
            href="/leaderboard"
          >
            Leaderboard
          </Link>
        </>
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

      <section className="mt-6 overflow-hidden rounded-3xl border border-slate-200 bg-white">
        {upcomingRace.title_image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            alt={`${upcomingRace.race_name} banner`}
            className="h-44 w-full object-cover md:h-64"
            src={upcomingRace.title_image_url}
          />
        ) : null}

        <div className="bg-[radial-gradient(circle_at_top_left,_#0ea5e9,_transparent_28%),linear-gradient(135deg,_#0f172a,_#1e293b)] p-6 text-white md:p-7">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-200">
                {raceContextLabel({
                  roundNumber: upcomingRace.round_number,
                  seasonYear: activeSeason.seasonYear
                })}
              </p>
              <h2 className="mt-2 text-3xl font-semibold tracking-tight">{upcomingRace.race_name}</h2>
            </div>
            <span
              className={`rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-wide ${raceStatusClass}`}
            >
              Status: {raceStatusLabel}
            </span>
          </div>
          <div className="mt-5 grid gap-3 text-sm md:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-xl border border-white/15 bg-white/10 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-300">
                {isIndy500Pickem ? "Pick Lock (Race Start)" : "Pick Deadline"}
              </p>
              <p className="mt-1 font-medium">{formatRaceDate(pickLockAt)}</p>
            </div>
            <div className="rounded-xl border border-white/15 bg-white/10 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-300">Race Start</p>
              <p className="mt-1 font-medium">{formatRaceDate(upcomingRace.race_date)}</p>
            </div>
            <div className="rounded-xl border border-white/15 bg-white/10 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-300">Payout</p>
              <p className="mt-1 font-medium">${Number(upcomingRace.payout).toFixed(2)}</p>
            </div>
            <div className="rounded-xl border border-white/15 bg-white/10 p-3">
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
            <p className="mt-4 rounded-xl border border-cyan-300/30 bg-cyan-300/10 px-3 py-2 text-xs text-cyan-50">
              Indianapolis 500 picks use qualifying-order groups and lock when the race starts.
            </p>
          ) : null}
        </div>
      </section>

      {error ? (
        <p className="mt-6 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      {!previousResultsBlocked ? (
        <PickSubmissionSnapshot
          latestSavedAt={existingPick?.updated_at ?? null}
          savedAverageSpeed={existingPick ? String(existingPick.average_speed) : null}
          savedPicks={savedPickSummary}
        />
      ) : null}

      {blockedPreviousResultsGate ? (
        <section className="mt-6 rounded-2xl border border-cyan-200 bg-cyan-50 p-4 text-sm text-cyan-950">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="font-semibold text-cyan-950">Form paused until results are posted</h3>
              <p className="mt-1 text-cyan-900">{blockedPreviousResultsGate.message}</p>
            </div>
            {profile.role === "admin" ? (
              <Link
                className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-700"
                href="/admin?tab=results"
              >
                Upload Results
              </Link>
            ) : (
              <Link
                className="rounded-lg border border-cyan-300 bg-white px-3 py-2 text-sm font-semibold text-cyan-950 hover:bg-cyan-100"
                href="/leaderboard"
              >
                View Leaderboard
              </Link>
            )}
          </div>
        </section>
      ) : null}

      {!previousResultsBlocked && missingGroups.length > 0 ? (
        <p className="mt-6 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {isIndy500Pickem
            ? "Picks are unavailable until admin imports the Indianapolis 500 qualifying order with all 33 drivers."
            : "Picks are unavailable because these groups have no active drivers: "}
          {!isIndy500Pickem
            ? `${missingGroups.map((group) => `Group ${group}`).join(", ")}. Update drivers in admin.`
            : null}
        </p>
      ) : null}
      {!previousResultsBlocked ? (
        <PickemForm
          action={saveWeeklyPickAction}
          canSubmit={canSubmit}
          existingAverageSpeed={existingPick ? String(existingPick.average_speed) : ""}
          groups={pickGroups}
          picksLocked={picksLocked}
          raceId={upcomingRace.id}
          savedSelection={selectedMap}
        />
      ) : null}

      <MobileBottomNav />
    </AuthenticatedPageShell>
  );
}
