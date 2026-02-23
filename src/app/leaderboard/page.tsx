import Link from "next/link";
import { redirect } from "next/navigation";
import { signOutAction } from "@/app/actions/auth";
import { MobileBottomNav } from "@/components/mobile-bottom-nav";
import {
  PicksByRaceTable,
  type PicksByRaceTableRow
} from "@/components/picks-by-race-table";
import {
  StandingsTable,
  type StandingsTableRaceColumn,
  type StandingsTableRow
} from "@/components/standings-table";
import { isProfileComplete, type ProfileRow } from "@/lib/profile";
import { queryStringParam } from "@/lib/query";
import { buildLeagueScoringSnapshot, buildPicksByRaceSnapshot } from "@/lib/scoring";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { formatLeagueDateTime, LEAGUE_TIME_ZONE } from "@/lib/timezone";

export const dynamic = "force-dynamic";

type LeaderboardTab = "standings" | "picks";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const formatRaceDate = (value: string): string =>
  formatLeagueDateTime(value, { dateStyle: "medium", timeStyle: "short" });

const parseLeaderboardTab = (value: string | undefined): LeaderboardTab =>
  value === "picks" ? "picks" : "standings";

const parseRaceId = (value: string | undefined): number | undefined => {
  if (!value) {
    return undefined;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return undefined;
  }

  return parsed;
};

const tabHref = (tab: LeaderboardTab, raceId?: number): string => {
  const params = new URLSearchParams({ tab });

  if (raceId) {
    params.set("race_id", String(raceId));
  }

  return `/leaderboard?${params.toString()}`;
};

