-- Identical pick submissions preserve the original saved timestamp and version.
-- Keep the atomic upsert and its existing validation triggers: even a no-op must
-- pass enrollment, season, opening/deadline and frozen-field checks.
begin;

create or replace function public.save_weekly_pick(
  p_race_id bigint,
  p_average_speed numeric,
  p_driver_ids bigint[]
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  expected_group_count integer;
  next_race_id bigint;
  race_name text;
  saved_pick public.picks%rowtype;
  submission_changed boolean;
  saved_race_count integer;
  selected_race public.races%rowtype;
  submission_version integer;
  window_race_count integer;
begin
  if current_user_id is null then
    raise exception 'Authentication required.';
  end if;

  if p_average_speed is null or p_average_speed <= 0 or p_average_speed > 300 then
    raise exception 'Enter an average speed between 0 and 300 MPH.';
  end if;

  select * into selected_race
  from public.races
  where id = p_race_id;

  if selected_race.id is null then
    raise exception 'Selected race was not found.';
  end if;

  expected_group_count := case
    when selected_race.pick_format = 'indy_500' then 8
    else 6
  end;

  if p_driver_ids is null
    or array_length(p_driver_ids, 1) is distinct from expected_group_count
    or array_position(p_driver_ids, null) is not null then
    raise exception 'Select one driver from each of the % groups.', expected_group_count;
  end if;

  if (
    select count(distinct driver_id)
    from unnest(p_driver_ids) selected(driver_id)
  ) <> expected_group_count then
    raise exception 'Select a different driver in each group.';
  end if;

  insert into public.picks as existing_pick (
    user_id,
    race_id,
    average_speed,
    driver_group1_id,
    driver_group2_id,
    driver_group3_id,
    driver_group4_id,
    driver_group5_id,
    driver_group6_id,
    driver_group7_id,
    driver_group8_id
  )
  values (
    current_user_id,
    selected_race.id,
    p_average_speed,
    p_driver_ids[1],
    p_driver_ids[2],
    p_driver_ids[3],
    p_driver_ids[4],
    p_driver_ids[5],
    p_driver_ids[6],
    case when expected_group_count = 8 then p_driver_ids[7] else null end,
    case when expected_group_count = 8 then p_driver_ids[8] else null end
  )
  on conflict (user_id, race_id) do update
  set
    average_speed = excluded.average_speed,
    driver_group1_id = excluded.driver_group1_id,
    driver_group2_id = excluded.driver_group2_id,
    driver_group3_id = excluded.driver_group3_id,
    driver_group4_id = excluded.driver_group4_id,
    driver_group5_id = excluded.driver_group5_id,
    driver_group6_id = excluded.driver_group6_id,
    driver_group7_id = excluded.driver_group7_id,
    driver_group8_id = excluded.driver_group8_id
  where row(
    existing_pick.average_speed,
    existing_pick.driver_group1_id,
    existing_pick.driver_group2_id,
    existing_pick.driver_group3_id,
    existing_pick.driver_group4_id,
    existing_pick.driver_group5_id,
    existing_pick.driver_group6_id,
    existing_pick.driver_group7_id,
    existing_pick.driver_group8_id
  ) is distinct from row(
    excluded.average_speed,
    excluded.driver_group1_id,
    excluded.driver_group2_id,
    excluded.driver_group3_id,
    excluded.driver_group4_id,
    excluded.driver_group5_id,
    excluded.driver_group6_id,
    excluded.driver_group7_id,
    excluded.driver_group8_id
  )
  returning * into saved_pick;

  submission_changed := found;
  if not submission_changed then
    -- ON CONFLICT still locks the existing row. BEFORE INSERT triggers have
    -- already validated enrollment, the active season, deadline and field.
    -- Return that locked saved record without updating its timestamp/history.
    select * into saved_pick
    from public.picks pick
    where pick.user_id = current_user_id
      and pick.race_id = selected_race.id;
  end if;

  select max(version.submission_version)
  into submission_version
  from public.pick_submission_versions version
  where version.user_id = current_user_id
    and version.race_id = selected_race.id;

  select count(*)
  into window_race_count
  from public.races race
  where race.season_id = selected_race.season_id
    and race.pick_window_key = selected_race.pick_window_key
    and race.is_archived = false;

  select count(*)
  into saved_race_count
  from public.picks pick
  join public.races race on race.id = pick.race_id
  where pick.user_id = current_user_id
    and race.season_id = selected_race.season_id
    and race.pick_window_key = selected_race.pick_window_key
    and race.is_archived = false;

  select race.id
  into next_race_id
  from public.races race
  where race.season_id = selected_race.season_id
    and race.pick_window_key = selected_race.pick_window_key
    and race.is_archived = false
    and not exists (
      select 1
      from public.picks pick
      where pick.user_id = current_user_id
        and pick.race_id = race.id
    )
  order by race.round_number, race.id
  limit 1;

  select race.race_name
  into race_name
  from public.races race
  where race.id = next_race_id;

  return jsonb_build_object(
    'pickId', saved_pick.id,
    'raceId', saved_pick.race_id,
    'updatedAt', saved_pick.updated_at,
    'submissionVersion', submission_version,
    'savedRaceCount', saved_race_count,
    'windowRaceCount', window_race_count,
    'nextRaceId', next_race_id,
    'message',
      case
        when not submission_changed and next_race_id is not null then
          format('%s picks are already saved. Complete %s next.', selected_race.race_name, race_name)
        when not submission_changed and window_race_count > 1 then
          'Both doubleheader race submissions are already saved.'
        when not submission_changed then
          'Your picks are already saved.'
        when next_race_id is not null then
          format('%s picks saved. Complete %s next.', selected_race.race_name, race_name)
        when window_race_count > 1 then
          'Both doubleheader race submissions are saved.'
        else
          'Your picks are saved.'
      end
  );
end;
$$;

revoke all on function public.save_weekly_pick(bigint, numeric, bigint[])
from public, anon;
grant execute on function public.save_weekly_pick(bigint, numeric, bigint[])
to authenticated;

insert into public.app_metadata(key, value)
values ('pick_save_idempotency_version', '20260930')
on conflict (key) do update
set value = excluded.value, updated_at = timezone('utc', now());

commit;
