import Link from "next/link";
import { redirect } from "next/navigation";
import { MobileBottomNav } from "@/components/mobile-bottom-nav";
import { PicksRaceSelect } from "@/components/picks-race-select";
import { SignOutButton } from "@/components/sign-out-button";
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
import {
  buildLeagueScoringSnapshot,
  buildParticipantAnalyticsSnapshot,
  buildPicksByRaceSnapshot
} from "@/lib/scoring";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { formatLeagueDateTime, LEAGUE_TIME_ZONE } from "@/lib/timezone";

export const dynamic = "force-dynamic";

type LeaderboardTab = "standings" | "picks" | "analytics";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const formatRaceDate = (value: string): string =>
  formatLeagueDateTime(value, { dateStyle: "medium", timeStyle: "short" });

const parseLeaderboardTab = (value: string | undefined): LeaderboardTab =>
  value === "picks" || value === "analytics" ? value : "standings";

const formatSignedValue = (value: number, digits = 1): string =>
  `${value >= 0 ? "+" : ""}${value.toFixed(digits)}`;

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

const formatOptionalNumber = (value: number | null, digits = 1): string =>
  value !== null ? value.toFixed(digits) : "-";

const formatFinish = (finish: number | null, fieldSize: number): string =>
  finish !== null ? `${finish}/${fieldSize}` : "-";

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
  let analyticsSnapshot: Awaited<ReturnType<typeof buildParticipantAnalyticsSnapshot>> | null = null;
  try {
    if (activeTab === "picks") {
      picksSnapshot = await buildPicksByRaceSnapshot(selectedRaceId);
    } else if (activeTab === "analytics") {
      analyticsSnapshot = await buildParticipantAnalyticsSnapshot(user.id);
    } else {
      standingsSnapshot = await buildLeagueScoringSnapshot();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown scoring error.";

    return (
      <main className="mx-auto flex min-h-screen max-w-4xl flex-col px-6 py-16">
        <div className="relative">
          <SignOutButton />
        </div>
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
    ? picksSnapshot.rows.map((row) => ({
      averageSpeed: row.averageSpeed,
      drivers: row.driverCells.map((cell) => ({
        driverName: cell.driverName,
        points: cell.points
      })),
      rank: row.rank,
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
      racePointsByRaceId: standingsSnapshot.raceColumns.reduce<Record<number, number>>(
        (accumulator, column) => {
          accumulator[column.raceId] = row.raceBreakdown.get(column.raceId) ?? 0;
          return accumulator;
        },
        {}
      ),
      teamName: row.teamName,
      totalPoints: row.totalPoints,
      userId: row.userId
    }))
    : [];

  const analyticsRaceRows = analyticsSnapshot?.raceRows ?? [];
  const totalVsLeagueAverage = analyticsRaceRows.reduce(
    (sum, row) => sum + row.pointsVsRaceAverage,
    0
  );
  const aboveAverageWeekCount = analyticsRaceRows.filter(
    (row) => row.pointsVsRaceAverage > 0
  ).length;
  const bestFinish = analyticsRaceRows.reduce<number | null>((best, row) => {
    if (row.weeklyFinish === null) {
      return best;
    }

    return best === null ? row.weeklyFinish : Math.min(best, row.weeklyFinish);
  }, null);
  const recentRaceRows = analyticsRaceRows.slice(-3);
  const maxWeeklyPoints = Math.max(1, ...analyticsRaceRows.map((row) => row.weeklyPoints));
  const strongestVsFieldRace = analyticsRaceRows.reduce<
    (typeof analyticsRaceRows)[number] | null
  >((best, row) => {
    if (!best || row.pointsVsRaceAverage > best.pointsVsRaceAverage) {
      return row;
    }

    return best;
  }, null);
  const toughestVsFieldRace = analyticsRaceRows.reduce<
    (typeof analyticsRaceRows)[number] | null
  >((worst, row) => {
    if (!worst || row.pointsVsRaceAverage < worst.pointsVsRaceAverage) {
      return row;
    }

    return worst;
  }, null);

  return (
    <main className="mx-auto flex min-h-screen max-w-[1200px] flex-col px-6 py-10 pb-24 md:pb-10">
      <header className="relative flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="inline-flex rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-blue-700">
            League Data
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight">Season Leaderboard</h1>
          <p className="mt-2 text-sm text-slate-600">
            Standings, locked picks by race, and season-long performance trends.
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
          <SignOutButton />
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
          <li>
            <Link
              className={`rounded px-3 py-1.5 font-medium ${
                activeTab === "analytics" ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-100"
              }`}
              href={tabHref("analytics")}
            >
              Analytics
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
            <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex flex-wrap items-end justify-between gap-4">
                <div className="min-w-[280px] flex-1">
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">
                    Select race
                  </label>
                  <PicksRaceSelect
                    races={picksSnapshot.availableRaces.map((race) => ({
                      raceId: race.raceId,
                      raceName: race.raceName
                    }))}
                    selectedRaceId={picksSnapshot.selectedRace?.raceId ?? null}
                  />
                </div>
                <div className="rounded-xl border border-cyan-100 bg-cyan-50 px-4 py-3 text-sm text-cyan-900">
                  Picks unlock here after qualifying starts. Results add per-driver scores.
                </div>
              </div>

              {picksSnapshot.selectedRace ? (
                <div className="mt-5 grid gap-3 text-sm text-slate-700 md:grid-cols-3">
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 md:col-span-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Selected Race
                    </p>
                    <p className="mt-1 text-lg font-semibold text-slate-900">
                      {picksSnapshot.selectedRace.raceName}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">Times shown in {LEAGUE_TIME_ZONE}.</p>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-white p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Pick Lock
                    </p>
                    <p className="mt-1 font-medium text-slate-900">
                      {formatRaceDate(picksSnapshot.selectedRace.qualifyingStartAt)}
                    </p>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-white p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Race Start
                    </p>
                    <p className="mt-1 font-medium text-slate-900">
                      {formatRaceDate(picksSnapshot.selectedRace.raceDate)}
                    </p>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-white p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Results
                    </p>
                    <p className="mt-1 font-medium text-slate-900">
                      {picksSnapshot.resultsPosted ? "Posted" : "Pending"}
                    </p>
                  </div>
                </div>
              ) : null}
            </section>
            <PicksByRaceTable
              officialWinningAverageSpeed={picksSnapshot.selectedRace?.officialWinningAverageSpeed ?? null}
              resultsPosted={picksSnapshot.resultsPosted}
              rows={picksTableRows}
            />
          </>
        )
      ) : null}

      {activeTab === "analytics" && analyticsSnapshot ? (
        analyticsSnapshot.raceRows.length === 0 ? (
          <section className="mt-6 rounded-lg border border-slate-200 bg-white p-6">
            <h2 className="text-xl font-semibold text-slate-900">Your Season Analytics</h2>
            <p className="mt-2 text-sm text-slate-700">
              No completed races with results yet. Analytics will populate after the first race
              results are posted.
            </p>
          </section>
        ) : (
          <>
            <section className="mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="bg-[radial-gradient(circle_at_top_left,_#06b6d4,_transparent_35%),linear-gradient(135deg,_#0f172a,_#1e293b)] p-6 text-white">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-200">
                  Personal Analytics
                </p>
                <h2 className="mt-2 text-2xl font-semibold tracking-tight">
                  {analyticsSnapshot.teamName}
                </h2>
                <p className="mt-2 max-w-2xl text-sm text-slate-300">
                  A snapshot of your weekly finishes, pace against the field, recent form, and
                  tiebreak accuracy across completed races.
                </p>

                <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <div className="rounded-xl border border-white/15 bg-white/10 p-3 backdrop-blur">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-300">
                      Current Rank
                    </p>
                    <p className="mt-1 text-3xl font-semibold">
                      {analyticsSnapshot.summary.currentStanding !== null
                        ? `#${analyticsSnapshot.summary.currentStanding}`
                        : "-"}
                    </p>
                    <p className="text-xs text-slate-300">
                      Field of {analyticsSnapshot.summary.fieldSize}
                    </p>
                  </div>
                  <div className="rounded-xl border border-white/15 bg-white/10 p-3 backdrop-blur">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-300">
                      Total Points
                    </p>
                    <p className="mt-1 text-3xl font-semibold">
                      {analyticsSnapshot.summary.totalPoints}
                    </p>
                    <p className="text-xs text-slate-300">
                      {formatOptionalNumber(analyticsSnapshot.summary.averageWeeklyPoints)} per race
                    </p>
                  </div>
                  <div className="rounded-xl border border-white/15 bg-white/10 p-3 backdrop-blur">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-300">
                      Vs League Avg
                    </p>
                    <p className="mt-1 text-3xl font-semibold">
                      {formatSignedValue(totalVsLeagueAverage)}
                    </p>
                    <p className="text-xs text-slate-300">
                      {aboveAverageWeekCount}/{analyticsRaceRows.length} weeks above average
                    </p>
                  </div>
                  <div className="rounded-xl border border-white/15 bg-white/10 p-3 backdrop-blur">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-300">
                      Best Finish
                    </p>
                    <p className="mt-1 text-3xl font-semibold">
                      {bestFinish !== null ? `#${bestFinish}` : "-"}
                    </p>
                    <p className="text-xs text-slate-300">
                      {analyticsSnapshot.summary.weeklyWins} win(s),{" "}
                      {analyticsSnapshot.summary.topThreeFinishes} top-3
                    </p>
                  </div>
                </div>
              </div>

              <div className="grid gap-4 p-6 lg:grid-cols-[1.1fr_0.9fr]">
                <section className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-700">
                        Recent Form
                      </h3>
                      <p className="mt-1 text-xs text-slate-500">
                        Last three completed races compared with your season average.
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-lg font-semibold text-slate-900">
                        {formatOptionalNumber(analyticsSnapshot.summary.lastThreeRaceAverage)}
                      </p>
                      <p className="text-xs text-slate-500">
                        {analyticsSnapshot.summary.momentumDelta !== null
                          ? `${formatSignedValue(analyticsSnapshot.summary.momentumDelta)} vs avg`
                          : "Need more races"}
                      </p>
                    </div>
                  </div>

                  <div className="mt-4 grid gap-3">
                    {recentRaceRows.map((row) => (
                      <div key={`recent-${row.raceId}`}>
                        <div className="mb-1 flex items-center justify-between gap-2 text-xs">
                          <span className="truncate font-medium text-slate-700">{row.raceName}</span>
                          <span className="font-semibold text-slate-900">
                            {row.weeklyPoints} pts, {formatFinish(row.weeklyFinish, row.fieldSize)}
                          </span>
                        </div>
                        <div className="h-2 overflow-hidden rounded-full bg-slate-200">
                          <div
                            className="h-full rounded-full bg-cyan-500"
                            style={{
                              width: `${Math.max(8, (row.weeklyPoints / maxWeeklyPoints) * 100)}%`
                            }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </section>

                <section className="grid gap-3">
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
                      Best Week
                    </p>
                    {analyticsSnapshot.summary.bestWeek ? (
                      <p className="mt-1 text-sm font-medium text-emerald-950">
                        {analyticsSnapshot.summary.bestWeek.raceName}:{" "}
                        {analyticsSnapshot.summary.bestWeek.weeklyPoints} pts, finish{" "}
                        {formatFinish(
                          analyticsSnapshot.summary.bestWeek.weeklyFinish,
                          analyticsSnapshot.summary.bestWeek.fieldSize
                        )}
                      </p>
                    ) : (
                      <p className="mt-1 text-sm text-emerald-800">-</p>
                    )}
                  </div>
                  <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">
                      Toughest Week
                    </p>
                    {analyticsSnapshot.summary.worstWeek ? (
                      <p className="mt-1 text-sm font-medium text-amber-950">
                        {analyticsSnapshot.summary.worstWeek.raceName}:{" "}
                        {analyticsSnapshot.summary.worstWeek.weeklyPoints} pts, finish{" "}
                        {formatFinish(
                          analyticsSnapshot.summary.worstWeek.weeklyFinish,
                          analyticsSnapshot.summary.worstWeek.fieldSize
                        )}
                      </p>
                    ) : (
                      <p className="mt-1 text-sm text-amber-800">-</p>
                    )}
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-white p-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                      Tiebreak Read
                    </p>
                    <p className="mt-1 text-sm font-medium text-slate-900">
                      Average miss:{" "}
                      {formatOptionalNumber(analyticsSnapshot.summary.averageTiebreakDelta, 3)}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      Closest miss:{" "}
                      {formatOptionalNumber(analyticsSnapshot.summary.closestTiebreakDelta, 3)}
                    </p>
                  </div>
                </section>
              </div>

              <div className="grid gap-3 border-t border-slate-200 bg-slate-50 p-6 lg:grid-cols-2">
                <div className="rounded-xl border border-slate-200 bg-white p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                    Biggest Jump On The Field
                  </p>
                  <p className="mt-1 text-sm font-medium text-slate-900">
                    {strongestVsFieldRace
                      ? `${strongestVsFieldRace.raceName}: ${formatSignedValue(
                          strongestVsFieldRace.pointsVsRaceAverage
                        )} pts vs average`
                      : "-"}
                  </p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                    Biggest Miss On The Field
                  </p>
                  <p className="mt-1 text-sm font-medium text-slate-900">
                    {toughestVsFieldRace
                      ? `${toughestVsFieldRace.raceName}: ${formatSignedValue(
                          toughestVsFieldRace.pointsVsRaceAverage
                        )} pts vs average`
                      : "-"}
                  </p>
                </div>
              </div>
            </section>

            <section className="mt-6 rounded-lg border border-slate-200 bg-white p-6">
              <h3 className="text-lg font-semibold text-slate-900">Race Log</h3>
              <p className="mt-1 text-sm text-slate-600">
                Your week-by-week scorecard with finish, field comparison, and tiebreak accuracy.
              </p>
              <p className="mt-1 text-xs text-slate-500">Times shown in {LEAGUE_TIME_ZONE}.</p>
              <div className="mt-4 overflow-x-auto rounded-md border border-slate-200">
                <table className="min-w-full text-left text-sm">
                  <thead className="bg-slate-50 text-slate-700">
                    <tr>
                      <th className="px-3 py-2 font-semibold">Race</th>
                      <th className="px-3 py-2 font-semibold">Finish</th>
                      <th className="px-3 py-2 font-semibold">Race Points</th>
                      <th className="px-3 py-2 font-semibold">Vs League Avg</th>
                      <th className="px-3 py-2 font-semibold">Cumulative</th>
                      <th className="px-3 py-2 font-semibold">Scored As</th>
                      <th className="px-3 py-2 font-semibold">Tiebreak Guess</th>
                      <th className="px-3 py-2 font-semibold">Official Avg Speed</th>
                      <th className="px-3 py-2 font-semibold">Delta</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analyticsSnapshot.raceRows.map((row) => (
                      <tr key={row.raceId} className="border-t border-slate-200">
                        <td className="px-3 py-2">
                          <div className="font-medium text-slate-900">{row.raceName}</div>
                          <div className="text-xs text-slate-500">{formatRaceDate(row.raceDate)}</div>
                        </td>
                        <td className="px-3 py-2">
                          {row.weeklyFinish !== null ? `${row.weeklyFinish}/${row.fieldSize}` : "-"}
                        </td>
                        <td className="px-3 py-2 font-semibold">{row.weeklyPoints}</td>
                        <td
                          className={`px-3 py-2 font-medium ${
                            row.pointsVsRaceAverage > 0
                              ? "text-emerald-700"
                              : row.pointsVsRaceAverage < 0
                                ? "text-amber-700"
                                : "text-slate-700"
                          }`}
                        >
                          {formatSignedValue(row.pointsVsRaceAverage)}
                        </td>
                        <td className="px-3 py-2">{row.cumulativePoints}</td>
                        <td className="px-3 py-2">
                          {row.submittedPick ? (
                            <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700">
                              Submitted picks
                            </span>
                          ) : (
                            <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700">
                              Lowest score fallback
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          {row.averageSpeedGuess !== null ? row.averageSpeedGuess.toFixed(3) : "-"}
                        </td>
                        <td className="px-3 py-2">
                          {row.officialRaceAverageSpeed !== null
                            ? row.officialRaceAverageSpeed.toFixed(3)
                            : "-"}
                        </td>
                        <td className="px-3 py-2">
                          {row.tiebreakDelta !== null ? row.tiebreakDelta.toFixed(3) : "-"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )
      ) : null}

      <MobileBottomNav />
    </main>
  );
}
