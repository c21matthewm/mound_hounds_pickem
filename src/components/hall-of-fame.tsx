import Link from "next/link";
import { HallOfFameYearSelect } from "@/components/hall-of-fame-year-select";
import {
  ActionLink,
  CompactNotice,
  ContentPanel,
  EmptyState,
  RankBadge
} from "@/components/ui-primitives";
import type { HallOfFameSeason } from "@/lib/hall-of-fame";
import { getHallOfFameSeasonStats } from "@/lib/hall-of-fame-stats";

type Props = {
  seasons: HallOfFameSeason[];
  selectedYear?: number;
};

const wholeNumber = new Intl.NumberFormat("en-US");
const averageNumber = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});

const seasonHref = (year: number): string => `/leaderboard?tab=hall&year=${year}`;

function ChampionCard({
  season,
  showStandingsLink = true
}: {
  season: HallOfFameSeason;
  showStandingsLink?: boolean;
}) {
  const { pointsPerRace, winningMargin } = getHallOfFameSeasonStats(season);
  const Heading = showStandingsLink ? "h3" : "h2";

  return (
    <ContentPanel className="flex min-w-0 flex-col">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-800">
          <svg aria-hidden="true" fill="none" height="22" viewBox="0 0 24 24" width="22">
            <path
              d="M8 3h8v5a4 4 0 0 1-8 0V3Zm0 2H4v2a4 4 0 0 0 4 4m8-6h4v2a4 4 0 0 1-4 4m-4 1v5m-4 3h8m-8 0v-1a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v1"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="1.7"
            />
          </svg>
        </span>
        <p className="text-xs font-bold uppercase tracking-wider text-slate-600">
          {season.seasonYear} Champion
        </p>
      </div>

      <Heading className="mt-4 min-w-0 text-2xl font-semibold leading-tight tracking-tight text-slate-950 [overflow-wrap:anywhere]">
        {season.championTeamName}
      </Heading>

      <dl className={`mt-5 grid min-w-0 grid-cols-2 gap-x-4 gap-y-4 ${showStandingsLink ? "" : "sm:grid-cols-4"}`}>
        <div className="min-w-0">
          <dt className="text-xs font-medium text-slate-600">Total Points</dt>
          <dd className="mt-1 text-2xl font-semibold tabular-nums text-slate-950 [overflow-wrap:anywhere]">
            {wholeNumber.format(season.championTotalPoints)}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs font-medium text-slate-600">Points per Race</dt>
          <dd className="mt-1 text-2xl font-semibold tabular-nums text-cyan-800 [overflow-wrap:anywhere]">
            {pointsPerRace === null ? "—" : averageNumber.format(pointsPerRace)}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-medium text-slate-600">Races</dt>
          <dd className="mt-1 font-semibold tabular-nums text-slate-900">{season.raceCount}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium text-slate-600">Field Size</dt>
          <dd className="mt-1 font-semibold tabular-nums text-slate-900">{wholeNumber.format(season.participantCount)}</dd>
        </div>
      </dl>

      {winningMargin !== null ? (
        <p className="mt-5 border-t border-slate-200 pt-4 text-sm font-medium text-slate-700">
          {winningMargin === 0
            ? "Won on tiebreak"
            : `Won by ${wholeNumber.format(winningMargin)} ${winningMargin === 1 ? "point" : "points"}`}
        </p>
      ) : null}

      {showStandingsLink ? (
        <div className="mt-auto pt-5">
          <ActionLink className="w-full gap-2 text-center" href={seasonHref(season.seasonYear)} variant="secondary">
            View {season.seasonYear} final standings <span aria-hidden="true">→</span>
          </ActionLink>
        </div>
      ) : null}
    </ContentPanel>
  );
}

