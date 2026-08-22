-- Rate-safe reminder eligibility and atomic qualifying corrections for all pick windows.

begin;

create or replace function public.validate_pick_reminder_delivery(
  p_reminder_id bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  anchor_race public.races%rowtype;
  current_reminder_type text;
  deadline_at timestamptz;
  missing_races jsonb;
  reminder_row public.pick_reminders%rowtype;
  window_races jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Service role required.';
  end if;

  select * into reminder_row
  from public.pick_reminders reminder
  where reminder.id = p_reminder_id
    and reminder.delivery_status = 'pending';

  if reminder_row.id is null then
    return jsonb_build_object('valid', false);
  end if;

  select * into anchor_race
  from public.races race
  where race.id = reminder_row.race_id
    and race.is_archived = false;

  if anchor_race.id is null
    or not exists (
      select 1
      from public.league_seasons season
      where season.id = anchor_race.season_id
        and season.status = 'active'
    )
    or not exists (
      select 1
      from public.season_participants participant
      join public.profiles profile on profile.id = participant.profile_id
      where participant.profile_id = reminder_row.user_id
        and participant.season_id = anchor_race.season_id
        and participant.status = 'registered'
        and profile.is_active = true
    ) then
    return jsonb_build_object('valid', false);
  end if;

  deadline_at := case
    when anchor_race.pick_format = 'indy_500' then anchor_race.race_date
    else anchor_race.qualifying_start_at
  end;

  current_reminder_type := case
    when deadline_at <= timezone('utc', now()) then null
    when deadline_at - timezone('utc', now()) <= interval '4 hours' then '4h'
    when deadline_at - timezone('utc', now()) <= interval '2 days' then '2d'
    when deadline_at - timezone('utc', now()) <= interval '5 days' then '5d_open'
    else null
  end;

  if current_reminder_type is distinct from reminder_row.reminder_type then
    return jsonb_build_object('valid', false);
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', race.id,
        'pick_format', race.pick_format,
        'pick_window_key', race.pick_window_key,
        'qualifying_start_at', race.qualifying_start_at,
        'race_date', race.race_date,
        'race_name', race.race_name,
        'round_number', race.round_number,
        'season_id', race.season_id
      )
      order by race.round_number, race.id
    ),
    '[]'::jsonb
  ) into window_races
  from public.races race
  where race.season_id = anchor_race.season_id
    and race.pick_window_key = anchor_race.pick_window_key
    and race.is_archived = false;

  select coalesce(
    jsonb_agg(race_row order by (race_row ->> 'round_number')::integer),
    '[]'::jsonb
  ) into missing_races
  from jsonb_array_elements(window_races) as window_race(race_row)
  where not exists (
    select 1
    from public.picks pick
    where pick.user_id = reminder_row.user_id
      and pick.race_id = (race_row ->> 'id')::bigint
  );

  if jsonb_array_length(missing_races) = 0 then
    return jsonb_build_object('valid', false);
  end if;

  return jsonb_build_object(
    'valid', true,
    'races', window_races,
    'missingRaces', missing_races
  );
end;
$$;

revoke all on function public.validate_pick_reminder_delivery(bigint)
from public, anon, authenticated;
grant execute on function public.validate_pick_reminder_delivery(bigint)
to service_role;

