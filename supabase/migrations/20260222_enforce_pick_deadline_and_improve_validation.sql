create or replace function public.enforce_pick_deadline()
returns trigger
language plpgsql
as $$
declare
  race_qualifying_start_at timestamptz;
begin
  select r.qualifying_start_at
    into race_qualifying_start_at
  from public.races r
  where r.id = new.race_id;

  if race_qualifying_start_at is null then
    raise exception 'Race not found for pick submission';
  end if;

  if race_qualifying_start_at <= now() then
    raise exception 'Picks are locked because qualifying has already started.';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_enforce_pick_deadline on public.picks;
create trigger trg_enforce_pick_deadline
before insert or update on public.picks
for each row execute function public.enforce_pick_deadline();

create or replace function public.validate_pick_groups()
returns trigger
language plpgsql
as $$
declare
  selected_driver_ids bigint[];
  distinct_count integer;
begin
  selected_driver_ids := array[
    new.driver_group1_id,
    new.driver_group2_id,
    new.driver_group3_id,
    new.driver_group4_id,
    new.driver_group5_id,
    new.driver_group6_id
  ];

  if not exists (select 1 from public.drivers where id = new.driver_group1_id and group_number = 1 and is_active) then
    raise exception 'Invalid Group 1 driver';
  end if;
  if not exists (select 1 from public.drivers where id = new.driver_group2_id and group_number = 2 and is_active) then
    raise exception 'Invalid Group 2 driver';
  end if;
  if not exists (select 1 from public.drivers where id = new.driver_group3_id and group_number = 3 and is_active) then
    raise exception 'Invalid Group 3 driver';
  end if;
  if not exists (select 1 from public.drivers where id = new.driver_group4_id and group_number = 4 and is_active) then
    raise exception 'Invalid Group 4 driver';
  end if;
  if not exists (select 1 from public.drivers where id = new.driver_group5_id and group_number = 5 and is_active) then
    raise exception 'Invalid Group 5 driver';
  end if;
  if not exists (select 1 from public.drivers where id = new.driver_group6_id and group_number = 6 and is_active) then
    raise exception 'Invalid Group 6 driver';
  end if;

  select count(distinct d) into distinct_count
  from unnest(selected_driver_ids) as t(d);

  if distinct_count <> 6 then
    raise exception 'Each pick must contain 6 distinct drivers';
  end if;

  return new;
end;
$$;