function ChampionsComparison({ seasons }: { seasons: HallOfFameSeason[] }) {
  return (
    <ContentPanel className="min-w-0" aria-labelledby="champions-comparison-title">
      <h2 className="text-lg font-semibold text-slate-950" id="champions-comparison-title">Compare champions</h2>
      <p className="mt-1 text-sm leading-6 text-slate-600" id="champions-comparison-note">
        Points per race accounts for season length. Scoring rules may differ between seasons.
      </p>
      <p className="mt-3 text-xs text-slate-500 md:hidden">Scroll the table to compare every statistic.</p>
      <div
        aria-describedby="champions-comparison-note"
        aria-label="Champions comparison"
        className="relative mt-3 max-w-full overflow-x-auto rounded-md border border-slate-200 focus-visible:outline-2 focus-visible:outline-blue-700"
        role="region"
        tabIndex={0}
      >
        <table className="w-full min-w-[740px] table-fixed text-left text-sm">
          <caption className="sr-only">Season champions and championship statistics</caption>
          <colgroup>
            <col className="w-20" />
            <col />
            <col className="w-24" />
            <col className="w-28" />
            <col className="w-20" />
            <col className="w-24" />
            <col className="w-28" />
          </colgroup>
          <thead className="ui-table-head bg-slate-50 text-slate-700">
            <tr>
              <th className="px-3 py-3 font-semibold" scope="col">Season</th>
              <th className="px-3 py-3 font-semibold" scope="col">Champion</th>
              <th className="px-3 py-3 text-right font-semibold" scope="col">Total Points</th>
              <th className="px-3 py-3 text-right font-semibold" scope="col">Points per Race</th>
              <th className="px-3 py-3 text-right font-semibold" scope="col">Races</th>
              <th className="px-3 py-3 text-right font-semibold" scope="col">Field Size</th>
              <th className="px-3 py-3 text-right font-semibold" scope="col">Winning Margin</th>
            </tr>
          </thead>
          <tbody>
            {seasons.map((season) => {
              const { pointsPerRace, winningMargin } = getHallOfFameSeasonStats(season);
              return (
                <tr className="border-t border-slate-200" key={season.seasonId}>
                  <th className="px-3 py-3 text-left font-semibold" scope="row">
                    <Link aria-label={`View ${season.seasonYear} final standings`} className="inline-flex min-h-10 items-center text-blue-700 underline underline-offset-4" href={seasonHref(season.seasonYear)}>
                      {season.seasonYear}
                    </Link>
                  </th>
                  <td className="px-3 py-3 font-medium text-slate-950 [overflow-wrap:anywhere]">
                    {season.championTeamName}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums">{wholeNumber.format(season.championTotalPoints)}</td>
                  <td className="px-3 py-3 text-right font-semibold tabular-nums">{pointsPerRace === null ? "—" : averageNumber.format(pointsPerRace)}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{season.raceCount}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{wholeNumber.format(season.participantCount)}</td>
                  <td className="px-3 py-3 text-right tabular-nums">
                    {winningMargin === null ? "—" : winningMargin === 0 ? "Won on tiebreak" : `${wholeNumber.format(winningMargin)} pts`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </ContentPanel>
  );
}

function SeasonStandings({ season }: { season: HallOfFameSeason }) {
  return (
    <ContentPanel className="min-w-0" aria-labelledby="archived-standings-title">
      <h2 className="text-lg font-semibold text-slate-950" id="archived-standings-title">
        {season.seasonYear} final standings
      </h2>
      {season.entries.length === 0 ? (
        <EmptyState className="mt-4" title="Full standings are not available yet" description="This season’s champion has been recorded. The complete finishing order will appear here when it is added." />
      ) : (
        <div className="mt-4 min-w-0 rounded-md border border-slate-200">
          <table className="w-full table-fixed text-left text-sm">
            <caption className="sr-only">{season.seasonYear} final season standings</caption>
            <colgroup>
              <col className="w-12 sm:w-20" />
              <col />
              <col className="w-20 sm:w-32" />
            </colgroup>
            <thead className="ui-table-head bg-slate-50 text-slate-700">
              <tr>
                <th className="px-2 py-3 font-semibold sm:px-3" scope="col">Rank</th>
                <th className="px-2 py-3 font-semibold sm:px-3" scope="col">Team</th>
                <th className="px-2 py-3 text-right font-semibold sm:px-3" scope="col">
                  <span className="sm:hidden">Points</span><span className="hidden sm:inline">Total Points</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {season.entries.map((entry) => (
                <tr className="border-t border-slate-200" key={`${entry.finalRank}-${entry.teamName}`}>
                  <td className="px-2 py-3 align-top sm:px-3">
                    <RankBadge aria-label={`Final rank ${entry.finalRank}`} rank={entry.finalRank} showNumberSign />
                  </td>
                  <th className="px-2 py-3 text-left align-top font-medium leading-6 text-slate-950 [overflow-wrap:anywhere] sm:px-3" scope="row">
                    {entry.teamName}
                  </th>
                  <td className="whitespace-nowrap px-2 py-3 text-right align-top font-semibold leading-6 tabular-nums text-slate-900 sm:px-3">
                    {wholeNumber.format(entry.totalPoints)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </ContentPanel>
  );
}

export function HallOfFame({ seasons, selectedYear }: Props) {
  const orderedSeasons = [...seasons].sort((left, right) => right.seasonYear - left.seasonYear);
  const selectedSeason = orderedSeasons.find((season) => season.seasonYear === selectedYear);

  if (selectedSeason) {
    return (
      <div className="mt-6 min-w-0 space-y-5">
        <div className="flex min-w-0 flex-wrap items-end justify-between gap-3">
          <ActionLink href="/leaderboard?tab=hall" variant="secondary">
            <span aria-hidden="true" className="mr-2">←</span> All champions
          </ActionLink>
          <HallOfFameYearSelect key={selectedSeason.seasonYear} selectedYear={selectedSeason.seasonYear} years={orderedSeasons.map((season) => season.seasonYear)} />
        </div>
        <ChampionCard season={selectedSeason} showStandingsLink={false} />
        <SeasonStandings season={selectedSeason} />
      </div>
    );
  }

  return (
    <div className="mt-6 min-w-0 space-y-6">
      {selectedYear !== undefined ? (
        <CompactNotice tone="info">The {selectedYear} season is not in the archive yet. Choose an available season below.</CompactNotice>
      ) : null}
      <section aria-labelledby="past-champions-title" className="min-w-0">
        <h2 className="text-lg font-semibold text-slate-950" id="past-champions-title">Past champions</h2>
        <p className="mt-1 text-sm leading-6 text-slate-600">Explore each championship and the complete final standings.</p>
        <div className="mt-4 grid min-w-0 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {orderedSeasons.map((season) => <ChampionCard key={season.seasonId} season={season} />)}
        </div>
      </section>
      {orderedSeasons.length > 1 ? <ChampionsComparison seasons={orderedSeasons} /> : null}
    </div>
  );
}
