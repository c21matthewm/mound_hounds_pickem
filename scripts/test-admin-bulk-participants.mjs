import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Fictional accounts in a disposable, network-disabled local PostgreSQL container.
// No .env files, app services, existing databases, image pulls, or remote sockets.
const root = process.argv[2] ?? fileURLToPath(new URL("..", import.meta.url));
const migrationPath = process.argv[3] ?? path.join(root, "supabase/migrations/20260919_admin_bulk_participants.sql");
const schema = readFileSync(path.join(root, "supabase/schema.sql"), "utf8");
const hardening = readFileSync(path.join(root, "supabase/migrations/20260725_harden_race_and_season_operations.sql"), "utf8");
const rollover = readFileSync(path.join(root, "supabase/migrations/20260831_harden_season_rollover_registration.sql"), "utf8");
const enrollment = readFileSync(path.join(root, "supabase/migrations/20260718_add_season_enrollment_and_delivery_hardening.sql"), "utf8");
const roles = readFileSync(path.join(root, "supabase/migrations/20260913_admin_role_delegation.sql"), "utf8");
const migration = readFileSync(migrationPath, "utf8");
const extract = (source, kind, name) => {
  const marker = kind === "table" ? `create table if not exists public.${name} (` : `create or replace function public.${name}(`;
  const start = source.indexOf(marker);
  const terminator = kind === "table" ? "\n);" : "\n$$;";
  const end = source.indexOf(terminator, start);
  assert.ok(start >= 0 && end > start, `Missing ${kind} ${name}`);
  return source.slice(start, end + terminator.length);
};
const A = "00000000-0000-4000-8000-000000000001";
const B = "00000000-0000-4000-8000-000000000002";
const C = "00000000-0000-4000-8000-000000000003";
const D = "00000000-0000-4000-8000-000000000004";
const selected = (id, isActive = true, status = null) => ({profile_id:id,expected_is_active:isActive,expected_status:status});
const bootstrap = [
  `create role anon; create role authenticated; create role service_role;
   create schema auth; create schema extensions; create extension pgcrypto with schema extensions;
   create table auth.users (id uuid primary key);
   create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
   create function auth.role() returns text language sql stable as $$ select current_setting('request.jwt.claim.role', true) $$;
   grant usage on schema auth, public to authenticated, anon, service_role;`,
  ...["profiles","drivers","league_seasons","races","picks","season_participants","admin_audit_events"].map(name => extract(schema,"table",name)),
  extract(schema,"function","is_admin"), extract(schema,"function","protect_profile_role"),
  extract(hardening,"function","write_admin_audit_event"),
  extract(enrollment,"function","is_registered_for_season"),
  extract(rollover,"function","pick_window_opens_at"),
  extract(rollover,"function","enforce_pick_deadline"),
  `create trigger trg_protect_profile_role before insert or update of role,is_active on public.profiles for each row execute function public.protect_profile_role();
   create trigger trg_enforce_pick_deadline before insert or update on public.picks for each row execute function public.enforce_pick_deadline();
   grant select,insert,update,delete on all tables in schema public to authenticated;
   grant usage on all sequences in schema public to authenticated;
   insert into auth.users values ('${A}'),('${B}'),('${C}'),('${D}');
   insert into public.drivers(id,driver_name,current_standing,group_number)
     select n,'Fictional driver '||n,n,n from generate_series(1,6) n;`
].join("\n");
const run = (command, args, input) => {
  const result = spawnSync(command, args, { input, encoding: "utf8", timeout: 20_000, maxBuffer: 2 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error(result.error?.message ?? result.stderr.trim());
  return result.stdout.trim();
};
const dockerHost = run("docker", ["context", "inspect", "--format", '{{(index .Endpoints "docker").Host}}']);
assert.ok(dockerHost.startsWith("unix://"), "Only a local Docker socket is allowed.");
const dockerArgs = ["--host", dockerHost];
const docker = (args, input) => run("docker", [...dockerArgs, ...args], input);
const container = `mound-admin-bulk-test-${randomUUID()}`;
const psqlArgs = ["exec", "-i", container, "psql", "-X", "-qAt", "-h", "127.0.0.1", "-U", "postgres", "-v", "ON_ERROR_STOP=1"];
const sql = (statement) => docker(psqlArgs, statement);
const actor = (id) => `set role authenticated; set request.jwt.claim.role='authenticated'; set request.jwt.claim.sub='${id}';`;
const rpc = (operation, seasonId, rows) => `select public.admin_bulk_update_participants('${operation}',${seasonId ?? "null"},'${JSON.stringify(rows)}'::jsonb);`;
const asUser = (id, statement) => sql(`${actor(id)} ${statement}`);
const reset = () => sql(`truncate public.admin_audit_events,public.profiles,public.league_seasons restart identity cascade;
  insert into public.profiles(id,full_name,team_name,role,is_active) values
  ('${A}','Fictional Admin','Fictional Admin Team','admin',false),
  ('${B}','Fictional B','Fictional Team B','participant',true),
  ('${C}','Fictional C','Fictional Team C','participant',true),
  ('${D}',null,'Fictional Team D','participant',false);
  insert into public.league_seasons(id,season_year,display_name,status) values
  (42,2027,'Fictional 2027','active'),(43,2028,'Fictional 2028','upcoming'),(44,2026,'Fictional 2026','completed');
  insert into public.races(id,race_name,season_id,round_number,qualifying_start_at,race_date)
  values(1,'Fictional race',42,1,now()+interval '3 days',now()+interval '4 days');
  insert into public.season_participants(season_id,profile_id,status,registered_at)
  values (42,'${B}','registered',now()),(42,'${C}','registered',now());`);
const stateOf = (id,season = 43) => JSON.parse(sql(`select jsonb_build_object('eligible',p.is_active,'role',p.role,'status',s.status) from public.profiles p left join public.season_participants s on s.profile_id=p.id and s.season_id=${season} where p.id='${id}';`));
const auditCount = () => sql("select count(*) from public.admin_audit_events;");
const pick = id => `insert into public.picks(user_id,race_id,average_speed,driver_group1_id,driver_group2_id,driver_group3_id,driver_group4_id,driver_group5_id,driver_group6_id) values('${id}',1,150,1,2,3,4,5,6);`;
const sessions = [];
const session = (initial, marker) => {
  const child = spawn("docker", [...dockerArgs, ...psqlArgs], { stdio: ["pipe", "pipe", "pipe"] });
  sessions.push(child);
  let output = "", errorOutput = "";
  const closed = new Promise((resolve) => child.on("close", (code) => resolve({ code, output, errorOutput })));
  child.stderr.on("data", (value) => { errorOutput += value.toString(); });
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Session did not reach ${marker}: ${errorOutput}`)), 10_000);
    child.stdout.on("data", (value) => {
      output += value.toString();
      if (output.includes(marker)) { clearTimeout(timer); resolve(); }
    });
    child.on("close", (code) => { clearTimeout(timer); if (!output.includes(marker)) reject(new Error(`Session ended ${code}: ${errorOutput}`)); });
  });
  child.stdin.write(`${initial}\n\\echo ${marker}\n`);
  return { child, ready, closed };
};
let started=false;
let checks=0;
try {
  docker(["run","-d","--rm","--pull=never","--network=none","--name",container,"-e","POSTGRES_HOST_AUTH_METHOD=trust","postgres:16-alpine"]);
  started=true;
  let ready=false;
  for(let i=0;i<60;i++) { try { docker(["exec",container,"pg_isready","-h","127.0.0.1","-U","postgres"]);ready=true;break; } catch { await new Promise(resolve=>setTimeout(resolve,200)); } }
  assert.ok(ready,"Local database did not start.");
  sql(bootstrap); sql(roles); sql(migration); sql(migration);
  reset();
  asUser(A,rpc("register",43,[selected(B),selected(C)]));
  assert.equal(stateOf(B).status,"registered"); assert.equal(stateOf(C).status,"registered");
  assert.equal(stateOf(A).role,"admin"); assert.equal(stateOf(A).eligible,false);
  const audit=JSON.parse(sql("select to_jsonb(e) from public.admin_audit_events e limit 1;"));
  assert.equal(audit.actor_profile_id,A); assert.equal(audit.before_state.participants.length,2);
  assert.equal(audit.after_state.season_id,43); checks++;
  assert.throws(()=>asUser(A,rpc("decline",43,[selected(B)])),/Participant data changed/);
  assert.equal(stateOf(B).status,"registered"); checks++;
  asUser(A,rpc("decline",43,[selected(B,true,"registered")])); assert.equal(stateOf(B).status,"declined");
  assert.equal(stateOf(B,42).status,"registered"); checks++;
  asUser(A,rpc("disable",null,[selected(B),selected(C)]));
  assert.equal(stateOf(B).eligible,false); assert.equal(stateOf(B,42).status,"registered"); checks++;
  asUser(A,rpc("enable",null,[selected(B,false),selected(C,false)])); assert.equal(stateOf(B).eligible,true); checks++;
  assert.throws(()=>asUser(B,rpc("enable",null,[selected(D,false)])),/Only an admin/); checks++;
  assert.throws(()=>sql(`set role anon; ${rpc("enable",null,[selected(D,false)])}`),/permission denied/); checks++;
  assert.throws(()=>sql(`set role service_role; ${rpc("enable",null,[selected(D,false)])}`),/permission denied/); checks++;
  assert.throws(()=>asUser(A,rpc("register",44,[selected(B)])),/active or upcoming/); checks++;
  assert.throws(()=>asUser(A,rpc("register",null,[selected(B)])),/active or upcoming/); checks++;
  assert.throws(()=>asUser(A,rpc("register",43,[selected(D,false)])),/participation enabled and a complete name/); checks++;
  assert.throws(()=>asUser(A,rpc("register",43,[selected(B,true,"declined"),selected(D,false)])),/participation enabled and a complete name/);
  assert.equal(stateOf(B).status,"declined"); checks++;
  assert.throws(()=>asUser(A,rpc("enable",null,[selected(B),selected(B)])),/only be selected once/); checks++;
  assert.throws(()=>asUser(A,rpc("enable",null,[])),/between 1 and 100/); checks++;
  assert.throws(()=>asUser(A,rpc("enable",null,Array.from({length:101},()=>selected(B)))),/between 1 and 100/); checks++;
  assert.throws(()=>asUser(A,rpc("delete",null,[selected(B)])),/Choose/); checks++;
  assert.throws(()=>asUser(A,rpc("enable",null,[{...selected(B),expected_is_active:"true"}])),/Refresh Participants/); checks++;
  assert.throws(()=>asUser(A,rpc("enable",null,[{...selected(B),expected_status:undefined}])),/Refresh Participants/); checks++;
  assert.throws(()=>asUser(A,rpc("enable",null,[selected("00000000-0000-4000-8000-000000000099")])),/no longer exists/); checks++;
  assert.throws(()=>asUser(A,`begin isolation level repeatable read; ${rpc("disable",null,[selected(B)])} commit;`),/Refresh Participants/); checks++;
  reset(); asUser(C,pick(C));
  assert.throws(()=>asUser(A,rpc("decline",42,[selected(C,true,"registered"),selected(B,true,"registered")])),/submitted picks/);
  assert.equal(stateOf(B,42).status,"registered"); assert.equal(auditCount(),"0"); checks++;
  assert.throws(()=>asUser(A,rpc("disable",null,[selected(C),selected(B)])),/submitted picks/);
  assert.equal(stateOf(B).eligible,true); checks++;
  reset();
  sql("create function public.fixture_reject_audit() returns trigger language plpgsql as $$ begin raise exception 'fixture audit failure'; end $$; create trigger fixture_reject_audit before insert on public.admin_audit_events for each row execute function public.fixture_reject_audit();");
  assert.throws(()=>asUser(A,rpc("register",43,[selected(B),selected(C)])),/fixture audit failure/);
  assert.equal(stateOf(B).status,null); assert.equal(stateOf(C).status,null); assert.equal(auditCount(),"0");
  sql("drop trigger fixture_reject_audit on public.admin_audit_events;"); checks++;
  reset();
  asUser(A,rpc("enable",null,[selected(D,false)]));
  assert.throws(()=>asUser(A,rpc("register",43,[selected(D)])),/participation enabled and a complete name/); checks++;
  // An uncommitted new pick forces the bulk action to retry; after commit it
  // must see the pick and refuse removal, using the real app deadline trigger.
  reset();
  const incoming=session(`${actor(B)} begin; ${pick(B)}`,"pick-held"); await incoming.ready;
  assert.throws(()=>asUser(A,rpc("disable",null,[selected(B)])),/could not obtain lock/);
  incoming.child.stdin.end("commit;\n"); assert.equal((await incoming.closed).code,0);
  assert.throws(()=>asUser(A,rpc("disable",null,[selected(B)])),/submitted picks/); checks++;
  // The opposite order: a pick that waits for bulk disable must recheck the
  // enrollment/eligibility guard and fail after the admin transaction commits.
  reset();
  const disabling=session(`${actor(A)} begin; ${rpc("disable",null,[selected(B)])}`,"disable-held"); await disabling.ready;
  const waiting=spawn("docker",[...dockerArgs,...psqlArgs],{stdio:["pipe","pipe","pipe"]}); sessions.push(waiting);
  let waitingError=""; waiting.stderr.on("data",value=>waitingError+=value.toString());
  const waitingClosed=new Promise(resolve=>waiting.on("close",code=>resolve(code)));
  waiting.stdin.end(`${actor(B)} ${pick(B)}\n`);
  await new Promise(resolve=>setTimeout(resolve,200));
  disabling.child.stdin.end("commit;\n"); assert.equal((await disabling.closed).code,0);
  assert.notEqual(await waitingClosed,0); assert.match(waitingError,/Register for this league season/); checks++;
  reset();
  const rolloverSession=session("begin; update public.league_seasons set status='completed' where id=43;","rollover-held"); await rolloverSession.ready;
  assert.throws(()=>asUser(A,rpc("register",43,[selected(B)])),/could not obtain lock/);
  rolloverSession.child.stdin.end("commit;\n"); assert.equal((await rolloverSession.closed).code,0);
  assert.throws(()=>asUser(A,rpc("register",43,[selected(B)])),/active or upcoming/); checks++;
  console.log(`PASS: ${checks} offline PostgreSQL participant batch checks, including both pick/disable orders, explicit upcoming enrollment, rollover, stale selections, and atomic audit rollback.`);
} finally {
  for(const child of sessions) if(child.exitCode===null && !child.stdin.destroyed) child.stdin.end("rollback;\n");
  if(started) docker(["stop","--time","1",container]);
}
