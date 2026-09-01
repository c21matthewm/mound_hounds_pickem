-- Repair registration throttling and job heartbeats after PostgreSQL interpreted
-- `current_time` as its built-in timetz value instead of a PL/pgSQL timestamp variable.

begin;

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

revoke all on function public.start_job_status(text) from public, anon, authenticated;
grant execute on function public.start_job_status(text) to service_role;

create or replace function public.get_app_health_contract()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  base_contract jsonb;
  missing_items jsonb;
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'Admin access required.';
  end if;

  base_contract := extensions.get_app_health_contract_20260822();
  missing_items := coalesce(base_contract->'missing', '[]'::jsonb);

  if to_regprocedure('public.pick_window_opens_at(bigint)') is null then
    missing_items := missing_items || jsonb_build_array('pick_window_opens_at');
  end if;

  return jsonb_build_object(
    'healthy',
      coalesce((base_contract->>'healthy')::boolean, false)
      and jsonb_array_length(missing_items) = 0,
    'missing', missing_items,
    'version', '20260831_operational_timestamps_v2'
  );
end;
$$;

revoke all on function public.get_app_health_contract() from public, anon;
grant execute on function public.get_app_health_contract() to authenticated;

insert into public.app_metadata (key, value)
values ('schema_version', '20260831_operational_timestamps_v2')
on conflict (key) do update
set value = excluded.value, updated_at = timezone('utc', now());

commit;
