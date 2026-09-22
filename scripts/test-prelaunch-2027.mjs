import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

// Real repository constraints and deletion triggers; fictional data only.
// Never reads .env, connects to an existing database, or downloads an image.
const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const schema = read("supabase/schema.sql");
const recovery = read("supabase/migrations/20260730_atomic_picks_and_season_recovery.sql");
const bounded = read("supabase/migrations/20260818_bound_recovery_jobs_and_registration.sql");
const hardening = read("supabase/migrations/20260725_harden_race_and_season_operations.sql");
const errors = read("supabase/migrations/20260821_add_application_error_inbox.sql");
const cleanup = read("supabase/operations/prelaunch-2027/02_clear_test_data.sql");
const preflight = read("supabase/operations/prelaunch-2027/01_database_preflight.sql");
const verification = read("supabase/operations/prelaunch-2027/03_verify_reset.sql");
const resumeJobs = read("supabase/operations/prelaunch-2027/04_resume_jobs_when_2027_ready.sql");
const keeper = "6badc049-4960-45ee-92e9-5b21dba0d4f1";
const extract = (source, kind, name) => {
  const marker = kind === "table" ? `create table if not exists public.${name} (` : `create or replace function public.${name}(`;
  const start = source.indexOf(marker);
  assert.ok(start >= 0, `Missing ${name}`);
  const terminator = kind === "table" ? "\n);" : "\n$$;";
  const end = source.indexOf(terminator, start);
  assert.ok(end > start);
  return source.slice(start, end + terminator.length);
};
const bootstrap = [
  `create schema auth; create schema extensions; create extension pgcrypto with schema extensions;
   create table auth.users (id uuid primary key, email_confirmed_at timestamptz default now());
   create schema storage; create table storage.objects (id uuid, bucket_id text, owner_id text, owner uuid, metadata jsonb);
   create schema cron; create table cron.job (jobid bigint primary key, jobname text, command text, active boolean);
   create function cron.alter_job(job_id bigint, active boolean) returns void language sql as
     $$ update cron.job set active = $2 where jobid = $1 $$;`,
  ...["profiles", "drivers", "league_seasons", "season_participants", "app_metadata", "races", "picks", "results",
    "race_driver_groups", "feedback_items", "pick_reminders", "season_registration_secrets", "admin_audit_events",
    "job_runs", "hall_of_fame_seasons", "hall_of_fame_entries"].map((table) => extract(schema, "table", table)),
  extract(recovery, "table", "pick_submission_versions"), extract(recovery, "table", "season_restore_points"),
  "alter table public.season_restore_points add column snapshot_bytes bigint default 0;",
  extract(bounded, "table", "job_status"), extract(bounded, "table", "registration_attempt_limits"),
  extract(errors, "table", "app_error_events"),
  extract(hardening, "function", "protect_race_history_from_delete"),
  extract(bounded, "function", "prevent_season_restore_point_mutation"),
  `create trigger trg_protect_race_history_from_delete before delete on public.races
     for each row execute function public.protect_race_history_from_delete();
   create trigger trg_prevent_season_restore_point_mutation before update or delete on public.season_restore_points
     for each row execute function public.prevent_season_restore_point_mutation();`,
  `create function public.fixture_user(n integer) returns uuid language sql immutable as
     $$ select case when n = 1 then '${keeper}'::uuid else md5('fixture-user-' || n)::uuid end $$;
   insert into auth.users (id) select public.fixture_user(n) from generate_series(1,14) n;
   insert into public.profiles (id,full_name,team_name,role)
     select public.fixture_user(n), 'Fixture Person ' || n, 'Fixture Team ' || n, 'admin' from generate_series(1,14) n;
   insert into public.league_seasons(id,season_year,display_name,status,registration_code_configured_at)
     values(1,2026,'Experimental fixture','active',now());
   insert into public.season_registration_secrets(season_id,invite_code_hash) values(1,'fictional-not-a-secret');
   insert into public.season_participants(season_id,profile_id,status,registered_at)
     select 1,id,'registered',now() from public.profiles;
   insert into public.app_metadata(key,value) values('schema_version','20260904_portable_season_backups_v2');
   insert into public.drivers(id,driver_name,championship_points,current_standing,opening_seed_standing,group_number)
     select n,'Fixture Driver '||n,100,n,34-n,least(6,ceil(n::numeric/4)) from generate_series(1,33) n;
   insert into public.races(id,race_name,season_id,round_number,qualifying_start_at,race_date)
     select n,'Fixture Race '||n,1,n,now()-interval '2 days',now()-interval '1 day' from generate_series(1,18) n;
   insert into public.results(race_id,driver_id,points)
     select r.id,d.id,20 from public.races r cross join public.drivers d order by r.id,d.id limit 458;
   insert into public.race_driver_groups(race_id,driver_id,group_number)
     select r.id,d.id,d.group_number from public.races r cross join public.drivers d order by r.id,d.id limit 435;
   insert into public.picks(id,user_id,race_id,average_speed,driver_group1_id,driver_group2_id,driver_group3_id,
     driver_group4_id,driver_group5_id,driver_group6_id)
     select n,public.fixture_user(1+(n-1)/18),1+(n-1)%18,190.000,1,5,9,13,17,21 from generate_series(1,40) n;
   insert into public.pick_submission_versions(pick_id,user_id,race_id,submission_version,average_speed,
     driver_group1_id,driver_group2_id,driver_group3_id,driver_group4_id,driver_group5_id,driver_group6_id)
     select id,user_id,race_id,1,average_speed,driver_group1_id,driver_group2_id,driver_group3_id,
       driver_group4_id,driver_group5_id,driver_group6_id from public.picks;
   insert into public.pick_submission_versions(pick_id,user_id,race_id,submission_version,average_speed,
     driver_group1_id,driver_group2_id,driver_group3_id,driver_group4_id,driver_group5_id,driver_group6_id)
     values(1,'${keeper}',1,2,191.000,1,5,9,13,17,21);
   insert into public.feedback_items(user_id,feedback_type,category,details)
     select public.fixture_user(n),'bug','fixture','This is fictional feedback for cleanup tests.' from generate_series(1,8) n;
   insert into public.season_restore_points(season_id,season_year,label,source,schema_version,row_counts,snapshot,checksum,created_by)
     select 1,2026,'Fixture backup '||n,'manual','fixture','{}','{}',repeat('0',64),public.fixture_user(2) from generate_series(1,6) n;
   insert into public.hall_of_fame_seasons(id,season_year,champion_team_name,champion_total_points,participant_count,race_count)
     values(1,2025,'Fictional Archive Champion',2548,89,17);
   insert into public.hall_of_fame_entries(season_id,final_rank,team_name,total_points)
     select 1,n,'Fictional Archive '||n,case n when 1 then 2548 when 2 then 2110 else 2087 end from generate_series(1,89) n;
   insert into cron.job values
     (1,'fantasy_winner_hourly','fixture /api/cron/fantasy-winner',true),
     (2,'pick_reminders_5min','fixture /api/cron/pick-reminders',false),
     (3,'unrelated_job','select 1',true);`
].join("\n");

