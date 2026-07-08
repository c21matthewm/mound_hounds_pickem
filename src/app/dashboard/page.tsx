import { redirect } from "next/navigation";
import Link from "next/link";
import { AuthenticatedPageShell } from "@/components/authenticated-page-shell";
import { MobileBottomNav } from "@/components/mobile-bottom-nav";
import { SignOutButton } from "@/components/sign-out-button";
import { MOUND_HOUND_IMAGE_PATH } from "@/lib/branding";
import { isProfileComplete, type ProfileRow } from "@/lib/profile";
import { queryStringParam } from "@/lib/query";
import { pickLockAtForRace, type RacePickFormat } from "@/lib/race-format";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getLeagueSeasonDateRange } from "@/lib/timezone";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

type DashboardRaceRow = {
  id: number;
  pick_format?: RacePickFormat | null;
  qualifying_start_at: string;
  race_date: string;
  race_name: string;
};

const DASHBOARD_RACE_BUFFER_MS = 24 * 60 * 60 * 1000;
const DASHBOARD_RACE_SELECT_FIELDS = "id,race_name,pick_format,qualifying_start_at,race_date";

export default async function DashboardPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const message = queryStringParam(params.message);

  const supabase = await createServerSupabaseClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("id,full_name,team_name,phone_number,phone_carrier,role")
    .eq("id", user.id)
    .single<ProfileRow>();

  if (!profile || !isProfileComplete(profile)) {
    redirect("/onboarding");
  }

  const now = new Date();
  const nowIso = now.toISOString();
  const raceBufferStartIso = new Date(now.getTime() - DASHBOARD_RACE_BUFFER_MS).toISOString();
  const seasonRange = getLeagueSeasonDateRange();
  let currentRace: DashboardRaceRow | null = null;

  {
    const { data } = await supabase
      .from("races")
      .select(DASHBOARD_RACE_SELECT_FIELDS)
      .eq("is_archived", false)
      .gte("race_date", seasonRange.seasonStartIso)
      .lt("race_date", seasonRange.seasonEndExclusiveIso)
      .lte("race_date", nowIso)
      .gt("race_date", raceBufferStartIso)
      .order("race_date", { ascending: false })
      .limit(1)
      .maybeSingle<DashboardRaceRow>();

    currentRace = data ?? null;
  }

  if (!currentRace) {
    const { data } = await supabase
      .from("races")
      .select(DASHBOARD_RACE_SELECT_FIELDS)
      .eq("is_archived", false)
      .gte("race_date", seasonRange.seasonStartIso)
      .lt("race_date", seasonRange.seasonEndExclusiveIso)
      .gt("race_date", nowIso)
      .order("race_date", { ascending: true })
      .limit(1)
      .maybeSingle<DashboardRaceRow>();

    currentRace = data ?? null;
  }

  if (!currentRace) {
    const { data } = await supabase
      .from("races")
      .select(DASHBOARD_RACE_SELECT_FIELDS)
      .eq("is_archived", false)
      .gt("race_date", nowIso)
      .order("race_date", { ascending: true })
      .limit(1)
      .maybeSingle<DashboardRaceRow>();

    currentRace = data ?? null;
  }

  const { data: currentPick } = currentRace
    ? await supabase
        .from("picks")
        .select("id")
        .eq("race_id", currentRace.id)
        .eq("user_id", user.id)
        .maybeSingle<{ id: number }>()
    : { data: null };
  const pickLockAt = currentRace ? pickLockAtForRace(currentRace) : null;
  const picksLocked = pickLockAt ? Date.parse(pickLockAt) <= now.getTime() : false;
  const raceAction = !currentRace
    ? {
        body: `No active race is scheduled yet for the ${seasonRange.seasonYear} season.`,
        href: "/leaderboard",
        label: "View leaderboard",
        status: "Waiting",
        title: "Race week will appear here"
      }
    : picksLocked
      ? {
          body: currentPick
            ? `${currentRace.race_name} is locked. Review picks and standings as results come in.`
            : `${currentRace.race_name} is locked. Check the leaderboard once results are posted.`,
          href: currentPick ? `/leaderboard?tab=picks&race_id=${currentRace.id}` : "/leaderboard",
          label: currentPick ? "View locked picks" : "View leaderboard",
          status: "Locked",
          title: currentPick ? "Picks saved and locked" : "Race is locked"
        }
      : {
          body: currentPick
            ? `${currentRace.race_name} is open. You can review or adjust before lock.`
            : `${currentRace.race_name} is open. Submit your picks before lock.`,
          href: "/picks",
          label: currentPick ? "Review picks" : "Make picks",
          status: currentPick ? "Saved" : "Open",
          title: currentPick ? "Your next action is review" : "Your next action is pick"
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

      <section className="mt-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Quick Actions</h2>
            <p className="mt-1 text-sm text-slate-600">Jump into the race-week work that matters.</p>
          </div>
          <div className="shrink-0 rounded-lg border border-slate-300 bg-white p-1 shadow-sm">
            <div
              aria-hidden
              className="h-16 w-16 rounded-md border border-slate-200 bg-slate-200 bg-cover bg-center"
              style={{ backgroundImage: `url('${MOUND_HOUND_IMAGE_PATH}')` }}
            />
          </div>
        </div>

        <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-base font-semibold text-slate-900">{raceAction.title}</h3>
                <span className="rounded-full border border-cyan-200 bg-cyan-50 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-cyan-800">
                  {raceAction.status}
                </span>
              </div>
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
            className="group rounded-lg bg-slate-900 px-4 py-3 text-sm font-semibold text-white hover:bg-slate-700"
            href="/picks"
          >
            <span className="flex items-center justify-between gap-3">
              Pick&apos;em Form
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
