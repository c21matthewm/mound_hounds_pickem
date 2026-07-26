import Link from "next/link";
import { AuthenticatedPageShell } from "@/components/authenticated-page-shell";
import { MobileBottomNav } from "@/components/mobile-bottom-nav";
import { SignOutButton } from "@/components/sign-out-button";
import { requireAppUser } from "@/lib/authenticated-user";
import { getPreviousRaceResultsGate } from "@/lib/pickem-results-gate";
import { nextPickWindow, pickWindowRoundLabel } from "@/lib/pick-windows";
import {
  groupNumbersForCount,
  normalizeRacePickFormat,
  pickGroupCountForFormat,
  pickLockAtForRace,
  type RacePickFormat
} from "@/lib/race-format";
import { raceContextLabel } from "@/lib/race-label";
import {
  buildLeagueScoringSnapshot,
  buildParticipantAnalyticsSnapshot
} from "@/lib/scoring";
import { isRegisteredForSeason } from "@/lib/season-participation";
import { formatLeagueDateTime } from "@/lib/timezone";

type RaceCenterRace = {
  field_frozen_at: string | null;
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

type RaceCenterPick = {
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

const RACE_FIELDS =
  "id,race_name,pick_format,pick_window_key,qualifying_start_at,race_date,results_status,season_id,round_number,field_frozen_at";

const formatDateTime = (value: string): string =>
  formatLeagueDateTime(value, { dateStyle: "medium", timeStyle: "short" });

const pickDriverIds = (pick: RaceCenterPick, groupCount: number): number[] =>
  groupNumbersForCount(groupCount).flatMap((groupNumber) => {
    const key = `driver_group${groupNumber}_id` as keyof RaceCenterPick;
    const value = pick[key];
    return typeof value === "number" ? [value] : [];
  });

export default async function RaceCenterPage() {
  const { activeSeason, participation, profile, supabase, user } = await requireAppUser({
    requireSeasonDecision: true
  });

  if (!activeSeason) {
    return (
      <AuthenticatedPageShell
        actions={<SignOutButton className="static" />}
        eyebrow="Race Center"
        maxWidth="max-w-5xl"
        title="Race week"
      >
        <p className="mt-6 rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
          No league season is currently active.
        </p>
        <MobileBottomNav />
      </AuthenticatedPageShell>
    );
  }

  const now = new Date();
  const { data: raceRows, error: racesError } = await supabase
    .from("races")
    .select(RACE_FIELDS)
    .eq("season_id", activeSeason.id)
    .eq("is_archived", false)
    .order("round_number", { ascending: true });

  if (racesError) {
    throw new Error(`Failed loading Race Center schedule: ${racesError.message}`);
  }

  const races = (raceRows ?? []) as RaceCenterRace[];
  const nextRaceWindow = nextPickWindow(races, now);
  const latestPublishedRace =
    [...races]
      .filter((race) => race.results_status === "published")
      .sort((a, b) => b.round_number - a.round_number)[0] ?? null;

  const currentPickResponse = nextRaceWindow.length > 0
    ? await supabase
        .from("picks")
        .select(
          "id,race_id,average_speed,driver_group1_id,driver_group2_id,driver_group3_id,driver_group4_id,driver_group5_id,driver_group6_id,driver_group7_id,driver_group8_id,updated_at"
        )
        .in("race_id", nextRaceWindow.map((race) => race.id))
        .eq("user_id", user.id)
        .returns<RaceCenterPick[]>()
    : { data: [], error: null };

  if (currentPickResponse.error) {
    throw new Error(`Failed loading Race Center pick status: ${currentPickResponse.error.message}`);
  }

  const pickByRaceId = new Map(
    (currentPickResponse.data ?? []).map((pick) => [pick.race_id, pick])
  );
  const missingRace = nextRaceWindow.find((race) => !pickByRaceId.has(race.id)) ?? null;
  const nextRace = missingRace ?? nextRaceWindow[0] ?? null;
  const currentPick = nextRace ? pickByRaceId.get(nextRace.id) ?? null : null;
  const savedRaceCount = pickByRaceId.size;
  const windowComplete =
    nextRaceWindow.length > 0 && savedRaceCount === nextRaceWindow.length;
  const isDoubleheader = nextRaceWindow.length > 1;
  const currentPickFormat = normalizeRacePickFormat(nextRace?.pick_format);
  const currentGroupCount = pickGroupCountForFormat(currentPickFormat);
  const selectedDriverIds = currentPick
    ? pickDriverIds(currentPick, currentGroupCount)
    : [];

  const [driverResponse, previousResultsGate, scoringSnapshot, analyticsSnapshot] =
    await Promise.all([
      selectedDriverIds.length > 0
        ? supabase
            .from("drivers")
            .select("id,driver_name")
            .in("id", selectedDriverIds)
        : Promise.resolve({ data: [], error: null }),
      nextRace ? getPreviousRaceResultsGate(supabase, nextRace) : Promise.resolve(null),
      buildLeagueScoringSnapshot(activeSeason.id),
      buildParticipantAnalyticsSnapshot(user.id, activeSeason.id)
    ]);

  if (driverResponse.error) {
    throw new Error(`Failed loading saved pick names: ${driverResponse.error.message}`);
  }

  const driverNameById = new Map(
    (driverResponse.data ?? []).map((driver) => [driver.id, driver.driver_name])
  );
  const savedPickNames = selectedDriverIds.map(
    (driverId) => driverNameById.get(driverId) ?? `Driver #${driverId}`
  );
  const standing = scoringSnapshot.leaderboardRows.find((row) => row.userId === user.id) ?? null;
  const latestRecap = latestPublishedRace
    ? analyticsSnapshot.raceRows.find((race) => race.raceId === latestPublishedRace.id) ?? null
    : null;
  const picksLocked = nextRace
    ? Date.parse(pickLockAtForRace(nextRace)) <= now.getTime()
    : false;
  const previousResultsBlocked = previousResultsGate?.status === "blocked";
  const registered = isRegisteredForSeason(participation);

  const action = !registered
    ? {
        body: `Join the ${activeSeason.seasonYear} field with the private season invite code.`,
        href: "/season-registration",
        label: "Register for season",
        status: "Registration needed",
        title: "Join this season"
      }
    : !nextRace
      ? {
          body: "The current schedule is complete. Final standings remain available on the leaderboard.",
          href: "/leaderboard",
          label: "View standings",
          status: "Season complete",
          title: "No upcoming race"
        }
      : previousResultsBlocked
        ? {
            body: `${previousResultsGate.shortMessage} The next driver field opens after publication.`,
            href: profile.role === "admin" ? "/admin?tab=results" : "/leaderboard",
            label: profile.role === "admin" ? "Publish results" : "View standings",
            status: "Waiting on results",
            title: isDoubleheader ? "Doubleheader weekend" : nextRace.race_name
          }
        : picksLocked
          ? {
              body: windowComplete
                ? `${isDoubleheader ? "Both race submissions are" : "Your picks are"} saved and locked. Results will appear here after publication.`
                : "The pick deadline has passed. Follow the race and return for results.",
              href: windowComplete
                ? `/leaderboard?tab=picks&race_id=${nextRace.id}`
                : "/leaderboard",
              label: windowComplete ? "View locked picks" : "View standings",
              status: "Locked",
              title: isDoubleheader ? "Doubleheader weekend" : nextRace.race_name
            }
          : {
              body: windowComplete
                ? `No action needed. ${isDoubleheader ? "Both race submissions are" : "Your submission is"} saved.`
                : isDoubleheader
                  ? `${savedRaceCount}/${nextRaceWindow.length} race submissions saved. Complete both before ${formatDateTime(
                      pickLockAtForRace(nextRace)
                    )}.`
                  : `Select one driver from each group before ${formatDateTime(
                      pickLockAtForRace(nextRace)
                    )}.`,
              href: `/picks?race_id=${nextRace.id}`,
              label: windowComplete ? "Review picks" : "Make picks",
              status: windowComplete
                ? "Picks saved"
                : isDoubleheader
                  ? `${savedRaceCount}/${nextRaceWindow.length} saved`
                  : "Form open",
              title: isDoubleheader ? "Doubleheader weekend" : nextRace.race_name
            };

  let registeredTeamCount = 0;
  let nextRacePickCount = 0;
  let fieldDriverCount = 0;
  if (profile.role === "admin" && nextRace) {
    const [registrationCount, pickCount, fieldCount] = await Promise.all([
      supabase
        .from("season_participants")
        .select("profile_id", { count: "exact", head: true })
        .eq("season_id", activeSeason.id)
        .eq("status", "registered"),
      supabase
        .from("picks")
        .select("id", { count: "exact", head: true })
        .in("race_id", nextRaceWindow.map((race) => race.id)),
      supabase
        .from("race_driver_groups")
        .select("driver_id", { count: "exact", head: true })
        .in("race_id", nextRaceWindow.map((race) => race.id))
    ]);

    const adminReadError =
      registrationCount.error?.message ?? pickCount.error?.message ?? fieldCount.error?.message;
    if (adminReadError) {
      throw new Error(`Failed loading Race Center readiness: ${adminReadError}`);
    }

    registeredTeamCount = registrationCount.count ?? 0;
    nextRacePickCount = pickCount.count ?? 0;
    fieldDriverCount = fieldCount.count ?? 0;
  }

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
          <SignOutButton className="static" />
        </>
      }
      description={`${profile.full_name}'s race-week status, submission, and latest result.`}
      eyebrow={`${activeSeason.seasonYear} Race Center`}
      maxWidth="max-w-5xl"
      title="Race week"
    >
      <section className="mt-6 overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="border-b border-slate-200 bg-slate-950 px-4 py-5 text-white sm:px-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              {nextRace ? (
                <p className="text-xs font-semibold uppercase tracking-wide text-cyan-300">
                  {isDoubleheader
                    ? `${activeSeason.seasonYear} · ${pickWindowRoundLabel(nextRaceWindow)}`
                    : raceContextLabel({
                        roundNumber: nextRace.round_number,
                        seasonYear: activeSeason.seasonYear
                      })}
                </p>
              ) : null}
              <h2 className="mt-1 text-xl font-semibold">{action.title}</h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">{action.body}</p>
            </div>
            <span className="rounded-full border border-cyan-300/40 bg-cyan-300/10 px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-cyan-100">
              {action.status}
            </span>
          </div>
          <Link
            className="mt-4 inline-flex rounded-md bg-white px-3 py-2 text-sm font-semibold text-slate-950 hover:bg-slate-100"
            href={action.href}
          >
            {action.label}
          </Link>
        </div>

        {nextRace ? (
          <dl className="grid gap-px bg-slate-200 sm:grid-cols-3">
            <div className="bg-white px-4 py-3">
              <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Pick deadline
              </dt>
              <dd className="mt-1 text-sm font-semibold text-slate-900">
                {formatDateTime(pickLockAtForRace(nextRace))}
              </dd>
            </div>
            <div className="bg-white px-4 py-3">
              <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                {isDoubleheader ? "Selected race start" : "Race start"}
              </dt>
              <dd className="mt-1 text-sm font-semibold text-slate-900">
                {formatDateTime(nextRace.race_date)}
              </dd>
            </div>
            <div className="bg-white px-4 py-3">
              <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Submission
              </dt>
              <dd className="mt-1 text-sm font-semibold text-slate-900">
                {isDoubleheader
                  ? `${savedRaceCount}/${nextRaceWindow.length} race forms saved`
                  : currentPick
                    ? `${currentGroupCount}/${currentGroupCount} groups saved`
                    : "Not submitted"}
              </dd>
            </div>
          </dl>
        ) : null}

        {isDoubleheader ? (
          <div className="border-t border-slate-200 bg-white px-4 py-3 sm:px-6">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Weekend submissions
            </p>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {nextRaceWindow.map((race) => {
                const isSaved = pickByRaceId.has(race.id);
                return (
                  <Link
                    className="flex min-w-0 items-center justify-between gap-3 rounded-md border border-slate-200 px-3 py-2 hover:bg-slate-50"
                    href={`/picks?race_id=${race.id}`}
                    key={race.id}
                  >
                    <span className="min-w-0 truncate text-sm font-semibold text-slate-900">
                      R{race.round_number} · {race.race_name}
                    </span>
                    <span
                      className={`shrink-0 text-xs font-semibold ${
                        isSaved ? "text-emerald-700" : "text-amber-700"
                      }`}
                    >
                      {isSaved ? "Saved" : "Needs picks"}
                    </span>
                  </Link>
                );
              })}
            </div>
          </div>
        ) : null}
      </section>

      {currentPick ? (
        <section className="mt-5 border-y border-slate-200 py-4">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <h2 className="font-semibold text-slate-900">
                Saved submission{isDoubleheader && nextRace ? ` · R${nextRace.round_number}` : ""}
              </h2>
              <p className="mt-1 text-xs text-slate-500">
                Updated {formatDateTime(currentPick.updated_at)} · Avg Speed{" "}
                {Number(currentPick.average_speed).toFixed(3)} MPH
              </p>
            </div>
            {!picksLocked ? (
              <Link
                className="text-sm font-semibold text-slate-900 underline"
                href={`/picks?race_id=${nextRace?.id ?? ""}`}
              >
                Edit
              </Link>
            ) : null}
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {savedPickNames.map((driverName, index) => (
              <span
                className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-medium text-slate-700"
                key={`${index}-${driverName}`}
              >
                G{index + 1} · {driverName}
              </span>
            ))}
          </div>
        </section>
      ) : null}

      <section className="mt-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="font-semibold text-slate-900">Latest result</h2>
            <p className="mt-1 text-xs text-slate-500">
              {latestPublishedRace
                ? `${raceContextLabel({
                    roundNumber: latestPublishedRace.round_number,
                    seasonYear: activeSeason.seasonYear
                  })} · ${latestPublishedRace.race_name}`
                : "No published race results yet."}
            </p>
          </div>
          <Link className="text-sm font-semibold text-slate-900 underline" href="/leaderboard">
            Full leaderboard
          </Link>
        </div>

        {latestRecap ? (
          <dl className="mt-3 grid gap-px overflow-hidden rounded-md border border-slate-200 bg-slate-200 sm:grid-cols-4">
            <div className="bg-white px-3 py-3">
              <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Weekly finish
              </dt>
              <dd className="mt-1 text-lg font-semibold text-slate-950">
                {latestRecap.weeklyFinish ? `#${latestRecap.weeklyFinish}` : "-"}
              </dd>
            </div>
            <div className="bg-white px-3 py-3">
              <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Weekly points
              </dt>
              <dd className="mt-1 text-lg font-semibold text-slate-950">
                {latestRecap.weeklyPoints}
              </dd>
            </div>
            <div className="bg-white px-3 py-3">
              <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Season rank
              </dt>
              <dd className="mt-1 text-lg font-semibold text-slate-950">
                {standing ? `#${standing.currentStanding}` : "-"}
              </dd>
            </div>
            <div className="bg-white px-3 py-3">
              <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Rank movement
              </dt>
              <dd
                className={`mt-1 text-lg font-semibold ${
                  (standing?.change ?? 0) > 0
                    ? "text-emerald-700"
                    : (standing?.change ?? 0) < 0
                      ? "text-red-700"
                      : "text-slate-600"
                }`}
              >
                {(standing?.change ?? 0) > 0 ? "+" : ""}
                {standing?.change ?? 0}
              </dd>
            </div>
          </dl>
        ) : (
          <p className="mt-3 rounded-md border border-dashed border-slate-300 px-3 py-3 text-sm text-slate-600">
            Your first published recap will appear here.
          </p>
        )}
      </section>

      {profile.role === "admin" && nextRace ? (
        <section className="mt-6 border-t border-slate-300 pt-5">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="font-semibold text-slate-900">Admin readiness</h2>
              <p className="mt-1 text-xs text-slate-500">
                A compact race-week check before participant action begins.
              </p>
            </div>
            <Link className="text-sm font-semibold text-slate-900 underline" href="/admin?tab=health">
              System health
            </Link>
          </div>
          <dl className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-md border border-slate-200 px-3 py-2">
              <dt className="text-xs text-slate-500">Previous results</dt>
              <dd className="mt-0.5 text-sm font-semibold text-slate-900">
                {previousResultsBlocked ? "Action required" : "Ready"}
              </dd>
            </div>
            <div className="rounded-md border border-slate-200 px-3 py-2">
              <dt className="text-xs text-slate-500">Race field</dt>
              <dd className="mt-0.5 text-sm font-semibold text-slate-900">
                {nextRaceWindow.every((race) => race.field_frozen_at)
                  ? `${fieldDriverCount} driver slots frozen`
                  : "Not frozen yet"}
              </dd>
            </div>
            <div className="rounded-md border border-slate-200 px-3 py-2">
              <dt className="text-xs text-slate-500">Submissions</dt>
              <dd className="mt-0.5 text-sm font-semibold text-slate-900">
                {nextRacePickCount}/{registeredTeamCount * nextRaceWindow.length} submissions
              </dd>
            </div>
            <div className="rounded-md border border-slate-200 px-3 py-2">
              <dt className="text-xs text-slate-500">Results</dt>
              <dd className="mt-0.5 text-sm font-semibold capitalize text-slate-900">
                {nextRaceWindow.filter((race) => race.results_status === "published").length}/
                {nextRaceWindow.length} published
              </dd>
            </div>
          </dl>
        </section>
      ) : null}

      <MobileBottomNav />
    </AuthenticatedPageShell>
  );
}