export default async function LeaderboardPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const activeTab = parseLeaderboardTab(queryStringParam(params.tab));
  const selectedRaceId = parseRaceId(queryStringParam(params.race_id));

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

  let standingsSnapshot: Awaited<ReturnType<typeof buildLeagueScoringSnapshot>> | null = null;
  let picksSnapshot: Awaited<ReturnType<typeof buildPicksByRaceSnapshot>> | null = null;
  try {
    if (activeTab === "picks") {
      picksSnapshot = await buildPicksByRaceSnapshot(selectedRaceId);
    } else {
      standingsSnapshot = await buildLeagueScoringSnapshot();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown scoring error.";

    return (
      <main className="mx-auto flex min-h-screen max-w-4xl flex-col px-6 py-16">
        <h1 className="text-3xl font-semibold tracking-tight">Leaderboard</h1>
        <p className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          Failed to load leaderboard: {message}
        </p>
        <Link className="mt-4 text-sm font-semibold text-slate-900 underline" href="/dashboard">
          Back to dashboard
        </Link>
      </main>
    );
  }

  const picksTableRows: PicksByRaceTableRow[] = picksSnapshot
    ? picksSnapshot.rows.map((row, index) => ({
      averageSpeed: row.averageSpeed,
      drivers: row.driverCells.map((cell) => ({
        driverName: cell.driverName,
        points: cell.points
      })),
      rank: picksSnapshot.resultsPosted ? index + 1 : null,
      teamName: row.teamName,
      totalPoints: row.totalPoints,
      userId: row.userId
    }))
    : [];

  const standingsRaceColumns: StandingsTableRaceColumn[] = standingsSnapshot
    ? standingsSnapshot.raceColumns.map((column) => ({
      raceId: column.raceId,
      raceName: column.raceName
    }))
    : [];

  const standingsTableRows: StandingsTableRow[] = standingsSnapshot
    ? standingsSnapshot.leaderboardRows.map((row) => ({
      change: row.change,
      currentStanding: row.currentStanding,
      previousStanding: row.previousStanding,
      racePointsByRaceId: standingsSnapshot.raceColumns.reduce<Record<number, number>>(
        (accumulator, column) => {
          accumulator[column.raceId] = row.raceBreakdown.get(column.raceId) ?? 0;
          return accumulator;
        },
        {}
      ),
      teamName: row.teamName,
      totalPoints: row.totalPoints,
      trend: row.trend,
      userId: row.userId
    }))
    : [];

  return (
    <main className="mx-auto flex min-h-screen max-w-[1200px] flex-col px-6 py-10 pb-24 md:pb-10">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="inline-flex rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-blue-700">
            League Data
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight">Season Leaderboard</h1>
          <p className="mt-2 text-sm text-slate-600">
            Standings, movement, and locked picks by race.
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
            href="/picks"
          >
            Pick&apos;em Form
          </Link>
          <form action={signOutAction}>
            <button
              className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
              type="submit"
            >
              Sign out
            </button>
          </form>
        </div>
      </header>

      <nav className="mt-6">
        <ul className="inline-flex rounded-md border border-slate-300 bg-white p-1 text-sm">
          <li>
            <Link
              className={`rounded px-3 py-1.5 font-medium ${
                activeTab === "standings" ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-100"
              }`}
              href={tabHref("standings")}
            >
              Standings
            </Link>
          </li>
          <li>
            <Link
              className={`rounded px-3 py-1.5 font-medium ${
                activeTab === "picks" ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-100"
              }`}
              href={tabHref("picks", picksSnapshot?.selectedRace?.raceId)}
            >
              Picks by Race
            </Link>
          </li>
        </ul>
      </nav>

      {activeTab === "standings" && standingsSnapshot ? (
        standingsSnapshot.raceColumns.length === 0 ? (
          <p className="mt-6 rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
            No completed races with results yet. Add race results in admin to populate standings.
          </p>
        ) : (
          <>
            <StandingsTable raceColumns={standingsRaceColumns} rows={standingsTableRows} />

            {standingsSnapshot.latestRaceScoreboard ? (
              <section className="mt-8 rounded-lg border border-slate-200 bg-white p-6">
                <h2 className="text-xl font-semibold text-slate-900">
                  Latest Race: {standingsSnapshot.latestRaceScoreboard.raceName}
                </h2>
                <p className="mt-1 text-sm text-slate-600">
                  {formatRaceDate(standingsSnapshot.latestRaceScoreboard.raceDate)}
                </p>
                <p className="mt-1 text-xs text-slate-500">Times shown in {LEAGUE_TIME_ZONE}.</p>

                <div className="mt-4 overflow-x-auto rounded-md border border-slate-200">
                  <table className="min-w-full text-left text-sm">
                    <thead className="bg-slate-50 text-slate-700">
                      <tr>
                        <th className="px-3 py-2 font-semibold">Row</th>
                        <th className="px-3 py-2 font-semibold">Race Points</th>
                        <th className="px-3 py-2 font-semibold">Average Speed</th>
                      </tr>
                    </thead>
                    <tbody>
                      {standingsSnapshot.latestRaceScoreboard.rows.map((row, index) => (
                        <tr key={`${row.rowType}-${row.teamName}-${index}`} className="border-t border-slate-200">
                          <td className="px-3 py-2">{row.teamName}</td>
                          <td className="px-3 py-2 font-semibold">{row.points}</td>
                          <td className="px-3 py-2">
                            {row.averageSpeed !== null ? row.averageSpeed.toFixed(3) : "-"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            ) : null}
          </>
        )
      ) : null}

      {activeTab === "picks" && picksSnapshot ? (
        picksSnapshot.availableRaces.length === 0 ? (
          <section className="mt-6 rounded-lg border border-slate-200 bg-white p-6">
            <h2 className="text-xl font-semibold text-slate-900">Picks by Race</h2>
            <p className="mt-2 text-sm text-slate-700">
              No races are available yet. A race appears here only after qualifying has started and
              picks are locked.
            </p>
          </section>
        ) : (
          <>
            <section className="mt-6 rounded-lg border border-slate-200 bg-white p-6">
              <div className="flex flex-wrap items-end gap-3">
                <div className="min-w-[280px] flex-1">
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">
                    Select race
                  </label>
                  <form action="/leaderboard" className="flex flex-wrap items-center gap-2" method="get">
                    <input name="tab" type="hidden" value="picks" />
                    <select
                      className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                      defaultValue={String(picksSnapshot.selectedRace?.raceId ?? "")}
                      name="race_id"
                    >
                      {picksSnapshot.availableRaces.map((race) => (
                        <option key={race.raceId} value={race.raceId}>
                          {race.raceName} (Lock: {formatRaceDate(race.qualifyingStartAt)})
                        </option>
                      ))}
                    </select>
                    <button
                      className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
                      type="submit"
                    >
                      Load race
                    </button>
                  </form>
                </div>
              </div>

              {picksSnapshot.selectedRace ? (
                <div className="mt-4 text-sm text-slate-700">
                  <p>
                    <span className="font-semibold">{picksSnapshot.selectedRace.raceName}</span>
                  </p>
                  <p>Qualifying (Pick Lock): {formatRaceDate(picksSnapshot.selectedRace.qualifyingStartAt)}</p>
                  <p>Race Start: {formatRaceDate(picksSnapshot.selectedRace.raceDate)}</p>
                  <p className="mt-1 text-xs text-slate-500">Times shown in {LEAGUE_TIME_ZONE}.</p>
                </div>
              ) : null}
            </section>
            <PicksByRaceTable resultsPosted={picksSnapshot.resultsPosted} rows={picksTableRows} />
          </>
        )
      ) : null}

      <MobileBottomNav />
    </main>
  );
}
