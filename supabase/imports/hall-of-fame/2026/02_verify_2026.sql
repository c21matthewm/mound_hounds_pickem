-- Read-only verification of the approved 2026 Hall of Fame import.
-- Always returns one row. Run independently after importing or to check an existing archive.
with archive as (
  select
    season.season_year, season.champion_team_name, season.champion_total_points,
    season.participant_count, season.race_count,
    count(entry.id) as imported_entries,
    count(distinct entry.final_rank) as unique_ranks,
    min(entry.final_rank) as first_rank,
    max(entry.final_rank) as last_rank,
    sum(entry.total_points) as combined_points,
    count(*) filter (
      where entry.final_rank = 1
        and entry.team_name = season.champion_team_name
        and entry.total_points = season.champion_total_points
    ) as matching_champions,
    count(entry.id) filter (where entry.race_breakdown = '[]'::jsonb) as empty_breakdowns,
    md5(string_agg(entry.final_rank::text || ':' || entry.team_name || ':' || entry.total_points::text,
      E'\n' order by entry.final_rank)) as standings_fingerprint
  from public.hall_of_fame_seasons season
  left join public.hall_of_fame_entries entry on entry.season_id = season.id
  where season.season_year = 2026
  group by season.id
)
select
  case
    when archive.season_year is null then 'NOT IMPORTED'
    when champion_team_name = 'Matt - Team Nash'
      and champion_total_points = 2684
      and participant_count = 78 and race_count = 18
      and imported_entries = 78 and unique_ranks = 78
      and first_rank = 1 and last_rank = 78
      and combined_points = 173961 and matching_champions = 1
      and empty_breakdowns = 78
      and standings_fingerprint = '660248340bf21c2c791ee8c19262dab3'
    then 'PASS'
    else 'CHECK IMPORT'
  end as verification_status,
  2026 as season_year,
  champion_team_name,
  champion_total_points,
  race_count,
  coalesce(imported_entries, 0) as imported_entries,
  round(champion_total_points::numeric / nullif(race_count, 0), 2) as champion_points_per_race,
  combined_points
from (values (1)) as expected(row_exists)
left join archive on true;
