-- Atomic roster status changes preserve saved fields, picks and results.
begin;
create or replace function public.admin_set_driver_roster_status(p_drivers jsonb, p_is_active boolean)
returns jsonb language plpgsql security definer
set search_path = public
set lock_timeout = '3s'
set statement_timeout = '10s'
as $$
declare
  ids bigint[];
  selected_count integer;
  changed_count integer;
  active_count integer;
  before_rows jsonb;
begin
  if auth.role() is distinct from 'authenticated' or not public.is_admin(auth.uid()) then
    raise exception 'Only an admin can update the driver roster.' using errcode = '42501';
  end if;
  if p_is_active is null or jsonb_typeof(p_drivers) is distinct from 'array' then
    raise exception 'Choose a roster status and between 1 and 100 drivers.';
  end if;
  selected_count := jsonb_array_length(p_drivers);
  if selected_count < 1 or selected_count > 100 or octet_length(p_drivers::text) > 20000 then
    raise exception 'Choose between 1 and 100 drivers.';
  end if;
  if exists (select 1 from jsonb_array_elements(p_drivers) item
    where jsonb_typeof(item) is distinct from 'object'
      or jsonb_typeof(item->'id') is distinct from 'number'
      or coalesce(item->>'id','') !~ '^[1-9][0-9]{0,14}$'
      or jsonb_typeof(item->'expected_is_active') is distinct from 'boolean') then
    raise exception 'Every selected driver requires a valid id and expected current status.';
  end if;
  select array_agg((item->>'id')::bigint order by (item->>'id')::bigint) into ids
    from jsonb_array_elements(p_drivers) item;
  if (select count(distinct id) from unnest(ids) id) <> selected_count then
    raise exception 'Select each driver only once.';
  end if;
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'Retry this roster update in a new Read Committed transaction.' using errcode = '40001';
  end if;
  -- Ranking touches the entire roster. Briefly stabilize it and fail promptly
  -- during another write instead of leaving a partial update. Reads continue.
  lock table public.drivers in exclusive mode nowait;
  perform id from public.profiles where id = auth.uid() and role = 'admin' for share nowait;
  if not found then raise exception 'Admin access changed. Refresh before trying again.'; end if;
  if (select count(*) from public.drivers where id = any(ids)) <> selected_count then
    raise exception 'A selected driver no longer exists. Refresh the roster.';
  end if;
  if exists (select 1 from jsonb_array_elements(p_drivers) item
    join public.drivers d on d.id = (item->>'id')::bigint
    where d.is_active is distinct from (item->>'expected_is_active')::boolean) then
    raise exception 'A selected driver status changed. Refresh before trying again.';
  end if;
  select jsonb_agg(jsonb_build_object('id',id,'driver_name',driver_name,'is_active',is_active) order by id)
    into before_rows from public.drivers where id = any(ids);
  update public.drivers set is_active = p_is_active where id = any(ids) and is_active is distinct from p_is_active;
  get diagnostics changed_count = row_count;
  if changed_count = 0 then return jsonb_build_object('changed_count',0); end if;
  -- Use the same seeded tie order as published-results and manual roster refreshes.
  -- Points and opening seeds stay intact; only current ranks and groups change.
  with ranked as (
    select id,row_number() over(order by championship_points desc,opening_seed_standing asc nulls last,current_standing,driver_name,id)::integer as n
    from public.drivers where is_active
  ) update public.drivers d set current_standing = ranked.n,group_number = least(6,((ranked.n-1)/4)+1)
    from ranked where d.id = ranked.id;
  select count(*) into active_count from public.drivers where is_active;
  with ranked as (
    select id,row_number() over(order by current_standing,driver_name,id)::integer as n
    from public.drivers where not is_active
  ) update public.drivers d set current_standing = active_count+ranked.n,group_number = 6
    from ranked where d.id = ranked.id;
  perform public.write_admin_audit_event('bulk_driver_roster_status','driver_roster','current',
    format('Set %s drivers %s.',changed_count,case when p_is_active then 'active' else 'inactive' end),
    jsonb_build_object('drivers',before_rows),
    jsonb_build_object('driver_ids',ids,'is_active',p_is_active,'changed_count',changed_count));
  return jsonb_build_object('changed_count',changed_count);
end;
$$;
revoke all on function public.admin_set_driver_roster_status(jsonb,boolean) from public,anon,service_role;
grant execute on function public.admin_set_driver_roster_status(jsonb,boolean) to authenticated;
commit;
