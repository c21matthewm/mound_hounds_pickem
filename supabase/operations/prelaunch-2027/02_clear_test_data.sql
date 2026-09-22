-- DESTRUCTIVE, ONE TIME: the approved experimental 2026 application data only.
-- Run only after 01_database_preflight.sql passes and the local export is saved.
-- Keep the new admin logged in; close other app tabs during this maintenance.
-- Authentication accounts and Storage files are handled separately afterward.
-- Do not rerun migrations or disable database triggers to make this script pass.

begin;
set local lock_timeout = '10s';
set local statement_timeout = '60s';

-- Prevent concurrent participant, race, recovery, and background-job writes.
lock table auth.users, public.profiles, public.league_seasons,
  public.season_participants, public.season_registration_secrets,
  public.races, public.picks, public.pick_submission_versions,
  public.results, public.race_driver_groups, public.pick_reminders,
  public.feedback_items, public.season_restore_points, public.drivers,
  public.hall_of_fame_seasons, public.hall_of_fame_entries,
  public.admin_audit_events, public.app_error_events, public.job_runs,
  public.job_status, public.registration_attempt_limits, public.app_metadata
  in share row exclusive mode;

do $reset$
declare
  keeper_id constant uuid := '6badc049-4960-45ee-92e9-5b21dba0d4f1';
  target_season_id bigint;
  archive_before jsonb;
  archive_after jsonb;
  cron_state jsonb := '[]'::jsonb;
  job record;
  expected record;
  actual_count bigint;
