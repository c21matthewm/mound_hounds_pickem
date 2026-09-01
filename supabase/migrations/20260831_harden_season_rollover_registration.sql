-- Separate early season registration from opening-round picks and simplify rollover activation.

begin;

create or replace function public.pick_window_opens_at(p_race_id bigint)
returns timestamptz
language sql
stable
security definer
set search_path = public
as $$
  with selected_race as (
    select race.season_id, race.pick_window_key
    from public.races race
    where race.id = p_race_id
      and race.is_archived = false
  ),
  selected_window as (
    select
      min(race.round_number) as first_round,
      min(race.qualifying_start_at) as qualifying_start_at,
      bool_or(race.field_frozen_at is not null) as field_is_frozen
    from public.races race
    join selected_race selected
      on selected.season_id = race.season_id
      and selected.pick_window_key = race.pick_window_key
    where race.is_archived = false
  ),
  season_schedule as (
    select min(race.round_number) as first_round
    from public.races race
    join selected_race selected on selected.season_id = race.season_id
    where race.is_archived = false
  )
  select case
    when coalesce(selected_window.field_is_frozen, false) then null
    when selected_window.first_round = season_schedule.first_round
      then selected_window.qualifying_start_at - interval '6 days'
    else null
  end
  from selected_window
  cross join season_schedule;
$$;

revoke all on function public.pick_window_opens_at(bigint) from public, anon;
grant execute on function public.pick_window_opens_at(bigint) to authenticated, service_role;

create or replace function public.enforce_pick_deadline()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  current_window_first_round smallint;
  pick_lock_at timestamptz;
  pick_open_at timestamptz;
  previous_pick_window_key uuid;
  selected_is_archived boolean;
  selected_pick_format text;
  selected_pick_window_key uuid;
  selected_qualifying_start_at timestamptz;
  selected_season_id bigint;
  selected_start_at timestamptz;
  unpublished_race_names text;
begin
  if current_setting('mound_hounds.restore_mode', true) = 'on' then
    return new;
  end if;

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

  pick_open_at := public.pick_window_opens_at(new.race_id);
  if pick_open_at is not null and timezone('utc', now()) < pick_open_at then
    raise exception 'The opening race pick form opens six days before qualifying.';
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

create or replace function public.activate_league_season(p_season_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_season public.league_seasons%rowtype;
  target_season public.league_seasons%rowtype;
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'Only an admin can activate a league season.';
  end if;

  select * into target_season
  from public.league_seasons
  where id = p_season_id
  for update;

  if target_season.id is null then
    raise exception 'Selected season was not found.';
  end if;

  if target_season.status = 'completed' then
    raise exception 'A completed season cannot be reactivated.';
  end if;

  select * into current_season
  from public.league_seasons
  where status = 'active'
  for update;

  if current_season.id = target_season.id then
    return;
  end if;

  if current_season.id is not null and not exists (
    select 1
    from public.hall_of_fame_seasons hall
    where hall.season_year = current_season.season_year
  ) then
    raise exception 'Finalize the % Hall of Fame standings before activating a new season.', current_season.season_year;
  end if;

  if current_season.id is not null then
    update public.league_seasons
    set status = 'completed', completed_at = timezone('utc', now())
    where id = current_season.id;
  end if;

  update public.drivers
  set
    opening_seed_standing = current_standing,
    championship_points = 0
  where is_active = true;

  update public.league_seasons
  set
    status = 'active',
    activated_at = timezone('utc', now()),
    completed_at = null
  where id = target_season.id;
end;
$$;

revoke all on function public.activate_league_season(bigint) from public, anon;
grant execute on function public.activate_league_season(bigint) to authenticated;

do $$
begin
  if to_regprocedure('extensions.get_app_health_contract_20260822()') is null
    and to_regprocedure('public.get_app_health_contract()') is not null then
    alter function public.get_app_health_contract()
      rename to get_app_health_contract_20260822;
    alter function public.get_app_health_contract_20260822()
      set schema extensions;
  end if;
end;
$$;

revoke all on function extensions.get_app_health_contract_20260822()
from public, anon, authenticated;

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
    'version', '20260831_season_rollover_v1'
  );
end;
$$;

revoke all on function public.get_app_health_contract() from public, anon;
grant execute on function public.get_app_health_contract() to authenticated;

insert into public.app_metadata (key, value)
values ('schema_version', '20260831_season_rollover_v1')
on conflict (key) do update
set value = excluded.value, updated_at = timezone('utc', now());

commit;
