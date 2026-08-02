-- Read-only diagnostics for one race.
-- Change only this race ID before running the complete query.

with parameters as (
  select 128::bigint as race_id
),
pick_groups as (
  select
    pick.user_id,
    selected.driver_id,
    selected.group_number
  from public.picks pick
  cross join lateral (
    values
      (pick.driver_group1_id, 1),
      (pick.driver_group2_id, 2),
      (pick.driver_group3_id, 3),
      (pick.driver_group4_id, 4),
      (pick.driver_group5_id, 5),
      (pick.driver_group6_id, 6),
      (pick.driver_group7_id, 7),
      (pick.driver_group8_id, 8)
  ) selected(driver_id, group_number)
  where pick.race_id = (select race_id from parameters)
    and selected.driver_id is not null
),
race_summary as (
  select
    'race_summary'::text as section,
    race.id as race_id,
    null::bigint as driver_id,
    race.race_name as driver_name,
    null::integer as group_number,
    null::integer as points,
    null::bigint as picked_by_teams,
    format(
      'status=%s, results=%s, snapshot=%s, avg_speed=%s',
      race.results_status,
      count(distinct result_row.driver_id),
      count(distinct race_group.driver_id),
      coalesce(race.official_winning_average_speed::text, 'missing')
    ) as details
  from public.races race
  left join public.results result_row on result_row.race_id = race.id
  left join public.race_driver_groups race_group on race_group.race_id = race.id
  where race.id = (select race_id from parameters)
  group by race.id
),
missing_results as (
  select
    'snapshot_driver_missing_result'::text as section,
    race_group.race_id,
    driver.id as driver_id,
    driver.driver_name,
    race_group.group_number::integer,
    null::integer as points,
    count(distinct pick_groups.user_id) as picked_by_teams,
    'Driver is in the race snapshot but has no result row.'::text as details
  from public.race_driver_groups race_group
  join public.drivers driver on driver.id = race_group.driver_id
  left join public.results result_row
    on result_row.race_id = race_group.race_id
    and result_row.driver_id = race_group.driver_id
  left join pick_groups on pick_groups.driver_id = race_group.driver_id
  where race_group.race_id = (select race_id from parameters)
    and result_row.id is null
  group by race_group.race_id, driver.id, driver.driver_name, race_group.group_number
),
result_group_audit as (
  select
    'result_group_audit'::text as section,
    result_row.race_id,
    driver.id as driver_id,
    driver.driver_name,
    min(pick_groups.group_number)::integer as group_number,
    result_row.points,
    count(distinct pick_groups.user_id) as picked_by_teams,
    format(
      'inferred_group_count=%s',
      count(distinct pick_groups.group_number)
    ) as details
  from public.results result_row
  join public.drivers driver on driver.id = result_row.driver_id
  left join pick_groups on pick_groups.driver_id = result_row.driver_id
  where result_row.race_id = (select race_id from parameters)
  group by result_row.race_id, driver.id, driver.driver_name, result_row.points
)
select * from race_summary
union all
select * from missing_results
union all
select * from result_group_audit
order by section, group_number nulls first, driver_name;

