-- Support two standard races that share one qualifying session and pick deadline.

begin;

alter table public.races
add column if not exists pick_window_key uuid;

update public.races
set pick_window_key = extensions.gen_random_uuid()
where pick_window_key is null;

alter table public.races
alter column pick_window_key set default extensions.gen_random_uuid();

alter table public.races
alter column pick_window_key set not null;

create index if not exists idx_races_pick_window
on public.races(season_id, pick_window_key, round_number);

create or replace function public.validate_shared_pick_window()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  archive_count integer;
  format_count integer;
  maximum_round integer;
  minimum_round integer;
  qualifying_count integer;
  race_count integer;
  season_count integer;
begin
  select
    count(*)::integer,
    count(distinct race.is_archived)::integer,
    count(distinct race.season_id)::integer,
    count(distinct race.qualifying_start_at)::integer,
    count(distinct race.pick_format)::integer,
    min(race.round_number)::integer,
    max(race.round_number)::integer
  into
    race_count,
    archive_count,
    season_count,
    qualifying_count,
    format_count,
    minimum_round,
    maximum_round
  from public.races race
  where race.pick_window_key = new.pick_window_key;

  if race_count > 2 then
    raise exception 'A shared pick window can contain at most two races.';
  end if;

  if race_count > 1 then
    if archive_count <> 1 then
      raise exception 'Shared pick-window races must be archived or unarchived together.';
    end if;

    if season_count <> 1 then
      raise exception 'Shared pick-window races must belong to the same season.';
    end if;

    if qualifying_count <> 1 then
      raise exception 'Shared pick-window races must use the same qualifying start.';
    end if;

    if format_count <> 1 or exists (
      select 1
      from public.races race
      where race.pick_window_key = new.pick_window_key
        and race.pick_format <> 'standard'
    ) then
      raise exception 'Only standard-format races can share a pick window.';
    end if;

    if maximum_round - minimum_round <> 1 then
      raise exception 'Shared pick-window races must be consecutive rounds.';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_validate_shared_pick_window on public.races;
create constraint trigger trg_validate_shared_pick_window
after insert or update on public.races
deferrable initially deferred
for each row execute function public.validate_shared_pick_window();

create or replace function public.ensure_race_pick_field_snapshot(p_race_id bigint)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  selected_race public.races%rowtype;
  snapshot_count integer := 0;
  window_race public.races%rowtype;
begin
  select * into selected_race
  from public.races
  where id = p_race_id;

  if selected_race.id is null then
    raise exception 'Selected race was not found.';
  end if;

  for window_race in
    select *
    from public.races race
    where race.pick_window_key = selected_race.pick_window_key
    order by race.id
    for update
  loop
    if window_race.is_archived then
      raise exception 'Archived races cannot open a pick field.';
    end if;

    if window_race.field_frozen_at is null then
      if window_race.pick_format = 'standard' then
        insert into public.race_driver_groups (
          race_id,
          driver_id,
          group_number,
          qualifying_position
        )
        select
          window_race.id,
          driver.id,
          driver.group_number,
          null
        from public.drivers driver
        where driver.is_active = true
        on conflict (race_id, driver_id) do nothing;
      end if;

      select count(*)::integer into snapshot_count
      from public.race_driver_groups
      where race_id = window_race.id;

      if window_race.pick_format = 'indy_500' and snapshot_count <> 33 then
        raise exception 'Import the complete 33-driver qualifying order before opening Indianapolis 500 picks.';
      end if;

      if window_race.pick_format = 'standard' and (
        snapshot_count < 6 or exists (
          select group_number
          from generate_series(1, 6) as expected(group_number)
          where not exists (
            select 1
            from public.race_driver_groups race_group
            where race_group.race_id = window_race.id
              and race_group.group_number = expected.group_number
          )
        )
      ) then
        raise exception 'Every standard pick group must contain at least one active driver before picks can open.';
      end if;

      update public.races
      set field_frozen_at = timezone('utc', now())
      where id = window_race.id;
    end if;
  end loop;

  select count(*)::integer into snapshot_count
  from public.race_driver_groups
  where race_id = p_race_id;

  return snapshot_count;
end;
$$;

revoke all on function public.ensure_race_pick_field_snapshot(bigint) from public, anon;
grant execute on function public.ensure_race_pick_field_snapshot(bigint)
to service_role;

