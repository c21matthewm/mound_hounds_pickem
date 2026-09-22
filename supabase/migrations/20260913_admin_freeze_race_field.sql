-- Optional Race Week control. Reuses the existing shared-window snapshot logic.
-- No data backfill or schema-version change.
begin;
create or replace function public.admin_freeze_race_field(p_race_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
set lock_timeout = '3s'
set statement_timeout = '10s'
as $$
declare
  selected_race public.races%rowtype;
  selected_season public.league_seasons%rowtype;
  first_window_round integer;
  previous_window uuid;
  opens_at timestamptz;
  rows_frozen integer;
  was_frozen boolean;
begin
  if auth.role() is distinct from 'authenticated' or not public.is_admin(auth.uid()) then
    raise exception 'Only an admin can freeze a race field.' using errcode = '42501';
  end if;
  -- Fail promptly if roster/schedule maintenance is underway. These short-lived
  -- table locks prevent a partial driver read or changing window membership;
  -- NOWAIT avoids deadlocks with existing writers that lock rows in other orders.
  lock table public.races in share row exclusive mode nowait;
  lock table public.drivers in share mode nowait;
  select * into selected_race from public.races where id = p_race_id for update nowait;
  if not found or selected_race.is_archived then
    raise exception 'Select a non-archived race in the active season.';
  end if;
  select * into selected_season from public.league_seasons
    where id = selected_race.season_id for update nowait;
  if not found or selected_season.status <> 'active' then
    raise exception 'Fields can only be frozen for the active season.';
  end if;
  perform id from public.profiles where id = auth.uid() and role = 'admin' for share nowait;
  if not found then raise exception 'Admin access has changed. Refresh before trying again.'; end if;
  -- Lock every member before checking deadlines, including the first member when
  -- the admin opened the second doubleheader race.
  perform id from public.races where pick_window_key = selected_race.pick_window_key
    order by id for update nowait;
  if exists (select 1 from public.races where pick_window_key = selected_race.pick_window_key
    and (is_archived or season_id <> selected_race.season_id)) then
    raise exception 'The shared race window is not valid for field freezing.';
  end if;
  select bool_and(field_frozen_at is not null) into was_frozen
    from public.races where pick_window_key = selected_race.pick_window_key;
  if was_frozen then
    return jsonb_build_object('already_frozen', true, 'race_id', p_race_id);
  end if;
  if exists (select 1 from public.races where pick_window_key = selected_race.pick_window_key
    and now() >= case when pick_format = 'indy_500' then race_date else qualifying_start_at end) then
    raise exception 'This pick window has closed. Its field cannot be opened now.';
  end if;
  opens_at := public.pick_window_opens_at(p_race_id);
  if opens_at is not null and now() < opens_at then
    raise exception 'Opening-round picks open six days before qualifying. Wait until that window opens.';
  end if;
  select min(round_number) into first_window_round from public.races
    where pick_window_key = selected_race.pick_window_key;
  select pick_window_key into previous_window from public.races
    where season_id = selected_race.season_id and not is_archived and round_number < first_window_round
    order by round_number desc limit 1;
  if previous_window is not null and exists (
    select 1 from public.races where pick_window_key = previous_window and not is_archived
      and results_status <> 'published'
  ) then
    raise exception 'Publish every race in the previous pick window before freezing this field.';
  end if;
  rows_frozen := public.ensure_race_pick_field_snapshot(p_race_id);
  perform public.write_admin_audit_event(
    'freeze_race_field', 'race', p_race_id::text,
    format('Froze the pick field for %s and its shared window.', selected_race.race_name),
    jsonb_build_object('field_frozen', false),
    jsonb_build_object('field_frozen', true, 'pick_window_key', selected_race.pick_window_key,
      'driver_count', rows_frozen)
  );
  return jsonb_build_object('already_frozen', false, 'race_id', p_race_id, 'driver_count', rows_frozen);
end;
$$;
revoke all on function public.admin_freeze_race_field(bigint) from public, anon, service_role;
grant execute on function public.admin_freeze_race_field(bigint) to authenticated;
commit;
