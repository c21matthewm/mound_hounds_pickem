-- Offline regression fixture. Requires the Hall tables, profiles, auth.uid(),
-- write_admin_audit_event(), and 20260913_add_historical_hall_of_fame_import.sql.
-- Only run in a disposable database with SET mhp.test_mode = 'isolated'.
-- All fixture changes are rolled back, including the temporary failure trigger.
\set ON_ERROR_STOP on
begin;
do $$ begin
  if current_setting('mhp.test_mode', true) is distinct from 'isolated' then
    raise exception 'This fixture is only for an isolated local test database.';
  end if;
end $$;

insert into auth.users (id) values
('00000000-0000-4000-8000-000000000101'),
('00000000-0000-4000-8000-000000000102'),
('00000000-0000-4000-8000-000000000103');

insert into public.profiles (id, full_name, team_name, role, is_active) values
('00000000-0000-4000-8000-000000000101', 'Import Test Admin', 'Import Test Admin', 'admin', true),
('00000000-0000-4000-8000-000000000102', 'Import Test Participant', 'Import Test Participant', 'participant', true),
('00000000-0000-4000-8000-000000000103', 'Import Test Disabled Admin', 'Import Test Disabled Admin', 'admin', false);

create or replace function pg_temp.expect_import_failure(query text, expected_code text)
returns void language plpgsql as $$
begin
  begin
    execute query;
  exception when others then
    if sqlstate = expected_code then return; end if;
    raise exception 'Expected SQLSTATE %, received %: %', expected_code, sqlstate, sqlerrm;
  end;
  raise exception 'Expected import failure (%), but query succeeded.', expected_code;
end;
$$;

select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000102', true);
select pg_temp.expect_import_failure($query$select public.import_historical_hall_of_fame_season(2024, 2,
  '[{"final_rank":1,"team_name":"Champion","total_points":40}]')$query$, '42501');
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000103', true);
-- Admins retain access when they opt out of participation.
select public.import_historical_hall_of_fame_season(2021, 2,
  '[{"final_rank":1,"team_name":"Nonparticipating Admin Import","total_points":40}]');
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000101', true);

-- Stand-ins for the protected previously imported archives.
insert into public.hall_of_fame_seasons (season_year, champion_team_name, champion_total_points, participant_count, race_count)
values (2025, 'Existing 2025 Champion', 2548, 1, 17), (2026, 'Existing 2026 Champion', 2684, 1, 18);
insert into public.hall_of_fame_entries (season_id, final_rank, team_name, total_points)
select id, 1, champion_team_name, champion_total_points
from public.hall_of_fame_seasons where season_year in (2025, 2026);

select public.import_historical_hall_of_fame_season(2024, 2,
  '[{"final_rank":1,"team_name":"Matt – KACHOW🏎️","total_points":40,"race_breakdown":[]},
    {"final_rank":2,"team_name":"Runner-up","total_points":40,"race_breakdown":[]},
    {"final_rank":3,"team_name":"Third","total_points":30,"race_breakdown":[]}]');

do $$ begin
  if not exists (select 1 from public.hall_of_fame_seasons where season_year=2024
    and champion_team_name='Matt – KACHOW🏎️' and champion_total_points=40 and participant_count=3 and race_count=2
    and finalized_by='00000000-0000-4000-8000-000000000101') then
    raise exception 'Valid import metadata mismatch.';
  end if;
  if (select count(*) from public.hall_of_fame_entries e join public.hall_of_fame_seasons s on s.id=e.season_id
      where s.season_year=2024 and e.race_breakdown='[]'::jsonb) <> 3 then
    raise exception 'Imported entries mismatch.';
  end if;
  if (select count(*) from public.admin_audit_events where action='import_historical_hall_of_fame'
      and after_state->>'season_year'='2024') <> 1 then
    raise exception 'Import must record exactly one audit event.';
  end if;
  if has_function_privilege('anon', 'public.import_historical_hall_of_fame_season(integer,integer,jsonb)', 'execute') then
    raise exception 'Anonymous callers must not be granted this RPC.';
  end if;
end $$;

-- Repeated/current-year imports cannot update even one existing row.
select pg_temp.expect_import_failure(format('select public.import_historical_hall_of_fame_season(%s, 1, %L::jsonb)', year,
  '[{"final_rank":1,"team_name":"Replacement","total_points":999}]'), '23505')
from (values (2024), (2025), (2026)) years(year);

do $$ begin
  if (select champion_team_name from public.hall_of_fame_seasons where season_year=2025) <> 'Existing 2025 Champion'
    or (select champion_team_name from public.hall_of_fame_seasons where season_year=2026) <> 'Existing 2026 Champion'
    or (select count(*) from public.hall_of_fame_entries e join public.hall_of_fame_seasons s on s.id=e.season_id where s.season_year=2024) <> 3 then
    raise exception 'A duplicate import modified existing standings.';
  end if;
end $$;