create or replace function public.protect_frozen_race_configuration()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.field_frozen_at is not null
    or exists (select 1 from public.picks where race_id = old.id)
    or exists (select 1 from public.results where race_id = old.id) then
    if new.season_id is distinct from old.season_id
      or new.round_number is distinct from old.round_number
      or new.pick_format is distinct from old.pick_format
      or new.pick_window_key is distinct from old.pick_window_key then
      raise exception 'Season, round, pick format, and shared pick window are locked after a race field, pick, or result exists.';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_protect_frozen_race_configuration on public.races;
create trigger trg_protect_frozen_race_configuration
before update of season_id, round_number, pick_format, pick_window_key on public.races
for each row execute function public.protect_frozen_race_configuration();

create or replace function public.enforce_pick_deadline()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  current_window_first_round smallint;
  previous_pick_window_key uuid;
  unpublished_race_names text;
  selected_is_archived boolean;
  selected_pick_format text;
  selected_pick_window_key uuid;
  selected_qualifying_start_at timestamptz;
  selected_season_id bigint;
  selected_start_at timestamptz;
  pick_lock_at timestamptz;
begin
  select
    race.qualifying_start_at,
    race.race_date,
    race.is_archived,
    race.pick_format,
    race.season_id,
    race.pick_window_key
  into
    selected_qualifying_start_at,
    selected_start_at,
    selected_is_archived,
    selected_pick_format,
    selected_season_id,
    selected_pick_window_key
  from public.races race
  where race.id = new.race_id;

  if selected_qualifying_start_at is null or selected_start_at is null then
    raise exception 'Race not found for pick submission';
  end if;

  if selected_is_archived then
    raise exception 'Picks are disabled for archived races.';
  end if;

  if not public.is_registered_for_season(new.user_id, selected_season_id) then
    raise exception 'Register for this league season before submitting picks.';
  end if;

  if not exists (
    select 1
    from public.league_seasons season
    where season.id = selected_season_id
      and season.status = 'active'
  ) then
    raise exception 'Picks are only accepted for the active league season.';
  end if;

  select min(race.round_number)
  into current_window_first_round
  from public.races race
  where race.season_id = selected_season_id
    and race.pick_window_key = selected_pick_window_key
    and race.is_archived = false;

  select previous_race.pick_window_key
  into previous_pick_window_key
  from public.races previous_race
  where previous_race.is_archived = false
    and previous_race.season_id = selected_season_id
    and previous_race.round_number < current_window_first_round
  order by previous_race.round_number desc
  limit 1;

  if previous_pick_window_key is not null then
    select string_agg(previous_race.race_name, ', ' order by previous_race.round_number)
    into unpublished_race_names
    from public.races previous_race
    where previous_race.is_archived = false
      and previous_race.season_id = selected_season_id
      and previous_race.pick_window_key = previous_pick_window_key
      and previous_race.results_status <> 'published';
  end if;

  if unpublished_race_names is not null then
    raise exception 'Picks are unavailable until results are published for: %.', unpublished_race_names;
  end if;

  pick_lock_at := case
    when selected_pick_format = 'indy_500' then selected_start_at
    else selected_qualifying_start_at
  end;

  if timezone('utc', now()) >= pick_lock_at then
    if selected_pick_format = 'indy_500' then
      raise exception 'Picks are locked because the race has already started.';
    end if;

    raise exception 'Picks are locked because qualifying has already started.';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_enforce_pick_deadline on public.picks;
create trigger trg_enforce_pick_deadline
before insert or update on public.picks
for each row execute function public.enforce_pick_deadline();

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

  if to_regprocedure('public.protect_race_history_from_delete()') is null then
    missing_items := array_append(missing_items, 'protect_race_history_from_delete');
  end if;

  if to_regprocedure('public.protect_driver_history_from_delete()') is null then
    missing_items := array_append(missing_items, 'protect_driver_history_from_delete');
  end if;

  return jsonb_build_object(
    'healthy', cardinality(missing_items) = 0,
    'missing', to_jsonb(missing_items),
    'version', '20260726_shared_pick_windows'
  );
end;
$$;

revoke all on function public.get_app_health_contract() from public, anon;
grant execute on function public.get_app_health_contract() to authenticated;

insert into public.app_metadata (key, value)
values ('schema_version', '20260726_shared_pick_windows')
on conflict (key) do update
set value = excluded.value, updated_at = timezone('utc', now());

commit;
