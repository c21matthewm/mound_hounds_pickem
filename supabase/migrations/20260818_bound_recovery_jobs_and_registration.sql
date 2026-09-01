-- Bound operational history, protect registration, and make season recovery explicit.

begin;

-- Registration attempts are stored only as keyed hashes; raw email and IP values never enter this table.
create table if not exists public.registration_attempt_limits (
  key_hash text primary key check (key_hash ~ '^[0-9a-f]{64}$'),
  window_started_at timestamptz not null default timezone('utc', now()),
  attempt_count integer not null default 1 check (attempt_count > 0),
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.registration_attempt_limits enable row level security;
revoke all on table public.registration_attempt_limits from public, anon, authenticated;

create or replace function public.consume_registration_attempt(
  p_key_hashes text[],
  p_max_attempts integer default 10,
  p_window_seconds integer default 900
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  attempt_allowed boolean := true;
  current_count integer;
  current_key text;
  v_now timestamptz := now();
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Service role required.';
  end if;

  if coalesce(array_length(p_key_hashes, 1), 0) not between 1 and 3
    or p_max_attempts not between 1 and 100
    or p_window_seconds not between 60 and 86400 then
    raise exception 'Invalid registration rate-limit configuration.';
  end if;

  foreach current_key in array p_key_hashes loop
    if coalesce(current_key, '') !~ '^[0-9a-f]{64}$' then
      raise exception 'Invalid registration rate-limit key.';
    end if;

    insert into public.registration_attempt_limits (
      key_hash,
      window_started_at,
      attempt_count,
      updated_at
    )
    values (current_key, v_now, 1, v_now)
    on conflict (key_hash) do update
    set
      window_started_at = case
        when public.registration_attempt_limits.window_started_at <=
          v_now - make_interval(secs => p_window_seconds)
          then v_now
        else public.registration_attempt_limits.window_started_at
      end,
      attempt_count = case
        when public.registration_attempt_limits.window_started_at <=
          v_now - make_interval(secs => p_window_seconds)
          then 1
        else public.registration_attempt_limits.attempt_count + 1
      end,
      updated_at = v_now
    returning attempt_count into current_count;

    if current_count > p_max_attempts then
      attempt_allowed := false;
    end if;
  end loop;

  delete from public.registration_attempt_limits
  where updated_at < v_now - interval '2 days';

  return attempt_allowed;
end;
$$;

revoke all on function public.consume_registration_attempt(text[], integer, integer)
from public, anon, authenticated;
grant execute on function public.consume_registration_attempt(text[], integer, integer)
to service_role;

-- Keep one current heartbeat per job. job_runs becomes a bounded exception/work history.
create table if not exists public.job_status (
  job_name text primary key check (job_name in ('pick-reminders', 'fantasy-winner')),
  status text not null check (status in ('running', 'succeeded', 'degraded', 'failed')),
  summary jsonb not null default '{}'::jsonb check (jsonb_typeof(summary) = 'object'),
  error_message text,
  run_token uuid not null,
  run_count bigint not null default 0 check (run_count >= 0),
  last_started_at timestamptz not null,
  last_completed_at timestamptz,
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_job_runs_status_started
on public.job_runs(status, started_at);

with latest_run as (
  select distinct on (run.job_name)
    run.job_name,
    run.status,
    run.summary,
    run.error_message,
    run.started_at,
    run.completed_at
  from public.job_runs run
  order by run.job_name, run.started_at desc, run.id desc
),
run_counts as (
  select run.job_name, count(*)::bigint as run_count
  from public.job_runs run
  group by run.job_name
)
insert into public.job_status (
  job_name,
  status,
  summary,
  error_message,
  run_token,
  run_count,
  last_started_at,
  last_completed_at,
  updated_at
)
select
  latest_run.job_name,
  latest_run.status,
  latest_run.summary,
  latest_run.error_message,
  extensions.gen_random_uuid(),
  run_counts.run_count,
  latest_run.started_at,
  latest_run.completed_at,
  coalesce(latest_run.completed_at, latest_run.started_at)
from latest_run
join run_counts on run_counts.job_name = latest_run.job_name
on conflict (job_name) do nothing;

alter table public.job_status enable row level security;
grant select on table public.job_status to authenticated;

drop policy if exists job_status_admin_read on public.job_status;
create policy job_status_admin_read
on public.job_status
for select
to authenticated
using (public.is_admin(auth.uid()));

create or replace function public.start_job_status(p_job_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
  next_token uuid := extensions.gen_random_uuid();
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Service role required.';
  end if;
  if p_job_name not in ('pick-reminders', 'fantasy-winner') then
    raise exception 'Unknown scheduled job.';
  end if;

  insert into public.job_status (
    job_name,
    status,
    summary,
    error_message,
    run_token,
    run_count,
    last_started_at,
    last_completed_at,
    updated_at
  )
  values (p_job_name, 'running', '{}'::jsonb, null, next_token, 1, v_now, null, v_now)
  on conflict (job_name) do update
  set
    status = 'running',
    summary = '{}'::jsonb,
    error_message = null,
    run_token = next_token,
    run_count = public.job_status.run_count + 1,
    last_started_at = v_now,
    updated_at = v_now;

  return next_token;
end;
$$;

create or replace function public.prune_job_run_history()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted_count integer := 0;
  step_count integer := 0;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Service role required.';
  end if;

  delete from public.job_runs
  where status = 'succeeded'
    and started_at < timezone('utc', now()) - interval '30 days';
  get diagnostics step_count = row_count;
  deleted_count := deleted_count + step_count;

  delete from public.job_runs
  where status in ('degraded', 'failed')
    and started_at < timezone('utc', now()) - interval '90 days';
  get diagnostics step_count = row_count;
  deleted_count := deleted_count + step_count;

  delete from public.job_runs
  where status = 'running'
    and started_at < timezone('utc', now()) - interval '1 day';
  get diagnostics step_count = row_count;
  return deleted_count + step_count;
end;
$$;

create or replace function public.finish_job_status(
  p_job_name text,
  p_run_token uuid,
  p_status text,
  p_summary jsonb default '{}'::jsonb,
  p_error_message text default null,
  p_record_event boolean default false
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  completed_time timestamptz := timezone('utc', now());
  started_time timestamptz;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Service role required.';
  end if;
  if p_status not in ('succeeded', 'degraded', 'failed') then
    raise exception 'Invalid scheduled-job completion status.';
  end if;

  update public.job_status
  set
    status = p_status,
    summary = coalesce(p_summary, '{}'::jsonb),
    error_message = nullif(left(coalesce(p_error_message, ''), 2000), ''),
    last_completed_at = completed_time,
    updated_at = completed_time
  where job_name = p_job_name
    and run_token = p_run_token
  returning last_started_at into started_time;

  -- Ignore a stale overlapping completion; the newer heartbeat remains authoritative.
  if started_time is null then
    return;
  end if;

  if p_record_event or p_status <> 'succeeded' then
    insert into public.job_runs (
      job_name,
      status,
      summary,
      error_message,
      started_at,
      completed_at
    )
    values (
      p_job_name,
      p_status,
      coalesce(p_summary, '{}'::jsonb),
      nullif(left(coalesce(p_error_message, ''), 2000), ''),
      started_time,
      completed_time
    );
  end if;

  perform public.prune_job_run_history();
end;
$$;

revoke all on function public.start_job_status(text) from public, anon, authenticated;
revoke all on function public.finish_job_status(text, uuid, text, jsonb, text, boolean)
from public, anon, authenticated;
revoke all on function public.prune_job_run_history() from public, anon, authenticated;
grant execute on function public.start_job_status(text) to service_role;
grant execute on function public.finish_job_status(text, uuid, text, jsonb, text, boolean)
to service_role;
grant execute on function public.prune_job_run_history() to service_role;

-- Apply the history policy during migration instead of waiting for the next scheduled run.
delete from public.job_runs
where status = 'succeeded'
  and started_at < timezone('utc', now()) - interval '30 days';

delete from public.job_runs
where status in ('degraded', 'failed')
  and started_at < timezone('utc', now()) - interval '90 days';

delete from public.job_runs
where status = 'running'
  and started_at < timezone('utc', now()) - interval '1 day';

-- Classify restore points so automatic snapshots can be retained without unbounded duplication.
alter table public.season_restore_points
add column if not exists retention_key text;

alter table public.season_restore_points
add column if not exists snapshot_bytes bigint not null default 0;

alter table public.season_restore_points
drop constraint if exists season_restore_points_retention_key_check;

alter table public.season_restore_points
add constraint season_restore_points_retention_key_check check (
  retention_key is null or length(trim(retention_key)) between 1 and 120
);

alter table public.season_restore_points
drop constraint if exists season_restore_points_snapshot_bytes_check;

alter table public.season_restore_points
add constraint season_restore_points_snapshot_bytes_check check (snapshot_bytes >= 0);

alter table public.season_restore_points
drop constraint if exists season_restore_points_source_check;

alter table public.season_restore_points
add constraint season_restore_points_source_check check (
  source in (
    'automatic',
    'result_checkpoint',
    'pre_correction',
    'pre_rollover',
    'manual',
    'pre_restore',
    'uploaded'
  )
);

create index if not exists idx_season_restore_points_retention
on public.season_restore_points(season_id, source, retention_key, created_at desc);

create or replace function public.prevent_season_restore_point_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_setting('mound_hounds.restore_point_maintenance', true) = 'on' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  raise exception 'Season restore points are immutable.';
end;
$$;

create or replace function public.set_season_restore_point_size()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.snapshot_bytes := octet_length(new.snapshot::text);
  return new;
end;
$$;

drop trigger if exists trg_set_season_restore_point_size on public.season_restore_points;
create trigger trg_set_season_restore_point_size
before insert on public.season_restore_points
for each row execute function public.set_season_restore_point_size();

revoke all on function public.set_season_restore_point_size()
from public, anon, authenticated;

select set_config('mound_hounds.restore_point_maintenance', 'on', true);

update public.season_restore_points
set
  source = case
    when source <> 'automatic' then source
    when label ~* '^After R[0-9]+ results:' then 'result_checkpoint'
    when label ~* '^Before (correcting|republishing|replacing) R[0-9]+' then 'pre_correction'
    when label ~* '^Before (activating|finalizing)' then 'pre_rollover'
    else 'automatic'
  end,
  retention_key = case
    when source = 'automatic' and label ~* '^After R[0-9]+ results:'
      then 'round:' || substring(label from '(?i)^After R([0-9]+) results:')
    when source = 'automatic' and label ~* '^Before (correcting|republishing|replacing) R[0-9]+'
      then 'round:' || substring(label from '(?i)R([0-9]+)')
    else retention_key
  end,
  snapshot_bytes = octet_length(snapshot::text);

-- Bring existing automatic history under the same retention rules immediately.
with ranked as (
  select
    id,
    row_number() over (
      partition by season_id, coalesce(retention_key, 'legacy')
      order by created_at desc, id desc
    ) as retention_rank
  from public.season_restore_points
  where source = 'result_checkpoint'
)
delete from public.season_restore_points point
using ranked
where point.id = ranked.id
  and ranked.retention_rank > 1;

with ranked as (
  select
    id,
    row_number() over (
      partition by season_id
      order by created_at desc, id desc
    ) as retention_rank
  from public.season_restore_points
  where source in ('automatic', 'pre_correction')
)
delete from public.season_restore_points point
using ranked
where point.id = ranked.id
  and ranked.retention_rank > 5;

select set_config('mound_hounds.restore_point_maintenance', 'off', true);

create or replace function public.prune_season_restore_points(p_season_id bigint)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted_count integer := 0;
  step_count integer := 0;
begin
  if coalesce(auth.role(), '') <> 'service_role' and not public.is_admin(auth.uid()) then
    raise exception 'Admin access required.';
  end if;

  perform set_config('mound_hounds.restore_point_maintenance', 'on', true);

  with ranked as (
    select
      id,
      row_number() over (
        partition by coalesce(retention_key, 'legacy')
        order by created_at desc, id desc
      ) as retention_rank
    from public.season_restore_points
    where season_id = p_season_id
      and source = 'result_checkpoint'
  )
  delete from public.season_restore_points point
  using ranked
  where point.id = ranked.id
    and ranked.retention_rank > 1;
  get diagnostics step_count = row_count;
  deleted_count := deleted_count + step_count;

  with ranked as (
    select id, row_number() over (order by created_at desc, id desc) as retention_rank
    from public.season_restore_points
    where season_id = p_season_id
      and source in ('automatic', 'pre_correction')
  )
  delete from public.season_restore_points point
  using ranked
  where point.id = ranked.id
    and ranked.retention_rank > 5;
  get diagnostics step_count = row_count;
  deleted_count := deleted_count + step_count;

  perform set_config('mound_hounds.restore_point_maintenance', 'off', true);
  return deleted_count;
end;
$$;

revoke all on function public.prune_season_restore_points(bigint)
from public, anon, authenticated;

create or replace function public.create_season_restore_point_v2(
  p_season_id bigint,
  p_label text,
  p_source text default 'manual',
  p_retention_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  created_point jsonb;
  created_point_id uuid;
  storage_source text;
begin
  if coalesce(auth.role(), '') <> 'service_role' and not public.is_admin(auth.uid()) then
    raise exception 'Admin access required.';
  end if;
  if p_source not in (
    'result_checkpoint',
    'pre_correction',
    'pre_rollover',
    'manual',
    'pre_restore',
    'uploaded'
  ) then
    raise exception 'Invalid restore-point source.';
  end if;
  if p_retention_key is not null and length(trim(p_retention_key)) not between 1 and 120 then
    raise exception 'Invalid restore-point retention key.';
  end if;

  storage_source := case
    when p_source in ('result_checkpoint', 'pre_correction', 'pre_rollover') then 'automatic'
    else p_source
  end;
  created_point := public.create_season_restore_point(
    p_season_id,
    p_label,
    storage_source
  );
  created_point_id := (created_point->>'id')::uuid;

  perform set_config('mound_hounds.restore_point_maintenance', 'on', true);
  update public.season_restore_points
  set
    source = p_source,
    retention_key = nullif(trim(p_retention_key), ''),
    snapshot_bytes = octet_length(snapshot::text)
  where id = created_point_id;
  perform set_config('mound_hounds.restore_point_maintenance', 'off', true);

  perform public.prune_season_restore_points(p_season_id);

  return created_point || jsonb_build_object(
    'source', p_source,
    'retentionKey', nullif(trim(p_retention_key), '')
  );
end;
$$;

revoke all on function public.create_season_restore_point_v2(bigint, text, text, text)
from public, anon;
grant execute on function public.create_season_restore_point_v2(bigint, text, text, text)
to authenticated, service_role;

-- Profiles are permanent account references. They are validated during restore, not overwritten.
-- Drivers are limited to the selected season roster instead of every historical global row.
create or replace function public.build_season_recovery_snapshot(p_season_id bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  hall_of_fame_snapshot jsonb;
  selected_season public.league_seasons%rowtype;
begin
  select * into selected_season
  from public.league_seasons
  where id = p_season_id;

  if selected_season.id is null then
    raise exception 'Selected season was not found.';
  end if;

  select jsonb_build_object(
    'season', to_jsonb(hall),
    'entries', coalesce(
      (
        select jsonb_agg(to_jsonb(entry) order by entry.final_rank, entry.id)
        from public.hall_of_fame_entries entry
        where entry.season_id = hall.id
      ),
      '[]'::jsonb
    )
  )
  into hall_of_fame_snapshot
  from public.hall_of_fame_seasons hall
  where hall.season_year = selected_season.season_year;

  return jsonb_build_object(
    'format', 'mound-hounds-season-backup',
    'formatVersion', 1,
    'season', to_jsonb(selected_season),
    'profiles', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', profile.id,
            'full_name', profile.full_name,
            'team_name', profile.team_name,
            'role', profile.role,
            'is_active', profile.is_active
          ) order by profile.id
        )
        from public.profiles profile
        where exists (
          select 1
          from public.season_participants participant
          where participant.season_id = selected_season.id
            and participant.profile_id = profile.id
        )
      ),
      '[]'::jsonb
    ),
    'participants', coalesce(
      (
        select jsonb_agg(to_jsonb(participant) order by participant.profile_id)
        from public.season_participants participant
        where participant.season_id = selected_season.id
      ),
      '[]'::jsonb
    ),
    'drivers', coalesce(
      (
        select jsonb_agg(to_jsonb(driver) order by driver.id)
        from public.drivers driver
        where driver.is_active = true
          or exists (
            select 1
            from public.race_driver_groups race_group
            join public.races race on race.id = race_group.race_id
            where race.season_id = selected_season.id
              and race_group.driver_id = driver.id
          )
          or exists (
            select 1
            from public.results result_row
            join public.races race on race.id = result_row.race_id
            where race.season_id = selected_season.id
              and result_row.driver_id = driver.id
          )
      ),
      '[]'::jsonb
    ),
    'races', coalesce(
      (
        select jsonb_agg(to_jsonb(race) order by race.round_number, race.id)
        from public.races race
        where race.season_id = selected_season.id
      ),
      '[]'::jsonb
    ),
    'raceDriverGroups', coalesce(
      (
        select jsonb_agg(
          to_jsonb(race_group)
          order by race_group.race_id, race_group.group_number, race_group.driver_id
        )
        from public.race_driver_groups race_group
        join public.races race on race.id = race_group.race_id
        where race.season_id = selected_season.id
      ),
      '[]'::jsonb
    ),
    'picks', coalesce(
      (
        select jsonb_agg(to_jsonb(pick) order by pick.race_id, pick.user_id)
        from public.picks pick
        join public.races race on race.id = pick.race_id
        where race.season_id = selected_season.id
      ),
      '[]'::jsonb
    ),
    'pickSubmissionVersions', coalesce(
      (
        select jsonb_agg(
          to_jsonb(version)
          order by version.race_id, version.user_id, version.submission_version
        )
        from public.pick_submission_versions version
        join public.races race on race.id = version.race_id
        where race.season_id = selected_season.id
      ),
      '[]'::jsonb
    ),
    'results', coalesce(
      (
        select jsonb_agg(to_jsonb(result_row) order by result_row.race_id, result_row.driver_id)
        from public.results result_row
        join public.races race on race.id = result_row.race_id
        where race.season_id = selected_season.id
      ),
      '[]'::jsonb
    ),
    'hallOfFame', hall_of_fame_snapshot
  );
end;
$$;

revoke all on function public.build_season_recovery_snapshot(bigint)
from public, anon, authenticated;

create or replace function public.season_recovery_comparable_rows(
  p_snapshot jsonb,
  p_table_key text
)
returns jsonb
language sql
immutable
set search_path = public
as $$
  select case
    when p_table_key <> 'drivers' then coalesce(p_snapshot->p_table_key, '[]'::jsonb)
    else coalesce(
      (
        select jsonb_agg(driver_row order by (driver_row->>'id')::bigint)
        from jsonb_array_elements(coalesce(p_snapshot->'drivers', '[]'::jsonb)) driver_row
        where coalesce((driver_row->>'is_active')::boolean, false)
          or exists (
            select 1
            from jsonb_array_elements(
              coalesce(p_snapshot->'raceDriverGroups', '[]'::jsonb)
            ) race_group
            where (race_group->>'driver_id')::bigint = (driver_row->>'id')::bigint
          )
          or exists (
            select 1
            from jsonb_array_elements(coalesce(p_snapshot->'results', '[]'::jsonb)) result_row
            where (result_row->>'driver_id')::bigint = (driver_row->>'id')::bigint
          )
      ),
      '[]'::jsonb
    )
  end;
$$;

revoke all on function public.season_recovery_comparable_rows(jsonb, text)
from public, anon, authenticated;

create or replace function public.preview_season_restore_point(p_restore_point_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  backup_point public.season_restore_points%rowtype;
  current_snapshot jsonb;
  differences jsonb := '{}'::jsonb;
  backup_rows jsonb;
  current_rows jsonb;
  table_key text;
  table_keys text[] := array[
    'participants',
    'drivers',
    'races',
    'raceDriverGroups',
    'picks',
    'pickSubmissionVersions',
    'results'
  ];
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'Admin access required.';
  end if;

  select * into backup_point
  from public.season_restore_points
  where id = p_restore_point_id;
  if backup_point.id is null then
    raise exception 'Selected restore point was not found.';
  end if;

  current_snapshot := public.build_season_recovery_snapshot(backup_point.season_id);
  foreach table_key in array table_keys loop
    backup_rows := public.season_recovery_comparable_rows(backup_point.snapshot, table_key);
    current_rows := public.season_recovery_comparable_rows(current_snapshot, table_key);
    differences := differences || jsonb_build_object(
      table_key,
      jsonb_build_object(
        'backupCount', jsonb_array_length(backup_rows),
        'currentCount', jsonb_array_length(current_rows),
        'differentRows', public.jsonb_array_difference_count(
          backup_rows,
          current_rows
        )
      )
    );
  end loop;

  differences := differences || jsonb_build_object(
    'hallOfFame',
    jsonb_build_object(
      'backupCount',
      case when jsonb_typeof(backup_point.snapshot->'hallOfFame') = 'object' then 1 else 0 end,
      'currentCount',
      case when jsonb_typeof(current_snapshot->'hallOfFame') = 'object' then 1 else 0 end,
      'differentRows',
      case
        when backup_point.snapshot->'hallOfFame' is not distinct from current_snapshot->'hallOfFame'
          then 0
        else 1
      end
    )
  );

  return jsonb_build_object(
    'id', backup_point.id,
    'seasonId', backup_point.season_id,
    'seasonYear', backup_point.season_year,
    'label', backup_point.label,
    'source', backup_point.source,
    'schemaVersion', backup_point.schema_version,
    'formatVersion', backup_point.format_version,
    'checksum', backup_point.checksum,
    'createdAt', backup_point.created_at,
    'differences', differences
  );
end;
$$;

revoke all on function public.preview_season_restore_point(uuid) from public, anon;
grant execute on function public.preview_season_restore_point(uuid) to authenticated;

-- The existing restore transaction remains authoritative. This wrapper reconciles the active
-- driver roster without deleting historical driver identities.
create or replace function public.restore_season_from_restore_point_v2(
  p_restore_point_id uuid,
  p_confirmation_year integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  backup_point public.season_restore_points%rowtype;
  restore_result jsonb;
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'Admin access required.';
  end if;

  select * into backup_point
  from public.season_restore_points
  where id = p_restore_point_id;
  if backup_point.id is null then
    raise exception 'Selected restore point was not found.';
  end if;

  restore_result := public.restore_season_from_restore_point(
    p_restore_point_id,
    p_confirmation_year
  );

  update public.drivers driver
  set
    is_active = false,
    championship_points = 0,
    group_number = 6
  where driver.is_active = true
    and not exists (
      select 1
      from jsonb_to_recordset(coalesce(backup_point.snapshot->'drivers', '[]'::jsonb))
        as snapshot_driver(id bigint)
      where snapshot_driver.id = driver.id
    );

  perform public.refresh_driver_standings_from_published_results();
  return restore_result;
end;
$$;

revoke all on function public.restore_season_from_restore_point_v2(uuid, integer)
from public, anon;
grant execute on function public.restore_season_from_restore_point_v2(uuid, integer)
to authenticated;

-- A trigger checkpoint protects direct SQL/RPC publication. The app writes a newer checkpoint
-- after standings and winner finalization, replacing this one for the same race.
create or replace function public.create_restore_point_after_result_publication()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.results_status = 'published'
    and (
      old.results_status is distinct from new.results_status
      or old.results_published_at is distinct from new.results_published_at
    ) then
    perform public.create_season_restore_point_v2(
      new.season_id,
      format('Publication checkpoint for R%s: %s', new.round_number, new.race_name),
      'result_checkpoint',
      format('race:%s', new.id)
    );
  end if;

  return new;
end;
$$;

drop trigger if exists trg_create_restore_point_after_result_publication on public.races;
create trigger trg_create_restore_point_after_result_publication
after update of results_status, results_published_at on public.races
for each row execute function public.create_restore_point_after_result_publication();

revoke all on function public.create_restore_point_after_result_publication()
from public, anon, authenticated;

create or replace function public.get_app_health_contract()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  missing_items text[] := '{}';
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'Admin access required.';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'races' and column_name = 'field_frozen_at'
  ) then
    missing_items := array_append(missing_items, 'races.field_frozen_at');
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'races' and column_name = 'pick_window_key'
  ) then
    missing_items := array_append(missing_items, 'races.pick_window_key');
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'league_seasons' and column_name = 'roster_configured_at'
  ) then
    missing_items := array_append(missing_items, 'league_seasons.roster_configured_at');
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'feedback_items' and column_name = 'status'
  ) then
    missing_items := array_append(missing_items, 'feedback_items.status');
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'season_restore_points' and column_name = 'snapshot_bytes'
  ) then
    missing_items := array_append(missing_items, 'season_restore_points.snapshot_bytes');
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'season_restore_points' and column_name = 'retention_key'
  ) then
    missing_items := array_append(missing_items, 'season_restore_points.retention_key');
  end if;

  if to_regclass('public.season_registration_secrets') is null then
    missing_items := array_append(missing_items, 'season_registration_secrets');
  end if;
  if to_regclass('public.registration_attempt_limits') is null then
    missing_items := array_append(missing_items, 'registration_attempt_limits');
  end if;
  if to_regclass('public.admin_audit_events') is null then
    missing_items := array_append(missing_items, 'admin_audit_events');
  end if;
  if to_regclass('public.job_runs') is null then
    missing_items := array_append(missing_items, 'job_runs');
  end if;
  if to_regclass('public.job_status') is null then
    missing_items := array_append(missing_items, 'job_status');
  end if;
  if to_regclass('public.pick_reminders') is null then
    missing_items := array_append(missing_items, 'pick_reminders');
  end if;
  if to_regclass('public.pick_submission_versions') is null then
    missing_items := array_append(missing_items, 'pick_submission_versions');
  end if;
  if to_regclass('public.season_restore_points') is null then
    missing_items := array_append(missing_items, 'season_restore_points');
  end if;

  if to_regprocedure('public.save_weekly_pick(bigint,numeric,bigint[])') is null then
    missing_items := array_append(missing_items, 'save_weekly_pick');
  end if;
  if to_regprocedure('public.admin_update_participant(uuid,text,text,boolean,boolean,boolean)') is null then
    missing_items := array_append(missing_items, 'admin_update_participant');
  end if;
  if to_regprocedure('public.sync_opening_driver_roster(bigint,jsonb)') is null then
    missing_items := array_append(missing_items, 'sync_opening_driver_roster');
  end if;
  if to_regprocedure('public.replace_indy_500_qualifying_order(bigint,jsonb)') is null then
    missing_items := array_append(missing_items, 'replace_indy_500_qualifying_order');
  end if;
  if to_regprocedure('public.ensure_race_pick_field_snapshot(bigint)') is null then
    missing_items := array_append(missing_items, 'ensure_race_pick_field_snapshot');
  end if;
  if to_regprocedure('public.validate_shared_pick_window()') is null then
    missing_items := array_append(missing_items, 'validate_shared_pick_window');
  end if;
  if to_regprocedure('public.claim_pick_reminder_delivery(bigint,uuid,text,text,text)') is null then
    missing_items := array_append(missing_items, 'claim_pick_reminder_delivery');
  end if;
  if to_regprocedure('public.protect_race_history_from_delete()') is null then
    missing_items := array_append(missing_items, 'protect_race_history_from_delete');
  end if;
  if to_regprocedure('public.protect_driver_history_from_delete()') is null then
    missing_items := array_append(missing_items, 'protect_driver_history_from_delete');
  end if;
  if to_regprocedure('public.create_season_restore_point(bigint,text,text)') is null then
    missing_items := array_append(missing_items, 'create_season_restore_point');
  end if;
  if to_regprocedure('public.restore_season_from_restore_point(uuid,integer)') is null then
    missing_items := array_append(missing_items, 'restore_season_from_restore_point');
  end if;
  if to_regprocedure('public.consume_registration_attempt(text[],integer,integer)') is null then
    missing_items := array_append(missing_items, 'consume_registration_attempt');
  end if;
  if to_regprocedure('public.start_job_status(text)') is null then
    missing_items := array_append(missing_items, 'start_job_status');
  end if;
  if to_regprocedure('public.finish_job_status(text,uuid,text,jsonb,text,boolean)') is null then
    missing_items := array_append(missing_items, 'finish_job_status');
  end if;
  if to_regprocedure('public.prune_job_run_history()') is null then
    missing_items := array_append(missing_items, 'prune_job_run_history');
  end if;
  if to_regprocedure('public.prune_season_restore_points(bigint)') is null then
    missing_items := array_append(missing_items, 'prune_season_restore_points');
  end if;
  if to_regprocedure('public.create_season_restore_point_v2(bigint,text,text,text)') is null then
    missing_items := array_append(missing_items, 'create_season_restore_point_v2');
  end if;
  if to_regprocedure('public.preview_season_restore_point(uuid)') is null then
    missing_items := array_append(missing_items, 'preview_season_restore_point');
  end if;
  if to_regprocedure('public.restore_season_from_restore_point_v2(uuid,integer)') is null then
    missing_items := array_append(missing_items, 'restore_season_from_restore_point_v2');
  end if;

  return jsonb_build_object(
    'healthy', cardinality(missing_items) = 0,
    'missing', to_jsonb(missing_items),
    'version', '20260818_recovery_jobs_security_v1'
  );
end;
$$;

revoke all on function public.get_app_health_contract() from public, anon;
grant execute on function public.get_app_health_contract() to authenticated;

insert into public.app_metadata (key, value)
values ('schema_version', '20260818_recovery_jobs_security_v1')
on conflict (key) do update
set value = excluded.value, updated_at = timezone('utc', now());

commit;
