alter table public.races
add column if not exists pick_format text not null default 'standard';

alter table public.races
drop constraint if exists races_pick_format_check;

alter table public.races
add constraint races_pick_format_check
check (pick_format in ('standard', 'indy_500'));

alter table public.picks
add column if not exists driver_group7_id bigint references public.drivers(id);

alter table public.picks
add column if not exists driver_group8_id bigint references public.drivers(id);

alter table public.race_driver_groups
drop constraint if exists race_driver_groups_group_number_check;

alter table public.race_driver_groups
add constraint race_driver_groups_group_number_check
check (group_number between 1 and 8);

alter table public.race_driver_groups
add column if not exists qualifying_position integer
check (qualifying_position is null or qualifying_position > 0);

create index if not exists idx_race_driver_groups_race_qualifying_position
on public.race_driver_groups(race_id, qualifying_position)
where qualifying_position is not null;

create or replace function public.ensure_race_driver_groups_snapshot_from_results()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  race_pick_format text;
begin
  select r.pick_format
    into race_pick_format
  from public.races r
  where r.id = new.race_id;

  if race_pick_format is null then
    raise exception 'Race not found for result group snapshot.';
  end if;

  if race_pick_format = 'indy_500' then
    if not exists (
      select 1
      from public.race_driver_groups rg
      where rg.race_id = new.race_id
      limit 1
    ) then
      raise exception 'Indianapolis 500 qualifying order must be uploaded before saving race results.';
    end if;

    return new;
  end if;

  if not exists (
    select 1
    from public.race_driver_groups rg
    where rg.race_id = new.race_id
    limit 1
  ) then
    insert into public.race_driver_groups (race_id, driver_id, group_number)
    select
      new.race_id,
      d.id,
      d.group_number
    from public.drivers d
    where d.is_active = true
      and d.group_number between 1 and 6
    on conflict (race_id, driver_id) do nothing;
  end if;

  return new;
end;
$$;

create or replace function public.enforce_pick_deadline()
returns trigger
language plpgsql
as $$
declare
  race_qualifying_start_at timestamptz;
  race_start_at timestamptz;
  race_is_archived boolean;
  race_pick_format text;
  pick_lock_at timestamptz;
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

create or replace function public.validate_pick_groups()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  selected_driver_ids bigint[];
  distinct_count integer;
  group_index integer;
  selected_driver_id bigint;
  race_pick_format text;
  expected_group_count integer;
begin
  select r.pick_format
    into race_pick_format
  from public.races r
  where r.id = new.race_id;

  if race_pick_format is null then
    raise exception 'Race not found for pick validation';
  end if;

  if race_pick_format = 'indy_500' then
    expected_group_count := 8;
    selected_driver_ids := array[
      new.driver_group1_id,
      new.driver_group2_id,
      new.driver_group3_id,
      new.driver_group4_id,
      new.driver_group5_id,
      new.driver_group6_id,
      new.driver_group7_id,
      new.driver_group8_id
    ];

    if new.driver_group7_id is null or new.driver_group8_id is null then
      raise exception 'Indianapolis 500 picks require one driver from each of 8 groups';
    end if;

    for group_index in 1..8 loop
      selected_driver_id := selected_driver_ids[group_index];

      if not exists (
        select 1
        from public.drivers d
        join public.race_driver_groups rg
          on rg.driver_id = d.id
        where d.id = selected_driver_id
          and d.is_active
          and rg.race_id = new.race_id
          and rg.group_number = group_index
      ) then
        raise exception 'Invalid Group % driver for Indianapolis 500 qualifying order', group_index;
      end if;
    end loop;
  else
    expected_group_count := 6;
    selected_driver_ids := array[
      new.driver_group1_id,
      new.driver_group2_id,
      new.driver_group3_id,
      new.driver_group4_id,
      new.driver_group5_id,
      new.driver_group6_id
    ];

    if new.driver_group7_id is not null or new.driver_group8_id is not null then
      raise exception 'Standard race picks must contain exactly 6 drivers';
    end if;

    for group_index in 1..6 loop
      selected_driver_id := selected_driver_ids[group_index];

      if not exists (
        select 1
        from public.drivers d
        where d.id = selected_driver_id
          and d.group_number = group_index
          and d.is_active
      ) then
        raise exception 'Invalid Group % driver', group_index;
      end if;
    end loop;
  end if;

  select count(distinct d) into distinct_count
  from unnest(selected_driver_ids) as t(d);

  if distinct_count <> expected_group_count then
    raise exception 'Each pick must contain % distinct drivers', expected_group_count;
  end if;

  return new;
end;
$$;

drop policy if exists race_driver_groups_read_authenticated on public.race_driver_groups;
create policy race_driver_groups_read_authenticated
on public.race_driver_groups
for select
to authenticated
using (true);
