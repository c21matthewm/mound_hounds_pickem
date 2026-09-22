-- Bounded, atomic Admin participant eligibility and explicit season enrollment.
-- is_active controls league eligibility; it never grants or revokes Admin access.
begin;

create or replace function public.admin_bulk_update_participants(
  p_operation text,
  p_season_id bigint,
  p_participants jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
set lock_timeout = '3s'
set statement_timeout = '10s'
as $$
declare
  selection jsonb;
  target_profile public.profiles%rowtype;
  selected_season public.league_seasons%rowtype;
  previous_status text;
  next_status text;
  enrollment boolean;
  before_rows jsonb := '[]'::jsonb;
  after_rows jsonb := '[]'::jsonb;
  selected_ids uuid[];
begin
  if auth.role() is distinct from 'authenticated' or not public.is_admin(auth.uid()) then
    raise exception 'Only an admin can update participant accounts.';
  end if;
  -- The web RPC uses READ COMMITTED. Reject old snapshots rather than miss a
  -- concurrently added enrollment or pick which was absent from that snapshot.
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception using errcode = '40001', message = 'Refresh Participants before updating accounts.';
  end if;
  if p_operation is null or p_operation not in ('enable', 'disable', 'register', 'decline') then
    raise exception 'Choose an eligibility or season registration action.';
  end if;
  if p_participants is null or jsonb_typeof(p_participants) <> 'array' then
    raise exception 'Select between 1 and 100 participant accounts.';
  end if;
  if jsonb_array_length(p_participants) not between 1 and 100 or octet_length(p_participants::text) > 25000 then
    raise exception 'Select between 1 and 100 participant accounts.';
  end if;
  enrollment := p_operation in ('register', 'decline');
  if (enrollment and (p_season_id is null or p_season_id <= 0)) or (not enrollment and p_season_id is not null) then
    raise exception 'Choose an active or upcoming season for registration changes.';
  end if;
  for selection in select value from jsonb_array_elements(p_participants) loop
    if jsonb_typeof(selection) <> 'object'
      or coalesce(selection->>'profile_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or jsonb_typeof(selection->'expected_is_active') is distinct from 'boolean'
      or not (selection ? 'expected_status')
      or (selection->'expected_status' <> 'null'::jsonb and selection->>'expected_status' not in ('registered','declined')) then
      raise exception 'Refresh Participants and select the accounts again.';
    end if;
  end loop;
  select array_agg((item->>'profile_id')::uuid order by item->>'profile_id') into selected_ids
    from jsonb_array_elements(p_participants) item;
  if cardinality(selected_ids) <> (select count(distinct id) from unnest(selected_ids) id) then
    raise exception 'Each participant may only be selected once.';
  end if;

  -- Existing pick/registration/rollover writers do not share one row-lock order.
  -- These brief NOWAIT table locks stabilize all checks, including absent picks
  -- and absent enrollment rows. Normal reads stay available; busy writes retry.
  lock table public.league_seasons, public.races, public.profiles,
    public.season_participants, public.picks in share row exclusive mode nowait;
  perform id from public.profiles where id = auth.uid() or id = any(selected_ids) order by id for update nowait;
  if not public.is_admin(auth.uid()) then raise exception 'Your admin access has changed. Refresh before trying again.'; end if;
  if (select count(*) from public.profiles where id = any(selected_ids)) <> cardinality(selected_ids) then
    raise exception 'A selected participant no longer exists. Refresh Participants.';
  end if;
  if enrollment then
    select * into selected_season from public.league_seasons where id = p_season_id for update nowait;
    if not found or selected_season.status not in ('active', 'upcoming') then
      raise exception 'Registration can only be changed for an active or upcoming season.';
    end if;
  end if;
  for selection in select value from jsonb_array_elements(p_participants) order by value->>'profile_id' loop
    select * into target_profile from public.profiles where id = (selection->>'profile_id')::uuid;
    previous_status := null;
    if enrollment then
      select status into previous_status from public.season_participants
        where season_id = p_season_id and profile_id = target_profile.id;
    end if;
    if target_profile.is_active is distinct from (selection->>'expected_is_active')::boolean
      or (enrollment and previous_status is distinct from selection->>'expected_status') then
      raise exception using errcode = '40001', message = 'Participant data changed. Refresh Participants and select the accounts again.';
    end if;
    if p_operation = 'register' and (not target_profile.is_active
      or length(trim(coalesce(target_profile.full_name, ''))) = 0
      or length(trim(coalesce(target_profile.team_name, ''))) = 0) then
      raise exception 'Every account must have participation enabled and a complete name and team before registration.';
    end if;
    if p_operation in ('disable', 'decline') and exists (
      select 1 from public.picks pick
      join public.races race on race.id = pick.race_id
      join public.league_seasons season on season.id = race.season_id
      where pick.user_id = target_profile.id
        and ((p_operation = 'decline' and race.season_id = p_season_id)
          or (p_operation = 'disable' and season.status in ('active', 'upcoming')))
    ) then
      raise exception 'A selected participant has submitted picks. No accounts were changed. Review that participant individually before removing them from scoring.';
    end if;
    before_rows := before_rows || jsonb_build_array(jsonb_build_object('profile_id',target_profile.id,'is_active',target_profile.is_active,'status',previous_status));
    if enrollment then
      next_status := case when p_operation = 'register' then 'registered' else 'declined' end;
      insert into public.season_participants(season_id,profile_id,status,registered_at,decided_at)
      values(p_season_id,target_profile.id,next_status,case when next_status='registered' then now() else null end,now())
      on conflict (season_id,profile_id) do update set
        status=excluded.status,
        registered_at=case when excluded.status='registered' then coalesce(public.season_participants.registered_at,excluded.registered_at) else null end,
        decided_at=excluded.decided_at;
    else
      update public.profiles set is_active=(p_operation='enable') where id=target_profile.id;
    end if;
    after_rows := after_rows || jsonb_build_array(jsonb_build_object('profile_id',target_profile.id,'is_active',case when enrollment then target_profile.is_active else p_operation='enable' end,'status',case when enrollment then next_status else null end));
  end loop;
  perform public.write_admin_audit_event('bulk_' || p_operation,'participants',p_season_id::text,
    format('Applied %s to %s participant account(s).',p_operation,cardinality(selected_ids)),
    jsonb_build_object('season_id',p_season_id,'participants',before_rows),
    jsonb_build_object('season_id',p_season_id,'participants',after_rows));
  return jsonb_build_object('updated_count',cardinality(selected_ids),'operation',p_operation,'season_id',p_season_id);
end;
$$;
revoke all on function public.admin_bulk_update_participants(text,bigint,jsonb) from public,anon,service_role;
grant execute on function public.admin_bulk_update_participants(text,bigint,jsonb) to authenticated;
commit;
