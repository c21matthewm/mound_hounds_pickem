import Link from "next/link";
import { AuthenticatedPageShell } from "@/components/authenticated-page-shell";
import { MobileBottomNav } from "@/components/mobile-bottom-nav";
import { SignOutButton } from "@/components/sign-out-button";
import { MOUND_HOUND_IMAGE_PATH } from "@/lib/branding";
import { requireAppUser } from "@/lib/authenticated-user";
import { getPreviousRaceResultsGate } from "@/lib/pickem-results-gate";
import { nextPickWindow, pickWindowRoundLabel } from "@/lib/pick-windows";
import { queryStringParam } from "@/lib/query";
import { raceContextLabel } from "@/lib/race-label";
import { pickLockAtForRace, type RacePickFormat } from "@/lib/race-format";
import { isRegisteredForSeason } from "@/lib/season-participation";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

type DashboardRaceRow = {
  id: number;
  pick_format?: RacePickFormat | null;
  pick_window_key: string;
  qualifying_start_at: string;
  race_date: string;
  race_name: string;
  round_number: number;
  season_id: number;
};

const DASHBOARD_RACE_SELECT_FIELDS =
  "id,race_name,pick_format,pick_window_key,qualifying_start_at,race_date,season_id,round_number";

export default async function DashboardPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const message = queryStringParam(params.message);

  const { activeSeason, participation, profile, supabase, user } = await requireAppUser({
    requireSeasonDecision: true
  });

  const now = new Date();
  let currentRace: DashboardRaceRow | null = null;
  let currentPickWindow: DashboardRaceRow[] = [];

  if (activeSeason) {
    const { data, error: raceError } = await supabase
      .from("races")
      .select(DASHBOARD_RACE_SELECT_FIELDS)
      .eq("is_archived", false)
      .eq("season_id", activeSeason.id)
      .order("round_number", { ascending: true })
      .returns<DashboardRaceRow[]>();

    if (raceError) {
      throw new Error(`Failed loading the next race: ${raceError.message}`);
    }
    currentPickWindow = nextPickWindow(data ?? [], now);
  }

  const currentPickResponse = currentPickWindow.length > 0
    ? await supabase
        .from("picks")
        .select("id,race_id")
        .in("race_id", currentPickWindow.map((race) => race.id))
        .eq("user_id", user.id)
        .returns<Array<{ id: number; race_id: number }>>()
    : { data: [], error: null };
  if (currentPickResponse.error) {
    throw new Error(`Failed loading your saved pick status: ${currentPickResponse.error.message}`);
  }
  const pickedRaceIds = new Set((currentPickResponse.data ?? []).map((pick) => pick.race_id));
  const missingRace = currentPickWindow.find((race) => !pickedRaceIds.has(race.id)) ?? null;
  currentRace = missingRace ?? currentPickWindow[0] ?? null;
  const savedRaceCount = pickedRaceIds.size;
  const windowIsComplete =
    currentPickWindow.length > 0 && savedRaceCount === currentPickWindow.length;
  const isDoubleheader = currentPickWindow.length > 1;
  const pickLockAt = currentRace ? pickLockAtForRace(currentRace) : null;
  const picksLocked = pickLockAt ? Date.parse(pickLockAt) <= now.getTime() : false;
  const previousResultsGate = currentRace
    ? await getPreviousRaceResultsGate(supabase, currentRace)
    : null;
  const blockedPreviousResultsGate =
    previousResultsGate?.status === "blocked" ? previousResultsGate : null;
  const raceAction = activeSeason && !isRegisteredForSeason(participation)
    ? {
        body: `Your team is not registered for the ${activeSeason.seasonYear} season. Join when you are ready to make picks.`,
        href: "/season-registration",
        label: "Register now",
        status: "Not Registered",
        title: "Not entered this season"
      }
    : !currentRace
    ? {
        body: activeSeason
          ? `No upcoming race is scheduled yet for the ${activeSeason.seasonYear} season.`
          : "No league season is currently active.",
        href: "/leaderboard",
        label: "View leaderboard",
        status: "Waiting",
        title: "Race week will appear here"
      }
    : blockedPreviousResultsGate
      ? {
          body: `${blockedPreviousResultsGate.shortMessage} Driver standings and pick groups will refresh before this form opens.`,
          href: profile.role === "admin" ? "/admin?tab=results" : "/leaderboard",
          label: profile.role === "admin" ? "Upload Results" : "View Leaderboard",
          status: "Results Needed",
          title: "Waiting on Results"
        }
    : picksLocked
      ? {
          body: windowIsComplete
            ? `${isDoubleheader ? "Both doubleheader submissions are" : "Your submission is"} saved and locked.`
            : `${currentRace.race_name} is locked. Check the leaderboard once results are posted.`,
          href: windowIsComplete
            ? `/leaderboard?tab=picks&race_id=${currentRace.id}`
            : "/leaderboard",
          label: windowIsComplete ? "View locked picks" : "View leaderboard",
          status: "Locked",
          title: windowIsComplete ? "Picks saved and locked" : "Race is locked"
        }
      : {
          body: windowIsComplete
            ? `No action needed. ${isDoubleheader ? "Both doubleheader submissions are" : "Your picks are"} already in.`
            : isDoubleheader
              ? `${savedRaceCount}/${currentPickWindow.length} race submissions saved. Complete each before the shared deadline.`
              : `${currentRace.race_name} is open. Submit your picks before lock.`,
          href: `/picks?race_id=${currentRace.id}`,
          label: windowIsComplete ? "Review Picks" : "Make Picks",
          status: windowIsComplete
            ? "Picks Saved"
            : isDoubleheader
              ? `${savedRaceCount}/${currentPickWindow.length} Saved`
              : "Form Open",
          title: windowIsComplete
            ? "Picks Are In"
            : isDoubleheader && savedRaceCount > 0
              ? "Complete Your Picks"
              : "Make Your Picks"
        };

  return (
    <AuthenticatedPageShell
      actions={<SignOutButton className="static" />}
      description={
        <>
          Signed in as <span className="font-semibold text-slate-900">{profile.team_name}</span>.
        </>
      }
      eyebrow="Team Hub"
      maxWidth="max-w-5xl"
      title="Dashboard"
    >
      {message ? (
        <p className="mt-6 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {message}
        </p>
      ) : null}

      <section className="mt-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold text-slate-900">Quick Actions</h2>
            <p className="mt-1 text-sm text-slate-600">Jump into the race-week work that matters.</p>
          </div>
          <div className="shrink-0 rounded-lg border border-slate-300 bg-white p-1 shadow-sm">
            <div
              aria-hidden
              className="h-20 w-20 rounded-md border border-slate-200 bg-slate-200 bg-cover bg-center"
              style={{ backgroundImage: `url('${MOUND_HOUND_IMAGE_PATH}')` }}
            />
          </div>
        </div>

        <div className="mt-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-base font-semibold text-slate-900">{raceAction.title}</h3>
                <span className="rounded-full border border-cyan-200 bg-cyan-50 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-cyan-800">
                  {raceAction.status}
                </span>
              </div>
              {currentRace && activeSeason ? (
                <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {isDoubleheader
                    ? `${activeSeason.seasonYear} · ${pickWindowRoundLabel(currentPickWindow)} · Doubleheader`
                    : raceContextLabel({
                        roundNumber: currentRace.round_number,
                        seasonYear: activeSeason.seasonYear
                      })}
                </p>
              ) : null}
              <p className="mt-1 text-sm text-slate-600">{raceAction.body}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {profile.role === "admin" ? (
                <Link
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
                  href="/admin"
                >
                  Admin
                </Link>
              ) : null}
              <Link
                className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-700"
                href={raceAction.href}
              >
                {raceAction.label}
              </Link>
            </div>
          </div>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Link
            className="group rounded-lg bg-cyan-700 px-4 py-3 text-sm font-semibold text-white hover:bg-cyan-800"
            href="/race-center"
          >
            <span className="flex items-center justify-between gap-3">
              Race Center
              <span className="transition group-hover:translate-x-0.5">→</span>
            </span>
          </Link>
          <Link
            className="group rounded-lg bg-slate-900 px-4 py-3 text-sm font-semibold text-white hover:bg-slate-700"
            href={isRegisteredForSeason(participation) ? "/picks" : "/season-registration"}
          >
            <span className="flex items-center justify-between gap-3">
              {isRegisteredForSeason(participation) ? "Pick'em Form" : "Season Registration"}
              <span className="transition group-hover:translate-x-0.5">→</span>
            </span>
          </Link>
          <Link
            className="group rounded-lg bg-slate-900 px-4 py-3 text-sm font-semibold text-white hover:bg-slate-700"
            href="/leaderboard"
          >
            <span className="flex items-center justify-between gap-3">
              Leaderboard
              <span className="transition group-hover:translate-x-0.5">→</span>
            </span>
          </Link>
          <Link
            className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-900 hover:bg-slate-50"
            href="/rules"
          >
            Rules
          </Link>
          <Link
            className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-900 hover:bg-slate-50"
            href="/feedback"
          >
            Feedback
          </Link>
          <Link
            className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-900 hover:bg-slate-50"
            href="/contact-admin"
          >
            Contact Admin
          </Link>
          {profile.role === "admin" ? (
            <Link
              className="rounded-lg border border-slate-900 bg-white px-4 py-3 text-sm font-semibold text-slate-900 hover:bg-slate-50"
              href="/admin"
            >
              Admin Dashboard
            </Link>
          ) : null}
        </div>
      </section>

      <section className="mt-6 rounded-xl border border-slate-200 bg-white/80 p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Profile Snapshot</h2>
            <p className="mt-1 text-sm text-slate-600">Your active league identity.</p>
          </div>
        </div>
        <dl className="mt-4 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
            <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Full Name
            </dt>
            <dd className="mt-0.5 font-medium text-slate-900">{profile.full_name}</dd>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
            <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Team Name
            </dt>
            <dd className="mt-0.5 font-medium text-slate-900">{profile.team_name}</dd>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
            <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Email</dt>
            <dd className="mt-0.5 break-all font-medium text-slate-900">{user.email ?? "-"}</dd>
          </div>
          {profile.role === "admin" ? (
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
              <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Role
              </dt>
              <dd className="mt-0.5 font-medium capitalize text-slate-900">{profile.role}</dd>
            </div>
          ) : null}
        </dl>
      </section>

      <MobileBottomNav />
    </AuthenticatedPageShell>
  );
}
