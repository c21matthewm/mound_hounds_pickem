import Link from "next/link";
import { redirect } from "next/navigation";
import { MobileBottomNav } from "@/components/mobile-bottom-nav";
import { PickSubmissionSnapshot } from "@/components/pick-submission-snapshot";
import { SignOutButton } from "@/components/sign-out-button";
import { saveWeeklyPickAction } from "@/app/picks/actions";
import { PickemForm } from "@/components/pickem-form";
import { isProfileComplete, type ProfileRow } from "@/lib/profile";
import { queryStringParam } from "@/lib/query";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import {
  formatLeagueDateTime,
  getLeagueSeasonDateRange,
  LEAGUE_TIME_ZONE
} from "@/lib/timezone";

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
  payout: number | string;
  qualifying_start_at: string;
  race_date: string;
  race_name: string;
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
  id: number;
  updated_at: string;
};

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const GROUP_NUMBERS = [1, 2, 3, 4, 5, 6] as const;

const formatRaceDate = (value: string): string =>
  formatLeagueDateTime(value, { dateStyle: "full", timeStyle: "short" });

const selectedByGroup = (pick: PickRow | null): Record<number, number | null> => ({
  1: pick?.driver_group1_id ?? null,
  2: pick?.driver_group2_id ?? null,
  3: pick?.driver_group3_id ?? null,
  4: pick?.driver_group4_id ?? null,
  5: pick?.driver_group5_id ?? null,
  6: pick?.driver_group6_id ?? null
});

