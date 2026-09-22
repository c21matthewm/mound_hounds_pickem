-- Read-only verification; safe to run again after the import.
select
  case
    when season.champion_team_name = 'Nicholas - Pickle'
      and season.champion_total_points = 2548
      and season.participant_count = 89
      and season.race_count = 17
      and count(entry.id) = 89
      and count(distinct entry.final_rank) = 89
      and min(entry.final_rank) = 1
      and max(entry.final_rank) = 89
      and sum(entry.total_points) = 186227
      and count(*) filter (
        where entry.final_rank = 1
          and entry.team_name = season.champion_team_name
          and entry.total_points = season.champion_total_points
      ) = 1
    then 'PASS'
    else 'CHECK IMPORT'
  end as verification_status,
  season.season_year,
  season.champion_team_name,
  season.champion_total_points,
  season.race_count,
  count(entry.id) as imported_entries,
  round(season.champion_total_points::numeric / season.race_count, 2) as champion_points_per_race
from public.hall_of_fame_seasons season
left join public.hall_of_fame_entries entry on entry.season_id = season.id
where season.season_year = 2025
group by season.id;
