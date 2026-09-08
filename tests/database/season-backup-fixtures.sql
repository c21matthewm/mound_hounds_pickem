-- Fixture identities and data exist only in the runner's disposable PostgreSQL container.
insert into auth.users (id) values
  ('00000000-0000-4000-8000-000000000001'),
  ('00000000-0000-4000-8000-000000000002');

insert into public.profiles (id, full_name, team_name, role) values
  ('00000000-0000-4000-8000-000000000001', 'Recovery Admin', 'Recovery Admin', 'admin'),
  ('00000000-0000-4000-8000-000000000002', 'Recovery Participant', 'Recovery Participant', 'participant');

insert into public.league_seasons (id, season_year, display_name, status)
values (1, 2026, 'Recovery fixture', 'active');

insert into public.app_metadata (key, value)
values ('schema_version', 'recovery-fixture')
on conflict (key) do nothing;

insert into public.season_participants (season_id, profile_id, status, registered_at)
values (1, '00000000-0000-4000-8000-000000000002', 'registered', now());

insert into public.drivers (id, driver_name, current_standing, opening_seed_standing, group_number)
select driver_id, 'Fixture Driver ' || driver_id, driver_id, driver_id, driver_id
from generate_series(1, 6) driver_id;

-- Zero and trailing-zero decimals reproduce the legacy portability failure.
-- Quotes, newlines, and non-ASCII text exercise JSON string preservation as well.
insert into public.races (
  id, race_name, season_id, round_number, qualifying_start_at, race_date,
  payout, official_winning_average_speed, results_status, results_published_at
)
values (
  1, E'Fixture "Grand Prix" — São Paulo\nRace', 1, 1,
  '2026-08-01 12:00:00+00', '2026-08-02 12:00:00+00',
  0.00, 190.000, 'published', '2026-08-02 15:00:00+00'
);

insert into public.race_driver_groups (race_id, driver_id, group_number)
select 1, driver_id, driver_id from generate_series(1, 6) driver_id;

insert into public.results (id, race_id, driver_id, points)
select driver_id, 1, driver_id, 60 - driver_id from generate_series(1, 6) driver_id;

insert into public.picks (
  id, user_id, race_id, average_speed,
  driver_group1_id, driver_group2_id, driver_group3_id,
  driver_group4_id, driver_group5_id, driver_group6_id
)
values (1, '00000000-0000-4000-8000-000000000002', 1, 190.000, 1, 2, 3, 4, 5, 6);

insert into public.pick_submission_versions (
  id, pick_id, user_id, race_id, submission_version, average_speed,
  driver_group1_id, driver_group2_id, driver_group3_id,
  driver_group4_id, driver_group5_id, driver_group6_id
)
values (1, 1, '00000000-0000-4000-8000-000000000002', 1, 1, 190.000, 1, 2, 3, 4, 5, 6);