select pg_temp.expect_import_failure(format('select public.import_historical_hall_of_fame_season(2023, 2, %L::jsonb)', entries), '22023')
from (values
  ('[]'),
  ('{}'),
  ('[{"final_rank":1,"team_name":"A","total_points":-1}]'),
  ('[{"final_rank":1,"team_name":"A","total_points":2147483648}]'),
  ('[{"final_rank":1.5,"team_name":"A","total_points":10}]'),
  ('[{"final_rank":1,"team_name":"A","total_points":10.5}]'),
  ('[{"final_rank":1,"team_name":"","total_points":10}]'),
  ('[{"final_rank":1,"team_name":"A"}]'),
  ('[{"final_rank":1,"team_name":"A","total_points":10,"race_breakdown":[{"points":10}]}]'),
  ('[{"final_rank":2,"team_name":"A","total_points":10}]'),
  ('[{"final_rank":1,"team_name":"A","total_points":10},{"final_rank":1,"team_name":"B","total_points":10}]'),
  ('[{"final_rank":1,"team_name":"A","total_points":10},{"final_rank":3,"team_name":"B","total_points":5}]'),
  ('[{"final_rank":1,"team_name":"A","total_points":10},{"final_rank":2,"team_name":"B","total_points":11}]'),
  ('[{"final_rank":1,"team_name":"A","total_points":10},{"final_rank":2,"team_name":"a","total_points":5}]'),
  ('[{"final_rank":1,"team_name":"Ａ","total_points":10},{"final_rank":2,"team_name":"A","total_points":5}]')
) invalid(entries);
select pg_temp.expect_import_failure($query$select public.import_historical_hall_of_fame_season(null,2,'[{"final_rank":1,"team_name":"A","total_points":10}]')$query$, '22023');
select pg_temp.expect_import_failure($query$select public.import_historical_hall_of_fame_season(2023,0,'[{"final_rank":1,"team_name":"A","total_points":10}]')$query$, '22023');

-- Valid competition ties below first place are retained.
select public.import_historical_hall_of_fame_season(2022, 1,
  '[{"final_rank":1,"team_name":"A","total_points":30},
    {"final_rank":2,"team_name":"B","total_points":20},
    {"final_rank":2,"team_name":"C","total_points":20},
    {"final_rank":4,"team_name":"D","total_points":10}]');

-- Normal app finalization may refresh app archives but never historical ones.
select pg_temp.expect_import_failure(format('select public.finalize_hall_of_fame_season(%s, 1, %L::jsonb)', year,
  '[{"final_rank":1,"team_name":"Replacement from app","total_points":999,"race_breakdown":[{"race_id":1,"points":999}]}]'), '22023')
from (values (2024), (2025), (2026)) years(year);
select public.finalize_hall_of_fame_season(2020, 1,
  '[{"final_rank":1,"team_name":"App champion","total_points":20,"race_breakdown":[{"race_id":1,"points":20}]}]');
select public.finalize_hall_of_fame_season(2020, 1,
  '[{"final_rank":1,"team_name":"Corrected app champion","total_points":30,"race_breakdown":[{"race_id":1,"points":30}]}]');
do $$ begin
  if not exists (select 1 from public.hall_of_fame_seasons where season_year=2020 and champion_team_name='Corrected app champion') then
    raise exception 'The historical archive guard blocked normal app corrections.';
  end if;
end $$;
insert into public.hall_of_fame_seasons (season_year, champion_team_name, champion_total_points, participant_count, race_count)
values (2019, 'Incomplete header', 10, 1, 1);
select pg_temp.expect_import_failure($query$select public.finalize_hall_of_fame_season(2019, 1,
  '[{"final_rank":1,"team_name":"Would replace header","total_points":20,"race_breakdown":[{"race_id":1,"points":20}]}]')$query$, '22023');
select pg_temp.expect_import_failure($query$select public.finalize_hall_of_fame_season(2018, 1,
  '[{"final_rank":1,"team_name":"A","total_points":20},{"final_rank":1,"team_name":"B","total_points":20}]')$query$, '22023');

-- Force a late failure after both archive tables have been written.
create function pg_temp.fail_import_audit() returns trigger language plpgsql as $$
begin raise exception 'Intentional isolated audit failure.'; end;
$$;
create trigger test_historical_import_audit_failure before insert on public.admin_audit_events
for each row execute function pg_temp.fail_import_audit();
select pg_temp.expect_import_failure($query$select public.import_historical_hall_of_fame_season(2023, 1,
  '[{"final_rank":1,"team_name":"Must roll back","total_points":10}]')$query$, 'P0001');
drop trigger test_historical_import_audit_failure on public.admin_audit_events;
do $$ begin
  if exists (select 1 from public.hall_of_fame_seasons where season_year=2023)
    or exists (select 1 from public.hall_of_fame_entries where team_name='Must roll back') then
    raise exception 'An audit failure left a partial archive.';
  end if;
end $$;

select 'PASS: historical imports validate inputs, require authenticated admins, preserve existing archives, and commit archive + audit atomically.' as result;
rollback;
