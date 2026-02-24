alter table public.races
add column if not exists official_winning_average_speed numeric(8,3);

alter table public.races
drop constraint if exists races_official_winning_average_speed_nonnegative;

alter table public.races
add constraint races_official_winning_average_speed_nonnegative
check (
  official_winning_average_speed is null
  or official_winning_average_speed >= 0
);