const run = (command, args, input) => {
  const result = spawnSync(command, args, { input, encoding: "utf8", timeout: 30_000, maxBuffer: 4 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error(result.error?.message ?? result.stderr.trim());
  return result.stdout.trim();
};
const dockerHost = process.env.DOCKER_HOST || run("docker", ["context", "inspect", "--format", '{{(index .Endpoints "docker").Host}}']);
assert.ok(dockerHost.startsWith("unix://"), "Only a local Docker socket is allowed.");
const docker = (args, input) => run("docker", ["--host", dockerHost, ...args], input);
const container = `mound-hounds-prelaunch-test-${randomUUID()}`;
let started = false;
const sql = (statement) => docker(["exec", "-i", container, "psql", "-X", "-qAt", "-h", "127.0.0.1", "-U", "postgres", "-v", "ON_ERROR_STOP=1"], statement);
const archive = () => sql("select jsonb_agg(to_jsonb(e) order by id) from public.hall_of_fame_entries e;");
try {
  docker(["run", "-d", "--rm", "--pull=never", "--network=none", "--name", container,
    "-e", "POSTGRES_HOST_AUTH_METHOD=trust", "postgres:16-alpine"]);
  started = true;
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    try { docker(["exec", container, "pg_isready", "-h", "127.0.0.1", "-U", "postgres"]); ready = true; break; }
    catch { await new Promise((resolve) => setTimeout(resolve, 250)); }
  }
  assert.ok(ready, "Isolated database failed to start.");
  sql(bootstrap);
  assert.ok(!sql(preflight).includes("STOP"));
  const before = archive();
  const expectStop = (beforeSql, pattern, afterSql) => {
    sql(beforeSql);
    assert.throws(() => sql(cleanup), pattern);
    assert.equal(sql("select count(*) from public.races;"), "18");
    assert.equal(archive(), before);
    assert.equal(sql("select count(*) from public.app_metadata where key='prelaunch_2027_reset';"), "0");
    sql(afterSql);
  };
  expectStop(`update public.profiles set role='participant' where id='${keeper}';`, /retained confirmed administrator/,
    `update public.profiles set role='admin' where id='${keeper}';`);
  expectStop("insert into public.league_seasons(id,season_year,display_name,status) values(2,2027,'Future','upcoming');",
    /only the active experimental/, "delete from public.league_seasons where id=2;");
  expectStop("insert into public.hall_of_fame_seasons(id,season_year,champion_team_name,champion_total_points,participant_count,race_count) values(2,2026,'Real archive',10,1,1);",
    /2026 archive now exists/, "delete from public.hall_of_fame_seasons where id=2;");
  expectStop("delete from public.results where id=(select max(id) from public.results);", /Inventory changed for public.results/,
    "insert into public.results(race_id,driver_id,points) values(14,29,20);");
  expectStop("insert into storage.objects(owner_id) values(public.fixture_user(2)::text);", /owns Storage files/,
    "delete from storage.objects;");
  // Force a failure after deletions, testing actual transactional rollback.
  sql("create function public.reject_cleanup_marker() returns trigger language plpgsql as $$ begin if new.key='prelaunch_2027_reset' then raise exception 'fixture late failure'; end if; return new; end $$; create trigger reject_cleanup before insert on public.app_metadata for each row execute function public.reject_cleanup_marker();");
  assert.throws(() => sql(cleanup), /fixture late failure/);
  assert.equal(sql("select count(*) from public.races;"), "18");
  assert.equal(sql("select count(*) from public.season_restore_points;"), "6");
  assert.equal(sql("select active from cron.job where jobid=1;"), "t");
  sql("drop trigger reject_cleanup on public.app_metadata;");
  assert.throws(() => sql("delete from public.races where id=1;"), /race with picks or results/);
  assert.throws(() => sql("delete from auth.users where id=public.fixture_user(2);"), /restore points are immutable/);
  assert.match(sql(cleanup), /PASS:/);
  assert.equal(archive(), before);
  assert.equal(sql("select count(*) from auth.users;"), "14", "SQL cleanup must leave Auth to the supported API.");
  assert.equal(sql("select count(*) from public.profiles where role='admin' and is_active;"), "1");
  assert.equal(sql("select sum(championship_points) from public.drivers;"), "0");
  assert.equal(sql("select count(*) from public.drivers where opening_seed_standing=34-current_standing;"), "33");
  assert.equal(sql("select string_agg(active::text,',' order by jobid) from cron.job;"), "false,false,true");
  assert.ok(!sql(verification).includes("STOP"));
  assert.throws(() => sql(cleanup), /reset already ran/);
  // Simulate Auth's hard-delete FK cascade, without a real Auth service.
  sql(`delete from auth.users where id <> '${keeper}';`);
  assert.equal(sql("select count(*) from public.profiles;"), "1");
  assert.equal(archive(), before);
  const finalChecks = sql(verification);
  assert.ok(!finalChecks.includes("WAIT_AUTH_CLEANUP") && !finalChecks.includes("STOP"));
  assert.equal(sql("select count(*) from pg_trigger where tgname='trg_prevent_season_restore_point_mutation';"), "1");
  assert.throws(() => sql(resumeJobs), /configure\/activate 2027/);
  sql("insert into public.hall_of_fame_seasons(id,season_year,champion_team_name,champion_total_points,participant_count,race_count) values(2,2026,'Future import fixture',10,1,1); update public.league_seasons set status='completed'; insert into public.league_seasons(id,season_year,display_name,status,registration_code_configured_at,roster_configured_at) values(2,2027,'Next season fixture','active',now(),now());");
  assert.match(sql(resumeJobs), /PASS:/);
  assert.equal(sql("select string_agg(active::text,',' order by jobid) from cron.job;"), "true,false,true");
  sql("update cron.job set jobname='changed-job' where jobid=1;");
  assert.throws(() => sql(resumeJobs), /saved cron job changed/);
  console.log("PASS: inventory, admin/season/archive/count/storage guards, late-failure rollback, protected-history deletion order, Auth cascades, archive preservation, driver seeds, cron scope, and rerun refusal.");
} finally {
  if (started) docker(["rm", "--force", container]);
}
