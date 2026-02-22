alter table public.races
drop column if exists winner_driver_id;

alter table public.races
add column if not exists winner_profile_id uuid references public.profiles(id) on delete set null;

alter table public.races
add column if not exists winner_source text;

update public.races
set winner_source = 'auto'
where winner_source is null;

alter table public.races
alter column winner_source set default 'auto';

alter table public.races
alter column winner_source set not null;

alter table public.races
drop constraint if exists races_winner_source_check;

alter table public.races
add constraint races_winner_source_check
check (winner_source in ('auto', 'manual'));

alter table public.races
add column if not exists winner_is_manual_override boolean not null default false;

alter table public.races
add column if not exists winner_auto_eligible_at timestamptz;

alter table public.races
add column if not exists winner_set_at timestamptz;

create index if not exists idx_races_winner_auto_eligible
on public.races(winner_auto_eligible_at);
