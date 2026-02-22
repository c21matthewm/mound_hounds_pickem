alter table public.races
add column if not exists is_archived boolean not null default false,
add column if not exists archived_at timestamptz;

create index if not exists idx_races_is_archived
on public.races(is_archived, race_date);

create or replace function public.enforce_pick_deadline()
returns trigger
language plpgsql
as $$
declare
  race_qualifying_start_at timestamptz;
  race_is_archived boolean;
begin
  select r.qualifying_start_at, r.is_archived
    into race_qualifying_start_at, race_is_archived
  from public.races r
  where r.id = new.race_id;

  if race_qualifying_start_at is null then
    raise exception 'Race not found for pick submission';
  end if;

  if race_is_archived then
    raise exception 'Picks are disabled for archived races.';
  end if;

  if race_qualifying_start_at <= now() then
    raise exception 'Picks are locked because qualifying has already started.';
  end if;

  return new;
end;
$$;