create or replace function public.correct_pick_window_qualifying_start(
  p_race_id bigint,
  p_qualifying_start_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  affected_race_ids bigint[];
  affected_race_names text[];
  earliest_race_start timestamptz;
  previous_qualifying_start timestamptz;
  removed_queue_rows integer := 0;
  selected_race public.races%rowtype;
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'Admin access required.';
  end if;

  if p_qualifying_start_at is null then
    raise exception 'A corrected qualifying start is required.';
  end if;

  select * into selected_race
  from public.races race
  where race.id = p_race_id
  for update;

  if selected_race.id is null then
    raise exception 'Selected race was not found.';
  end if;
  if selected_race.is_archived then
    raise exception 'Archived races cannot receive schedule corrections.';
  end if;
  if selected_race.pick_format <> 'standard' then
    raise exception 'This correction applies only to races that lock at qualifying.';
  end if;
  if not exists (
    select 1
    from public.league_seasons season
    where season.id = selected_race.season_id
      and season.status = 'active'
  ) then
    raise exception 'Qualifying corrections are limited to the active season.';
  end if;
  if p_qualifying_start_at <= timezone('utc', now()) then
    raise exception 'The corrected qualifying start must be in the future.';
  end if;

  perform race.id
  from public.races race
  where race.season_id = selected_race.season_id
    and race.pick_window_key = selected_race.pick_window_key
  order by race.id
  for update;

  select
    array_agg(race.id order by race.round_number, race.id),
    array_agg(race.race_name order by race.round_number, race.id),
    min(race.race_date),
    min(race.qualifying_start_at)
  into
    affected_race_ids,
    affected_race_names,
    earliest_race_start,
    previous_qualifying_start
  from public.races race
  where race.season_id = selected_race.season_id
    and race.pick_window_key = selected_race.pick_window_key
    and race.is_archived = false;

  if coalesce(cardinality(affected_race_ids), 0) = 0 then
    raise exception 'The selected pick window has no active races.';
  end if;
  if p_qualifying_start_at > earliest_race_start then
    raise exception 'The corrected qualifying start cannot be after a race in this pick window starts.';
  end if;

  update public.races race
  set qualifying_start_at = p_qualifying_start_at
  where race.id = any(affected_race_ids);

  delete from public.pick_reminders reminder
  where reminder.race_id = any(affected_race_ids)
    and reminder.delivery_status <> 'sent';
  get diagnostics removed_queue_rows = row_count;

  insert into public.admin_audit_events (
    actor_profile_id,
    action,
    entity_type,
    entity_id,
    summary,
    before_state,
    after_state
  )
  values (
    auth.uid(),
    'schedule_correction',
    'pick_window',
    selected_race.pick_window_key::text,
    format(
      'Corrected qualifying start for %s race%s.',
      cardinality(affected_race_ids),
      case when cardinality(affected_race_ids) = 1 then '' else 's' end
    ),
    jsonb_build_object(
      'qualifying_start_at', previous_qualifying_start,
      'race_ids', to_jsonb(affected_race_ids),
      'race_names', to_jsonb(affected_race_names)
    ),
    jsonb_build_object(
      'qualifying_start_at', p_qualifying_start_at,
      'race_ids', to_jsonb(affected_race_ids),
      'race_names', to_jsonb(affected_race_names),
      'removed_unsent_reminders', removed_queue_rows
    )
  );

  return jsonb_build_object(
    'raceCount', cardinality(affected_race_ids),
    'raceIds', to_jsonb(affected_race_ids),
    'previousQualifyingStartAt', previous_qualifying_start,
    'qualifyingStartAt', p_qualifying_start_at,
    'removedUnsentReminders', removed_queue_rows
  );
end;
$$;

revoke all on function public.correct_pick_window_qualifying_start(bigint,timestamptz)
from public, anon;
grant execute on function public.correct_pick_window_qualifying_start(bigint,timestamptz)
to authenticated;

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
  if to_regclass('public.app_error_events') is null then
    missing_items := array_append(missing_items, 'app_error_events');
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
  if to_regprocedure('public.correct_pick_window_qualifying_start(bigint,timestamptz)') is null then
    missing_items := array_append(missing_items, 'correct_pick_window_qualifying_start');
  end if;
  if to_regprocedure('public.validate_pick_reminder_delivery(bigint)') is null then
    missing_items := array_append(missing_items, 'validate_pick_reminder_delivery');
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
  if to_regprocedure('public.record_app_error_event(uuid,text,text,text,text,text,jsonb,uuid)') is null then
    missing_items := array_append(missing_items, 'record_app_error_event');
  end if;
  if to_regprocedure('public.resolve_app_error_event(bigint)') is null then
    missing_items := array_append(missing_items, 'resolve_app_error_event');
  end if;
  if to_regprocedure('public.prune_app_error_events()') is null then
    missing_items := array_append(missing_items, 'prune_app_error_events');
  end if;

  return jsonb_build_object(
    'healthy', cardinality(missing_items) = 0,
    'missing', to_jsonb(missing_items),
    'version', '20260822_reminder_delivery_v1'
  );
end;
$$;

revoke all on function public.get_app_health_contract() from public, anon;
grant execute on function public.get_app_health_contract() to authenticated;

insert into public.app_metadata (key, value)
values ('schema_version', '20260822_reminder_delivery_v1')
on conflict (key) do update
set value = excluded.value, updated_at = timezone('utc', now());

commit;
