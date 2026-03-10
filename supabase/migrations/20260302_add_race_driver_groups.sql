create table if not exists public.race_driver_groups (
  race_id bigint not null references public.races(id) on delete cascade,
  driver_id bigint not null references public.drivers(id) on delete cascade,
  group_number smallint not null check (group_number between 1 and 6),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (race_id, driver_id)
);

create index if not exists idx_race_driver_groups_race_group
on public.race_driver_groups(race_id, group_number);

drop trigger if exists trg_race_driver_groups_updated_at on public.race_driver_groups;
create trigger trg_race_driver_groups_updated_at
before update on public.race_driver_groups
for each row execute function public.set_updated_at();

alter table public.race_driver_groups enable row level security;

drop policy if exists race_driver_groups_admin_read on public.race_driver_groups;
create policy race_driver_groups_admin_read
on public.race_driver_groups
for select
to authenticated
using (public.is_admin(auth.uid()));

drop policy if exists race_driver_groups_admin_write on public.race_driver_groups;
create policy race_driver_groups_admin_write
on public.race_driver_groups
for all
to authenticated
using (public.is_admin(auth.uid()))
with check (public.is_admin(auth.uid()));
