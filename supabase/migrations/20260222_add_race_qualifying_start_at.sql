alter table public.races
add column if not exists qualifying_start_at timestamptz;

update public.races
set qualifying_start_at = race_date
where qualifying_start_at is null;

alter table public.races
alter column qualifying_start_at set not null;

alter table public.races
drop constraint if exists races_qualifying_before_race_check;

alter table public.races
add constraint races_qualifying_before_race_check
check (qualifying_start_at <= race_date);

create index if not exists idx_races_qualifying_start
on public.races(qualifying_start_at);
