import Link from "next/link";
import { RaceWeekSummary } from "@/components/race-week-summary";
import { AuthenticatedPageShell } from "@/components/authenticated-page-shell";
import {
  ActionLink,
  CompactNotice,
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

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const statusTone = (status: RaceWeekStatus): StatusTone => {
  if (status === "form_open" || status === "form_pending" || status === "season_results_pending") {
    return "info";
  }
  if (status === "picks_saved" || status === "season_complete") {
    return "success";
  }
  if (status === "waiting_results" || status === "registration_required") {
    return "warning";
  }
  return "neutral";
};

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
  const context = currentRace && activeSeason
    ? raceWeek.isDoubleheader
      ? activeSeason.seasonYear + " · " + pickWindowRoundLabel(raceWeek.races) + " · Doubleheader"
      : raceContextLabel({ roundNumber: currentRace.round_number, seasonYear: activeSeason.seasonYear })
    : undefined;
  const timing = action.status === "form_pending" && raceWeek.pickOpenAt
    ? { label: "Picks open", dateTime: raceWeek.pickOpenAt }
    : (action.status === "form_open" || action.status === "picks_saved" || action.status === "locked") && raceWeek.pickLockAt
      ? { label: action.status === "picks_saved" ? "Editable until" : "Pick deadline", dateTime: raceWeek.pickLockAt }
      : undefined;

  return (
    <AuthenticatedPageShell
      description={
        <>
          Signed in as <span className="font-semibold text-slate-900">{profile.team_name}</span>.
        </>
      }
      maxWidth="max-w-5xl"
      title="Dashboard"
    >
      {message ? (
        <CompactNotice className="mt-5" tone="success">
          {message}
        </CompactNotice>
      ) : null}

      <RaceWeekSummary
        action={<ActionLink className="w-full sm:w-auto" href={action.href}>{action.label}</ActionLink>}
        mascot={MOUND_HOUND_IMAGE_PATH}
        context={context}
        description={action.body}
        status={action.statusLabel}
        timing={timing}
        title={currentRace?.race_name ?? action.title}
        tone={statusTone(action.status)}
      >
        {raceWeek.isDoubleheader ? (
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Weekend forms
            </p>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {raceWeek.races.map((race) => {
                const saved = raceWeek.pickByRaceId.has(race.id);
                const label = saved
                  ? action.status === "locked" ? "Saved & locked" : "Saved"
                  : action.status === "form_open" ? "Open" : action.statusLabel;
                return (
                  <Link
                    className="flex min-w-0 items-center justify-between gap-2 rounded-md border border-slate-200 min-h-11 flex-wrap px-3 py-2 hover:bg-slate-50"
                    href={`/picks?race_id=${race.id}`}
                    key={race.id}
                  >
                    <span className="min-w-0 text-sm font-semibold leading-5 text-slate-900">
                      R{race.round_number} · {race.race_name}
                    </span>
                    <StatusChip className="shrink-0" tone={saved ? "success" : statusTone(action.status)}>
                      {label}
                    </StatusChip>
                  </Link>
                );
              })}
            </div>
          </div>
        ) : null}
      </RaceWeekSummary>

      <nav aria-label="League resources" className="mt-3 flex flex-wrap gap-x-2">
        <ActionLink href="/rules" variant="quiet">Rules</ActionLink>
        <ActionLink href="/more" variant="quiet">More</ActionLink>
        {profile.role === "admin" ? <ActionLink href="/admin" variant="quiet">Admin</ActionLink> : null}
      </nav>

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
    </AuthenticatedPageShell>
  );
}
