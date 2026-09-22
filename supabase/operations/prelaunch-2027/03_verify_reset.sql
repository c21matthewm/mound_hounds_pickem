-- Read-only verification after the SQL cleanup and again after Auth removal.
with checks as (
  select 'retained_admin'::text as check_name,
    case when count(*) = 1 then 'PASS' else 'STOP' end as status, count(*)::text as details
  from public.profiles p join auth.users u on p.id = u.id
  where p.id = '6badc049-4960-45ee-92e9-5b21dba0d4f1' and p.role = 'admin' and p.is_active
  union all
  select 'other_auth_accounts', case when count(*) = 0 then 'PASS' else 'WAIT_AUTH_CLEANUP' end, count(*)::text
  from auth.users where id <> '6badc049-4960-45ee-92e9-5b21dba0d4f1'
  union all
  select 'other_profiles', case when count(*) = 0 then 'PASS' else 'WAIT_AUTH_CLEANUP' end, count(*)::text
  from public.profiles where id <> '6badc049-4960-45ee-92e9-5b21dba0d4f1'
  union all
  select 'remaining_test_records', case when total = 0 then 'PASS' else 'STOP' end, total::text
  from (select (select count(*) from public.races) + (select count(*) from public.picks)
    + (select count(*) from public.results) + (select count(*) from public.pick_submission_versions)
    + (select count(*) from public.race_driver_groups) + (select count(*) from public.pick_reminders)
    + (select count(*) from public.season_participants where profile_id <> '6badc049-4960-45ee-92e9-5b21dba0d4f1')
    + (select count(*) from public.season_restore_points)
    + (select count(*) from public.feedback_items) as total) remaining
  union all
  select 'keeper_skipped_experimental_2026', case when count(*) = 1 then 'PASS' else 'STOP' end, count(*)::text
  from public.season_participants p join public.league_seasons s on s.id = p.season_id
  where p.profile_id = '6badc049-4960-45ee-92e9-5b21dba0d4f1' and s.season_year = 2026 and p.status = 'declined'
  union all
  select '2025_archive', case when count(*) = 89 and sum(total_points) = 186227 then 'PASS' else 'STOP' end,
    count(*) || ' entries; ' || coalesce(sum(total_points), 0) || ' combined points'
  from public.hall_of_fame_entries e join public.hall_of_fame_seasons s on e.season_id = s.id where s.season_year = 2025
  union all
  select 'old_registration_code_removed', case when count(*) = 0 then 'PASS' else 'STOP' end, count(*)::text
  from public.season_registration_secrets s join public.league_seasons l on l.id = s.season_id where l.season_year = 2026
  union all
  select 'driver_test_points_cleared', case when count(*) = 0 then 'PASS' else 'STOP' end, count(*)::text
  from public.drivers where championship_points <> 0
  union all
  select 'reset_recorded', case when count(*) = 1 then 'PASS' else 'STOP' end, count(*)::text
  from public.app_metadata where key = 'prelaunch_2027_reset'
)
select * from checks order by check_name;