export default async function PicksPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const error = queryStringParam(params.error);

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
    .maybeSingle<ProfileRow>();

  if (!profile || !isProfileComplete(profile)) {
    redirect("/onboarding");
  }

  const now = new Date();
  const nowIso = now.toISOString();
  const seasonRange = getLeagueSeasonDateRange();

  let upcomingRace: RaceRow | null = null;
  {
    const { data: seasonUpcomingRace } = await supabase
      .from("races")
      .select("id,race_name,title_image_url,qualifying_start_at,race_date,payout")
      .eq("is_archived", false)
      .gte("race_date", seasonRange.seasonStartIso)
      .lt("race_date", seasonRange.seasonEndExclusiveIso)
      .gt("race_date", nowIso)
      .order("race_date", { ascending: true })
      .limit(1)
      .maybeSingle<RaceRow>();

    upcomingRace = seasonUpcomingRace ?? null;
  }

  if (!upcomingRace) {
    const { data: fallbackUpcomingRace } = await supabase
      .from("races")
      .select("id,race_name,title_image_url,qualifying_start_at,race_date,payout")
      .eq("is_archived", false)
      .gt("race_date", nowIso)
      .order("race_date", { ascending: true })
      .limit(1)
      .maybeSingle<RaceRow>();

    upcomingRace = fallbackUpcomingRace ?? null;
  }

  if (!upcomingRace) {
    return (
      <main className="mx-auto flex min-h-screen max-w-4xl flex-col px-6 py-16">
        <header className="relative flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-3xl font-semibold tracking-tight">Pick&apos;em Form</h1>
          <div className="flex items-center gap-2">
            <SignOutButton />
          </div>
        </header>
        <p className="mt-4 rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
          No future race is scheduled yet for the {seasonRange.seasonYear} season. Add a race in
          admin with a start date in the future.
        </p>
        <Link className="mt-4 text-sm font-semibold text-slate-900 underline" href="/dashboard">
          Back to dashboard
        </Link>
      </main>
    );
  }

  const [driversResponse, existingPickResponse] = await Promise.all([
    supabase
      .from("drivers")
      .select("id,driver_name,image_url,championship_points,current_standing,group_number,is_active")
      .eq("is_active", true)
      .order("group_number", { ascending: true })
      .order("current_standing", { ascending: true }),
    supabase
      .from("picks")
      .select(
        "id,driver_group1_id,driver_group2_id,driver_group3_id,driver_group4_id,driver_group5_id,driver_group6_id,average_speed,updated_at"
      )
      .eq("race_id", upcomingRace.id)
      .eq("user_id", user.id)
      .maybeSingle<PickRow>()
  ]);

  const activeDrivers: DriverRow[] = (driversResponse.data ?? []) as DriverRow[];
  const existingPick = existingPickResponse.data ?? null;
  const selectedMap = selectedByGroup(existingPick);
  const picksLocked = Date.parse(upcomingRace.qualifying_start_at) <= now.getTime();
  const driverNameById = new Map<number, string>();
  activeDrivers.forEach((driver) => {
    driverNameById.set(driver.id, driver.driver_name);
  });
  const savedPickSummary = GROUP_NUMBERS.flatMap((groupNumber) => {
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

  const driversByGroup = new Map<number, DriverRow[]>();
  GROUP_NUMBERS.forEach((groupNumber) => driversByGroup.set(groupNumber, []));
  activeDrivers.forEach((driver) => {
    const existing = driversByGroup.get(driver.group_number) ?? [];
    existing.push(driver);
    driversByGroup.set(driver.group_number, existing);
  });

  const missingGroups = GROUP_NUMBERS.filter(
    (groupNumber) => (driversByGroup.get(groupNumber) ?? []).length === 0
  );
  const canSubmit = missingGroups.length === 0 && !picksLocked;
  const pickGroups = GROUP_NUMBERS.map((groupNumber) => ({
    drivers: (driversByGroup.get(groupNumber) ?? []).map((driver) => ({
      championshipPoints: driver.championship_points,
      driverName: driver.driver_name,
      id: driver.id,
      imageUrl: driver.image_url
    })),
    groupNumber,
    isTopGroup: groupNumber <= 5
  }));

  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col px-6 py-10 pb-24 md:pb-10">
      <header className="relative flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="inline-flex rounded-full border border-cyan-200 bg-cyan-50 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-cyan-700">
            Race Picks
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight">Pick&apos;em Form</h1>
          <p className="mt-2 text-sm text-slate-600">
            Team <span className="font-semibold">{profile.team_name}</span>
          </p>
        </div>

        <div className="flex items-center gap-2">
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
          <SignOutButton />
        </div>
      </header>

      <section className="mt-6 overflow-hidden rounded-xl border border-slate-200 bg-white">
        {upcomingRace.title_image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            alt={`${upcomingRace.race_name} banner`}
            className="h-44 w-full object-cover md:h-56"
            src={upcomingRace.title_image_url}
          />
        ) : null}

        <div className="bg-gradient-to-r from-slate-900 to-slate-800 p-6 text-white">
          <h2 className="text-2xl font-semibold">{upcomingRace.race_name}</h2>
          <div className="mt-4 grid gap-2 text-sm md:grid-cols-2 lg:grid-cols-4">
            <p>
              <span className="font-semibold">Pick Deadline:</span>{" "}
              {formatRaceDate(upcomingRace.qualifying_start_at)}
            </p>
            <p>
              <span className="font-semibold">Race Start:</span>{" "}
              {formatRaceDate(upcomingRace.race_date)}
            </p>
            <p>
              <span className="font-semibold">Payout:</span> ${Number(upcomingRace.payout).toFixed(2)}
            </p>
            <p>
              <span className="font-semibold">Status:</span> {picksLocked ? "Locked" : "Open"}
            </p>
          </div>
          <p className="mt-2 text-xs text-slate-200">All race times shown in {LEAGUE_TIME_ZONE}.</p>
          <p className="mt-1 text-xs text-slate-200">
            Please visit the{" "}
            <a
              className="font-semibold text-cyan-200 underline decoration-cyan-300/70 underline-offset-2 hover:text-cyan-100"
              href="https://www.indycar.com/"
              rel="noreferrer"
              target="_blank"
            >
              official INDYCAR website
            </a>{" "}
            for additional information.
          </p>
        </div>
      </section>

      {error ? (
        <p className="mt-6 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      <PickSubmissionSnapshot
        latestSavedAt={existingPick?.updated_at ?? null}
        qualifyingStartAt={upcomingRace.qualifying_start_at}
        savedAverageSpeed={existingPick ? String(existingPick.average_speed) : null}
        savedPicks={savedPickSummary}
      />

      {missingGroups.length > 0 ? (
        <p className="mt-6 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Picks are unavailable because these groups have no active drivers:{" "}
          {missingGroups.map((group) => `Group ${group}`).join(", ")}. Update drivers in admin.
        </p>
      ) : null}
      <PickemForm
        action={saveWeeklyPickAction}
        canSubmit={canSubmit}
        existingAverageSpeed={existingPick ? String(existingPick.average_speed) : ""}
        groups={pickGroups}
        picksLocked={picksLocked}
        raceId={upcomingRace.id}
        savedSelection={selectedMap}
      />

      <MobileBottomNav />
    </main>
  );
}
