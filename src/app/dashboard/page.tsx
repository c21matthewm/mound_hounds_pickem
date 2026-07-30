import Link from "next/link";
import { AuthenticatedPageShell } from "@/components/authenticated-page-shell";
import { MobileBottomNav } from "@/components/mobile-bottom-nav";
import { SignOutButton } from "@/components/sign-out-button";
import {
  ActionLink,
  CompactNotice,
  DetailGrid,
  MetricStrip,
  SectionHeader,
  StatusChip,
  type StatusTone
} from "@/components/ui-primitives";
import { MOUND_HOUND_IMAGE_PATH } from "@/lib/branding";
import { requireAppUser } from "@/lib/authenticated-user";
import { pickWindowRoundLabel } from "@/lib/pick-windows";
import { queryStringParam } from "@/lib/query";
import { raceContextLabel } from "@/lib/race-label";
import { loadRaceWeekState, type RaceWeekStatus } from "@/lib/race-week";
import { formatLeagueDateTime } from "@/lib/timezone";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const statusTone = (status: RaceWeekStatus): StatusTone => {
  if (status === "form_open") {
    return "info";
  }
  if (status === "picks_saved") {
    return "success";
  }
  if (status === "waiting_results" || status === "registration_required") {
    return "warning";
  }
  return "neutral";
};

const formatDateTime = (value: string): string =>
  formatLeagueDateTime(value, { dateStyle: "medium", timeStyle: "short" });

export default async function DashboardPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const message = queryStringParam(params.message);
  const { activeSeason, participation, profile, supabase, user } = await requireAppUser({
    requireSeasonDecision: true
  });
  const raceWeek = await loadRaceWeekState({
    activeSeason,
    isAdmin: profile.role === "admin",
    participation,
    supabase,
    userId: user.id
  });
  const { action, currentRace } = raceWeek;

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
        <CompactNotice className="mt-5" tone="success">
          {message}
        </CompactNotice>
      ) : null}

      <section aria-label="Current race status" className="mt-5">
        <div className="flex min-w-0 items-start gap-3">
          <div className="shrink-0 rounded-lg border border-slate-200 bg-white p-1 shadow-sm">
            <div
              aria-hidden
              className="h-[88px] w-[88px] rounded-md bg-slate-200 bg-cover bg-center"
              style={{
                backgroundImage: `url('${MOUND_HOUND_IMAGE_PATH}')`,
                backgroundPosition: "50% 38%"
              }}
            />
          </div>

          <div className="min-w-0 flex-1 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
            <div className="p-3 sm:p-4">
              <div className="flex min-w-0 items-start justify-between gap-2 sm:gap-3">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <h2 className="text-base font-semibold text-slate-950">{action.title}</h2>
                  <StatusChip tone={statusTone(action.status)}>{action.statusLabel}</StatusChip>
                </div>
                <ActionLink className="shrink-0" href={action.href}>
                  {action.label}
                </ActionLink>
              </div>
              {currentRace && activeSeason ? (
                <div className="mt-1.5 min-w-0">
                  <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    {raceWeek.isDoubleheader
                      ? `${activeSeason.seasonYear} · ${pickWindowRoundLabel(raceWeek.races)} · Doubleheader`
                      : raceContextLabel({
                          roundNumber: currentRace.round_number,
                          seasonYear: activeSeason.seasonYear
                        })}
                  </p>
                  <p className="mt-0.5 text-sm font-medium leading-5 text-slate-800">
                    {currentRace.race_name}
                  </p>
                </div>
              ) : null}
              <p className="mt-2 text-sm leading-5 text-slate-600">{action.body}</p>

              {action.status === "form_open" && currentRace && raceWeek.pickLockAt ? (
                <div className="mt-3 border-t border-slate-100 pt-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    Pick deadline
                  </p>
                  <p className="mt-0.5 text-xs font-semibold leading-5 text-slate-800">
                    {formatDateTime(raceWeek.pickLockAt)}
                  </p>
                </div>
              ) : null}
            </div>

            {raceWeek.isDoubleheader ? (
              <div className="border-t border-slate-200 px-3 py-3 sm:px-4">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  Weekend forms
                </p>
                <div className="mt-2 grid gap-2">
                  {raceWeek.races.map((race) => {
                    const saved = raceWeek.pickByRaceId.has(race.id);
                    return (
                      <Link
                        className="flex min-w-0 items-center justify-between gap-2 rounded-md border border-slate-200 px-3 py-2 hover:bg-slate-50"
                        href={`/picks?race_id=${race.id}`}
                        key={race.id}
                      >
                        <span className="min-w-0 text-sm font-semibold leading-5 text-slate-900">
                          R{race.round_number} · {race.race_name}
                        </span>
                        <StatusChip className="shrink-0" tone={saved ? "success" : "warning"}>
                          {saved ? "Saved" : "Open"}
                        </StatusChip>
                      </Link>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </div>
        </div>

        <nav aria-label="Primary destinations" className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <ActionLink className="w-full" href="/picks">
            Pick&apos;em
          </ActionLink>
          <ActionLink className="w-full" href="/leaderboard">
            Leaderboard
          </ActionLink>
          <ActionLink className="w-full" href="/more">
            More
          </ActionLink>
          {profile.role === "admin" ? (
            <ActionLink className="w-full" href="/admin">
              Admin
            </ActionLink>
          ) : (
            <ActionLink className="w-full" href="/rules">
              Rules
            </ActionLink>
          )}
        </nav>
      </section>

      <section className="mt-6 border-t border-slate-200 pt-5">
        <SectionHeader
          action={
            activeSeason ? (
              <StatusChip tone="success">{activeSeason.seasonYear} Season</StatusChip>
            ) : null
          }
          title="Profile"
        />
        <DetailGrid
          className="mt-3"
          items={[
            {
              label: "Name",
              value: profile.full_name
            },
            {
              label: "Team",
              value: profile.team_name
            },
            {
              label: "Email",
              value: user.email ?? "-",
              valueClassName: "break-all"
            }
          ]}
        />
      </section>

      {raceWeek.adminReadiness && currentRace ? (
        <section className="mt-6 border-t border-slate-300 pt-5">
          <SectionHeader
            action={
              <ActionLink href="/admin?tab=health" variant="quiet">
                System health
              </ActionLink>
            }
            description="Current race-week operational status."
            title="Admin Readiness"
          />
          <MetricStrip
            className="mt-3 grid-cols-2 sm:grid-cols-4"
            items={[
              {
                label: "Previous results",
                value: raceWeek.previousResultsBlocked ? "Action needed" : "Ready"
              },
              {
                label: "Race field",
                value:
                  raceWeek.adminReadiness.frozenRaceCount === raceWeek.races.length
                    ? `${raceWeek.adminReadiness.fieldDriverCount} slots frozen`
                    : "Not frozen"
              },
              {
                label: "Submissions",
                value: `${raceWeek.adminReadiness.pickCount}/${
                  raceWeek.adminReadiness.registeredTeamCount * raceWeek.races.length
                }`
              },
              {
                label: "Results",
                value: `${raceWeek.races.filter((race) => race.results_status === "published").length}/${raceWeek.races.length} posted`
              }
            ]}
          />
        </section>
      ) : null}

      <MobileBottomNav />
    </AuthenticatedPageShell>
  );
}
