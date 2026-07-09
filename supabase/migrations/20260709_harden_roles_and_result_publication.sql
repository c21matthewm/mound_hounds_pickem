-- Harden profile roles and make race-result publication explicit and atomic.

alter table public.races
add column if not exists results_status text not null default 'draft';

alter table public.races
drop constraint if exists races_results_status_check;

alter table public.races
add constraint races_results_status_check
check (results_status in ('draft', 'published'));

alter table public.races
add column if not exists results_published_at timestamptz;

-- Preserve current production behavior for races that already have results.
update public.races r
set
  results_status = 'published',
  results_published_at = coalesce(r.results_published_at, r.updated_at, timezone('utc', now()))
where exists (
  select 1
  from public.results result_row
  where result_row.race_id = r.id
);

create index if not exists idx_races_results_status_date
on public.races(results_status, race_date);

-- Participants may edit their own profile details, but may never assign or change roles.
create or replace function public.protect_profile_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() = 'authenticated' and not public.is_admin(auth.uid()) then
    if tg_op = 'INSERT' and new.role <> 'participant' then
      raise exception 'Only an administrator may assign profile roles.';
    end if;

    if tg_op = 'UPDATE' and new.role is distinct from old.role then
      raise exception 'Only an administrator may change profile roles.';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_protect_profile_role on public.profiles;
create trigger trg_protect_profile_role
before insert or update of role on public.profiles
for each row execute function public.protect_profile_role();

revoke all on function public.protect_profile_role() from public;

drop policy if exists profiles_insert_self on public.profiles;
create policy profiles_insert_self
on public.profiles
for insert
to authenticated
with check (id = auth.uid() and role = 'participant');

-- Snapshot the exact result field before draft rows are accepted.
create or replace function public.ensure_race_result_field_snapshot(p_race_id bigint)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  existing_result_count integer;
  race_is_archived boolean;
  race_pick_format text;
  race_results_status text;
  snapshot_count integer;
begin
  select r.is_archived, r.pick_format, r.results_status
    into race_is_archived, race_pick_format, race_results_status
  from public.races r
  where r.id = p_race_id
  for update;

  if race_pick_format is null then
    raise exception 'Selected race was not found.';
  end if;

  if race_is_archived then
    raise exception 'Selected race is archived. Unarchive it before updating results.';
  end if;

  select count(*) into snapshot_count
  from public.race_driver_groups rg
  where rg.race_id = p_race_id;

  select count(*) into existing_result_count
  from public.results result_row
  where result_row.race_id = p_race_id;

  if snapshot_count = 0 then
    if existing_result_count > 0 and race_results_status = 'published' then
      raise exception 'This legacy published race has no historical driver-group snapshot. Current groups cannot be used to reconstruct it safely.';
    end if;

    if race_pick_format = 'indy_500' then
      raise exception 'Indianapolis 500 qualifying order must be uploaded before saving results.';
    end if;

    insert into public.race_driver_groups (race_id, driver_id, group_number)
    select p_race_id, d.id, d.group_number
    from public.drivers d
    where d.is_active = true
      and d.group_number between 1 and 6
    on conflict (race_id, driver_id) do nothing;

    select count(*) into snapshot_count
    from public.race_driver_groups rg
    where rg.race_id = p_race_id;
  end if;

  if snapshot_count = 0 then
    raise exception 'No drivers are available in the race result field.';
  end if;

  return snapshot_count;
end;
$$;

revoke all on function public.ensure_race_result_field_snapshot(bigint) from public, anon, authenticated;

