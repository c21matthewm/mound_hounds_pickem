alter table public.drivers
add column if not exists championship_points integer not null default 0;

alter table public.drivers
drop constraint if exists drivers_championship_points_check;

alter table public.drivers
add constraint drivers_championship_points_check
check (championship_points >= 0);

create index if not exists idx_drivers_points
on public.drivers(championship_points desc, current_standing asc);