begin
  if exists (select 1 from public.app_metadata where key = 'prelaunch_2027_reset') then
    raise exception 'This reset already ran. Do not run it again; use the verification query.';
  end if;
  if not exists (
    select 1 from public.profiles p join auth.users u on u.id = p.id
    where p.id = keeper_id and p.role = 'admin' and p.is_active
      and length(trim(p.full_name)) > 0 and length(trim(p.team_name)) > 0
      and u.email_confirmed_at is not null
  ) then
    raise exception 'The retained confirmed administrator is missing or ineligible. Nothing was deleted.';
  end if;
  if not exists (select 1 from public.app_metadata
    where key = 'schema_version' and value = '20260904_portable_season_backups_v2') then
    raise exception 'Unexpected schema version. Review the inventory before proceeding.';
  end if;

  select id into target_season_id from public.league_seasons where season_year = 2026 and status = 'active';
  if target_season_id is null or (select count(*) from public.league_seasons) <> 1 then
    raise exception 'Expected only the active experimental 2026 operational season. Review new season data first.';
  end if;
  if exists (select 1 from public.hall_of_fame_seasons where season_year = 2026) then
    raise exception 'A 2026 archive now exists. Stop and distinguish the real archive from test data.';
  end if;
  if not exists (select 1 from public.hall_of_fame_seasons s
    where s.season_year = 2025 and s.race_count = 17 and s.participant_count = 89
      and s.champion_total_points = 2548
      and (select count(*) from public.hall_of_fame_entries e where e.season_id = s.id) = 89
      and (select sum(total_points) from public.hall_of_fame_entries e where e.season_id = s.id) = 186227) then
    raise exception 'The expected genuine 2025 archive could not be verified.';
  end if;

  -- These were observed on 2026-09-12. Any change requires another inventory,
  -- not guessing or weakening the guard. Volatile operational logs are excluded.
  for expected in select * from (values
    ('auth.users', 14), ('public.profiles', 14), ('public.season_participants', 14),
    ('public.races', 18), ('public.picks', 40), ('public.results', 458),
    ('public.race_driver_groups', 435), ('public.pick_submission_versions', 41),
    ('public.season_restore_points', 6), ('public.feedback_items', 8), ('public.drivers', 33)
  ) as expected_counts(table_name, row_count)
  loop
    execute format('select count(*) from %s', expected.table_name::regclass) into actual_count;
    if actual_count <> expected.row_count then
      raise exception 'Inventory changed for %: expected %, found %. Nothing was deleted.',
        expected.table_name, expected.row_count, actual_count;
    end if;
  end loop;
  if exists (select 1 from public.season_restore_points where season_id <> target_season_id or season_year <> 2026) then
    raise exception 'A restore point belongs to another season. Review before proceeding.';
  end if;
  if exists (select 1 from storage.objects o join auth.users u
    on u.id::text = coalesce(o.owner_id, o.owner::text) where u.id <> keeper_id) then
    raise exception 'An account to delete owns Storage files. Resolve ownership before this reset.';
  end if;
  if exists (select 1 from public.job_status where status = 'running' and last_started_at > now() - interval '5 minutes')
    or exists (select 1 from public.pick_reminders where lease_expires_at > now()) then
    raise exception 'A background job or reminder delivery is still running. Let it finish before retrying.';
  end if;

  select jsonb_build_object(
    'seasons', coalesce((select jsonb_agg(to_jsonb(s) order by s.id) from public.hall_of_fame_seasons s), '[]'::jsonb),
    'entries', coalesce((select jsonb_agg(to_jsonb(e) order by e.id) from public.hall_of_fame_entries e), '[]'::jsonb)
  ) into archive_before;

  -- Preserve only job identity/active state, never cron commands or their secrets.
  if to_regclass('cron.job') is not null then
    execute $cron$
      select coalesce(jsonb_agg(jsonb_build_object('jobid', jobid, 'jobname', jobname, 'was_active', active)), '[]'::jsonb)
      from cron.job where jobname in ('fantasy_winner_5min', 'fantasy_winner_hourly', 'pick_reminders_5min')
        or command ilike '%/api/cron/fantasy-winner%' or command ilike '%/api/cron/pick-reminders%'
    $cron$ into cron_state;
    for job in select * from jsonb_to_recordset(cron_state) as j(jobid bigint, jobname text, was_active boolean)
    loop
      perform cron.alter_job(job.jobid, active := false);
    end loop;
  end if;

  -- Close the old app signup/registration code while keeping the season shell.
  delete from public.season_registration_secrets where season_id = target_season_id;
  update public.league_seasons set registration_code_configured_at = null where id = target_season_id;
  update public.profiles set role = 'participant', is_active = false where id <> keeper_id;

  -- The existing maintenance mechanism is transaction-local; protections remain installed.
  perform set_config('mound_hounds.restore_point_maintenance', 'on', true);
  delete from public.season_restore_points where season_id = target_season_id;
  perform set_config('mound_hounds.restore_point_maintenance', 'off', true);

  delete from public.picks where race_id in (select id from public.races where season_id = target_season_id);
  delete from public.results where race_id in (select id from public.races where season_id = target_season_id);
  -- Remaining submission versions, groups, and reminders cascade from these races.
  delete from public.races where season_id = target_season_id;
  delete from public.season_participants where season_id = target_season_id;
  -- A fresh "skipped 2026" decision keeps Dashboard/Hall of Fame accessible
  -- without sending the keeper into registration for a closed experimental year.
  -- The separate 2027 registration decision will still be required at activation.
  insert into public.season_participants (season_id, profile_id, status, registered_at)
  values (target_season_id, keeper_id, 'declined', null);
  delete from public.feedback_items;
  delete from public.admin_audit_events;
  delete from public.app_error_events;
  delete from public.job_runs;
  delete from public.job_status;
  delete from public.registration_attempt_limits;
  -- Keep both ordering fields for deliberate 2027 seed review; remove test points.
  update public.drivers set championship_points = 0;

  select jsonb_build_object(
    'seasons', coalesce((select jsonb_agg(to_jsonb(s) order by s.id) from public.hall_of_fame_seasons s), '[]'::jsonb),
    'entries', coalesce((select jsonb_agg(to_jsonb(e) order by e.id) from public.hall_of_fame_entries e), '[]'::jsonb)
  ) into archive_after;
  if archive_after is distinct from archive_before then
    raise exception 'Archive preservation failed. The entire cleanup is rolled back.';
  end if;

  insert into public.app_metadata (key, value) values
    ('prelaunch_2027_cron_state', cron_state::text),
    ('prelaunch_2027_reset', jsonb_build_object('keeper_id', keeper_id, 'completed_at', now(), 'season_year', 2026)::text);
  insert into public.admin_audit_events (actor_profile_id, action, entity_type, summary)
  values (keeper_id, 'prelaunch_test_data_reset', 'maintenance',
    'Removed experimental 2026 application data; preserved genuine archives and the retained administrator. Auth cleanup follows separately.');
end;
$reset$;

commit;

select 'PASS: Test application data cleared. Auth accounts and image files still require their separate cleanup.' as result;