-- Recompute driver totals and next-race groups from published races only.
create or replace function public.refresh_driver_standings_from_published_results()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  active_driver_count integer;
begin
  if coalesce(auth.role(), '') <> 'service_role' and not public.is_admin(auth.uid()) then
    raise exception 'Admin access required.';
  end if;

  update public.drivers d
  set championship_points = coalesce(points_by_driver.total_points, 0)
  from (
    select
      driver.id as driver_id,
      coalesce(sum(result_row.points) filter (where race.results_status = 'published'), 0)::integer as total_points
    from public.drivers driver
    left join public.results result_row on result_row.driver_id = driver.id
    left join public.races race on race.id = result_row.race_id
    group by driver.id
  ) points_by_driver
  where d.id = points_by_driver.driver_id;

  with ranked_active as (
    select
      d.id,
      row_number() over (
        order by d.championship_points desc, d.current_standing asc, d.driver_name asc
      )::integer as next_standing
    from public.drivers d
    where d.is_active = true
  )
  update public.drivers d
  set
    current_standing = ranked_active.next_standing,
    group_number = case
      when ranked_active.next_standing <= 4 then 1
      when ranked_active.next_standing <= 8 then 2
      when ranked_active.next_standing <= 12 then 3
      when ranked_active.next_standing <= 16 then 4
      when ranked_active.next_standing <= 20 then 5
      else 6
    end
  from ranked_active
  where d.id = ranked_active.id;

  select count(*) into active_driver_count
  from public.drivers d
  where d.is_active = true;

  with ranked_inactive as (
    select
      d.id,
      (active_driver_count + row_number() over (
        order by d.current_standing asc, d.driver_name asc
      ))::integer as next_standing
    from public.drivers d
    where d.is_active = false
  )
  update public.drivers d
  set
    current_standing = ranked_inactive.next_standing,
    group_number = 6
  from ranked_inactive
  where d.id = ranked_inactive.id;
end;
$$;

revoke all on function public.refresh_driver_standings_from_published_results() from public, anon;
grant execute on function public.refresh_driver_standings_from_published_results() to authenticated, service_role;

