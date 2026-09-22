-- Local disposable fixture only; no real Storage objects or application data.
\set ON_ERROR_STOP on
begin;
do $$ begin
  if current_setting('mhp.test_mode', true) is distinct from 'isolated' then
    raise exception 'This fixture requires an isolated local test database.';
  end if;
end $$;
insert into auth.users values ('00000000-0000-4000-8000-000000000101'), ('00000000-0000-4000-8000-000000000102');
insert into public.profiles (id,full_name,team_name,role,is_active) values
('00000000-0000-4000-8000-000000000101','Admin','Admin','admin',false),
('00000000-0000-4000-8000-000000000102','Participant','Participant','participant',true);
insert into public.league_seasons (id,season_year,display_name,status,rules_document_url) values
(1,2027,'2027','active','/docs/original.pdf'), (2,2028,'2028','upcoming',null), (3,2026,'2026','completed','/docs/archive.pdf');
create function pg_temp.expect_failure(query text, expected_code text) returns void language plpgsql as $$
begin
  begin execute query;
  exception when others then
    if sqlstate = expected_code then return; end if;
    raise exception 'Expected SQLSTATE %, received %: %', expected_code, sqlstate, sqlerrm;
  end;
  raise exception 'Expected failure %, but query succeeded.', expected_code;
end;
$$;
select set_config('request.jwt.claim.role','anon',true);
select pg_temp.expect_failure($q$select public.set_league_season_rules_document(1,'/rules.pdf','/docs/original.pdf')$q$,'42501');
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000102',true);
select pg_temp.expect_failure($q$select public.set_league_season_rules_document(1,'/rules.pdf','/docs/original.pdf')$q$,'42501');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000101',true);
select pg_temp.expect_failure($q$select public.set_league_season_rules_document(3,'/rules.pdf','/docs/archive.pdf')$q$,'22023');
select pg_temp.expect_failure($q$select public.set_league_season_rules_document(999,'/rules.pdf',null)$q$,'22023');
select pg_temp.expect_failure($q$select public.set_league_season_rules_document(1,'/rules.pdf','/docs/stale.pdf')$q$,'40001');
select pg_temp.expect_failure(format('select public.set_league_season_rules_document(1,%L,%L)', bad, '/docs/original.pdf'),'22023')
from (values ('//evil.test/rules.pdf'),('/\evil.test/rules.pdf'),('javascript:alert(1)'),('http://example.test/rules.pdf'),
('https://user:password@example.test/rules.pdf'),('https:///example.test'),('https://a..b/rules.pdf'),('https://example.test:65536/rules.pdf'),
('/docs/a' || chr(10) || 'b.pdf'),('/docs/%0arules.pdf'),('/docs/%5crules.pdf'),('https://%65xample.test/rules.pdf'),('/' || repeat('x',2048))) invalid(bad);

-- A nonparticipating administrator may publish a document; URL + audit are atomic.
select public.set_league_season_rules_document(1,'https://example.test/rules.pdf','/docs/original.pdf');
select public.set_league_season_rules_document(2,'/docs/2028.pdf',null);
select public.set_league_season_rules_document(2,'/docs/2028.pdf','/docs/2028.pdf');
do $$ begin
  if (select count(*) from public.admin_audit_events where action='update_rules_document') <> 2 then
    raise exception 'Document saves must audit once; an unchanged URL must not add another event.';
  end if;
  if not exists(select 1 from public.admin_audit_events where before_state->>'rules_document_url'='/docs/original.pdf'
      and after_state->>'rules_document_url'='https://example.test/rules.pdf') then
    raise exception 'Audit did not preserve the document replacement.';
  end if;
  if has_function_privilege('anon','public.set_league_season_rules_document(bigint,text,text)','execute')
    or has_function_privilege('service_role','public.set_league_season_rules_document(bigint,text,text)','execute') then
    raise exception 'Only authenticated callers should receive RPC execution rights.';
  end if;
end $$;
select public.set_league_season_rules_document(2,null,'/docs/2028.pdf');
do $$ begin
  if (select rules_document_url from public.league_seasons where id=2) is not null then
    raise exception 'Clearing the upcoming document failed.';
  end if;
end $$;
create function pg_temp.fail_audit() returns trigger language plpgsql as $$ begin raise exception 'Intentional fixture failure.'; end $$;
create trigger test_rules_audit_failure before insert on public.admin_audit_events for each row execute function pg_temp.fail_audit();
select pg_temp.expect_failure($q$select public.set_league_season_rules_document(1,'/must-rollback.pdf','https://example.test/rules.pdf')$q$,'P0001');
drop trigger test_rules_audit_failure on public.admin_audit_events;
do $$ begin
  if (select rules_document_url from public.league_seasons where id=1) <> 'https://example.test/rules.pdf' then
    raise exception 'An audit failure left an unaudited URL update.';
  end if;
end $$;

-- Even a broad policy belonging to other media cannot authorize direct rules writes.
create policy fixture_broad_storage_access on storage.objects for all to authenticated using(true) with check(true);
set local role authenticated;
insert into storage.objects (bucket_id,name) values ('driver-headshots','fixture-image.webp');
select pg_temp.expect_failure($q$insert into storage.objects (bucket_id,name) values ('season-rules','bypass.pdf')$q$,'42501');
reset role;
select 'PASS: season rules authorization, URL validation, optimistic conflict, clear/no-op, atomic audit rollback, and restrictive Storage policy.';
rollback;
