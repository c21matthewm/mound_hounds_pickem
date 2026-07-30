-- Bound reminder delivery work, expose degraded jobs, and make queue retries observable.

begin;

alter table public.job_runs
drop constraint if exists job_runs_status_check;

alter table public.job_runs
add constraint job_runs_status_check
check (status in ('running', 'succeeded', 'degraded', 'failed'));

create index if not exists idx_pick_reminders_race_window_status
on public.pick_reminders(race_id, reminder_type, delivery_status, attempt_count);

create or replace function public.finish_job_run(
  p_job_run_id bigint,
  p_status text,
  p_summary jsonb default '{}'::jsonb,
  p_error_message text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Service role required.';
  end if;

  if p_status not in ('succeeded', 'degraded', 'failed') then
    raise exception 'Job completion status must be succeeded, degraded, or failed.';
  end if;

  update public.job_runs
  set
    status = p_status,
    summary = coalesce(p_summary, '{}'::jsonb),
    error_message = nullif(left(coalesce(p_error_message, ''), 2000), ''),
    completed_at = timezone('utc', now())
  where id = p_job_run_id
    and status = 'running';
end;
$$;

revoke all on function public.finish_job_run(bigint, text, jsonb, text)
from public, anon, authenticated;
grant execute on function public.finish_job_run(bigint, text, jsonb, text)
to service_role;

create or replace function public.claim_pick_reminder_delivery(
  p_race_id bigint,
  p_user_id uuid,
  p_reminder_type text,
  p_channel text,
  p_recipient text
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  claimed_id bigint;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Service role required.';
  end if;

  insert into public.pick_reminders (
    race_id,
    user_id,
    reminder_type,
    channel,
    recipient,
    delivery_status,
    attempt_count,
    last_attempt_at,
    lease_expires_at,
    sent_at
  )
  values (
    p_race_id,
    p_user_id,
    p_reminder_type,
    p_channel,
    p_recipient,
    'pending',
    1,
    timezone('utc', now()),
    timezone('utc', now()) + interval '10 minutes',
    null
  )
  on conflict (race_id, user_id, reminder_type, channel) do update
  set
    recipient = excluded.recipient,
    delivery_status = 'pending',
    attempt_count = public.pick_reminders.attempt_count + 1,
    last_attempt_at = timezone('utc', now()),
    last_error = null,
    lease_expires_at = timezone('utc', now()) + interval '10 minutes'
  where (
      public.pick_reminders.delivery_status = 'failed'
      and public.pick_reminders.attempt_count < 3
      and (
        public.pick_reminders.last_attempt_at is null
        or public.pick_reminders.last_attempt_at <
          timezone('utc', now()) - interval '10 minutes'
      )
    ) or (
      public.pick_reminders.delivery_status = 'pending'
      and public.pick_reminders.attempt_count < 3
      and (
        public.pick_reminders.lease_expires_at is null
        or public.pick_reminders.lease_expires_at < timezone('utc', now())
      )
    )
  returning id into claimed_id;

  return claimed_id;
end;
$$;

revoke all on function public.claim_pick_reminder_delivery(bigint, uuid, text, text, text)
from public, anon, authenticated;
grant execute on function public.claim_pick_reminder_delivery(bigint, uuid, text, text, text)
to service_role;

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
    where table_schema = 'public'
      and table_name = 'races'
      and column_name = 'field_frozen_at'
  ) then
    missing_items := array_append(missing_items, 'races.field_frozen_at');
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'races'
      and column_name = 'pick_window_key'
  ) then
    missing_items := array_append(missing_items, 'races.pick_window_key');
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'league_seasons'
      and column_name = 'roster_configured_at'
  ) then
    missing_items := array_append(missing_items, 'league_seasons.roster_configured_at');
  end if;

  if to_regclass('public.season_registration_secrets') is null then
    missing_items := array_append(missing_items, 'season_registration_secrets');
  end if;

  if to_regclass('public.admin_audit_events') is null then
    missing_items := array_append(missing_items, 'admin_audit_events');
  end if;

  if to_regclass('public.job_runs') is null then
    missing_items := array_append(missing_items, 'job_runs');
  end if;

  if to_regclass('public.pick_reminders') is null then
    missing_items := array_append(missing_items, 'pick_reminders');
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

  return jsonb_build_object(
    'healthy', cardinality(missing_items) = 0,
    'missing', to_jsonb(missing_items),
    'version', '20260729_weekly_scale_v1'
  );
end;
$$;

revoke all on function public.get_app_health_contract() from public, anon;
grant execute on function public.get_app_health_contract() to authenticated;

insert into public.app_metadata (key, value)
values ('schema_version', '20260729_weekly_scale_v1')
on conflict (key) do update
set value = excluded.value, updated_at = timezone('utc', now());

commit;