create or replace function public.save_race_result_draft(
  p_race_id bigint,
  p_driver_id bigint,
  p_points integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'Admin access required.';
  end if;

  if p_points is null or p_points < 0 then
    raise exception 'Points must be a non-negative integer.';
  end if;

  perform public.ensure_race_result_field_snapshot(p_race_id);

  if not exists (
    select 1
    from public.race_driver_groups rg
    where rg.race_id = p_race_id
      and rg.driver_id = p_driver_id
  ) then
    raise exception 'Selected driver is not part of this race result field.';
  end if;

  insert into public.results (race_id, driver_id, points)
  values (p_race_id, p_driver_id, p_points)
  on conflict (race_id, driver_id)
  do update set points = excluded.points;

  update public.races
  set
    results_status = 'draft',
    results_published_at = null,
    winner_profile_id = null,
    winner_source = 'auto',
    winner_is_manual_override = false,
    winner_auto_eligible_at = null,
    winner_set_at = null
  where id = p_race_id;

  perform public.refresh_driver_standings_from_published_results();
end;
$$;

revoke all on function public.save_race_result_draft(bigint, bigint, integer) from public, anon;
grant execute on function public.save_race_result_draft(bigint, bigint, integer) to authenticated;

create or replace function public.publish_saved_race_results(
  p_race_id bigint,
  p_official_winning_average_speed numeric
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  expected_count integer;
  saved_count integer;
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'Admin access required.';
  end if;

  if p_official_winning_average_speed is null or p_official_winning_average_speed <= 0 then
    raise exception 'Official winning average speed must be greater than zero.';
  end if;

  expected_count := public.ensure_race_result_field_snapshot(p_race_id);

  select count(*) into saved_count
  from public.results result_row
  where result_row.race_id = p_race_id;

  if saved_count <> expected_count then
    raise exception 'Cannot publish results: % of % required driver rows are saved.', saved_count, expected_count;
  end if;

  if exists (
    select 1
    from public.results result_row
    left join public.race_driver_groups rg
      on rg.race_id = result_row.race_id
      and rg.driver_id = result_row.driver_id
    where result_row.race_id = p_race_id
      and rg.driver_id is null
  ) then
    raise exception 'Cannot publish results because a saved driver is outside the race field.';
  end if;

  update public.races
  set
    official_winning_average_speed = p_official_winning_average_speed,
    results_status = 'published',
    results_published_at = timezone('utc', now()),
    winner_profile_id = null,
    winner_source = 'auto',
    winner_is_manual_override = false,
    winner_auto_eligible_at = timezone('utc', now()) + interval '15 minutes',
    winner_set_at = null
  where id = p_race_id;

  perform public.refresh_driver_standings_from_published_results();
  return saved_count;
end;
$$;

revoke all on function public.publish_saved_race_results(bigint, numeric) from public, anon;
grant execute on function public.publish_saved_race_results(bigint, numeric) to authenticated;

create or replace function public.publish_race_results(
  p_race_id bigint,
  p_results jsonb,
  p_official_winning_average_speed numeric
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  distinct_driver_count integer;
  distinct_position_count integer;
  expected_count integer;
  maximum_position integer;
  minimum_position integer;
  payload_count integer;
  race_pick_format text;
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'Admin access required.';
  end if;

  if jsonb_typeof(p_results) <> 'array' then
    raise exception 'Race results payload must be an array.';
  end if;

  if p_official_winning_average_speed is null or p_official_winning_average_speed <= 0 then
    raise exception 'Official winning average speed must be greater than zero.';
  end if;

  expected_count := public.ensure_race_result_field_snapshot(p_race_id);

  select r.pick_format into race_pick_format
  from public.races r
  where r.id = p_race_id;

  select
    count(*),
    count(distinct payload.driver_id),
    count(distinct payload.position),
    min(payload.position),
    max(payload.position)
    into
      payload_count,
      distinct_driver_count,
      distinct_position_count,
      minimum_position,
      maximum_position
  from jsonb_to_recordset(p_results) as payload(driver_id bigint, points integer, position integer);

  if payload_count = 0 or payload_count > expected_count then
    raise exception 'Cannot publish results: % official rows were supplied for a % driver snapshot.', payload_count, expected_count;
  end if;

  if race_pick_format = 'indy_500' and payload_count <> expected_count then
    raise exception 'Indianapolis 500 results require all % snapshotted drivers; % rows were supplied.', expected_count, payload_count;
  end if;

  if race_pick_format = 'standard' and expected_count - payload_count > 5 then
    raise exception 'Too many snapshotted drivers are absent from the official order (%). Review the pasted results before publishing.', expected_count - payload_count;
  end if;

  if distinct_driver_count <> payload_count then
    raise exception 'Cannot publish results because duplicate drivers were supplied.';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_results) as payload(driver_id bigint, points integer, position integer)
    where payload.driver_id is null
      or payload.points is null
      or payload.points < 0
      or payload.position is null
      or payload.position < 1
  ) then
    raise exception 'Every result requires a driver, a finishing position, and non-negative integer points.';
  end if;

  if distinct_position_count <> payload_count
    or minimum_position <> 1
    or maximum_position <> payload_count then
    raise exception 'Official finishing positions must be unique and contiguous from 1 through %.', payload_count;
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_results) as payload(driver_id bigint, points integer, position integer)
    left join public.race_driver_groups rg
      on rg.race_id = p_race_id
      and rg.driver_id = payload.driver_id
    where rg.driver_id is null
  ) then
    raise exception 'Cannot publish results because a supplied driver is outside the race field.';
  end if;

  if exists (
    select required_group.group_number
    from generate_series(1, case when race_pick_format = 'indy_500' then 8 else 6 end)
      as required_group(group_number)
    where not exists (
      select 1
      from jsonb_to_recordset(p_results) as payload(driver_id bigint, points integer, position integer)
      join public.race_driver_groups rg
        on rg.race_id = p_race_id
        and rg.driver_id = payload.driver_id
      where rg.group_number = required_group.group_number
    )
  ) then
    raise exception 'Official results must include at least one participating driver from every pick group.';
  end if;

  delete from public.results
  where race_id = p_race_id;

  insert into public.results (race_id, driver_id, points)
  select p_race_id, payload.driver_id, payload.points
  from jsonb_to_recordset(p_results) as payload(driver_id bigint, points integer, position integer);

  -- Drivers in the pickable snapshot but absent from the official order are nonstarters.
  insert into public.results (race_id, driver_id, points)
  select p_race_id, rg.driver_id, 0
  from public.race_driver_groups rg
  where rg.race_id = p_race_id
    and not exists (
      select 1
      from jsonb_to_recordset(p_results) as payload(driver_id bigint, points integer, position integer)
      where payload.driver_id = rg.driver_id
    );

  update public.races
  set
    official_winning_average_speed = p_official_winning_average_speed,
    results_status = 'published',
    results_published_at = timezone('utc', now()),
    winner_profile_id = null,
    winner_source = 'auto',
    winner_is_manual_override = false,
    winner_auto_eligible_at = timezone('utc', now()) + interval '15 minutes',
    winner_set_at = null
  where id = p_race_id;

  perform public.refresh_driver_standings_from_published_results();
  return expected_count;
end;
$$;

revoke all on function public.publish_race_results(bigint, jsonb, numeric) from public, anon;
grant execute on function public.publish_race_results(bigint, jsonb, numeric) to authenticated;

-- Participants can only read result rows after an administrator publishes the race.
drop policy if exists results_read_all on public.results;
drop policy if exists results_read_published_or_admin on public.results;
create policy results_read_published_or_admin
on public.results
for select
to authenticated
using (
  public.is_admin(auth.uid())
  or exists (
    select 1
    from public.races r
    where r.id = results.race_id
      and r.results_status = 'published'
  )
);

-- All authenticated writes must use the transactional draft/publication functions above.
drop policy if exists results_admin_write on public.results;
revoke insert, update, delete on table public.results from anon, authenticated;

-- Enforce both the deadline and prior-race publication at the database boundary.
create or replace function public.enforce_pick_deadline()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  pick_lock_at timestamptz;
  previous_race_name text;
  previous_results_status text;
  race_is_archived boolean;
  race_pick_format text;
  race_qualifying_start_at timestamptz;
  race_start_at timestamptz;
begin
  select r.qualifying_start_at, r.race_date, r.is_archived, r.pick_format
    into race_qualifying_start_at, race_start_at, race_is_archived, race_pick_format
  from public.races r
  where r.id = new.race_id;

  if race_qualifying_start_at is null or race_start_at is null then
    raise exception 'Race not found for pick submission';
  end if;

  if race_is_archived then
    raise exception 'Picks are disabled for archived races.';
  end if;

  select previous_race.race_name, previous_race.results_status
    into previous_race_name, previous_results_status
  from public.races previous_race
  where previous_race.is_archived = false
    and previous_race.race_date < race_start_at
    and extract(year from previous_race.race_date at time zone 'America/Indiana/Indianapolis') =
      extract(year from race_start_at at time zone 'America/Indiana/Indianapolis')
  order by previous_race.race_date desc
  limit 1;

  if previous_race_name is not null and previous_results_status <> 'published' then
    raise exception 'Picks are unavailable until % results are published.', previous_race_name;
  end if;

  pick_lock_at := case
    when race_pick_format = 'indy_500' then race_start_at
    else race_qualifying_start_at
  end;

  if pick_lock_at <= now() then
    if race_pick_format = 'indy_500' then
      raise exception 'Picks are locked because the race has already started.';
    end if;

    raise exception 'Picks are locked because qualifying has already started.';
  end if;

  return new;
end;
$$;

revoke all on function public.is_admin(uuid) from public, anon;
grant execute on function public.is_admin(uuid) to authenticated, service_role;
