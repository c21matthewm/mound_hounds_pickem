import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Fictional data only, in a fresh network-disabled local PostgreSQL container.
// Do not load dotenv, contact app services, or download an image.
const root = new URL("../", import.meta.url);
const read = name => readFileSync(new URL(name, root), "utf8");
const schema = read("supabase/schema.sql");
const original = read("supabase/migrations/20260730_atomic_picks_and_season_recovery.sql");
const hardening = read("supabase/migrations/20260725_harden_race_and_season_operations.sql");
const opening = read("supabase/migrations/20260831_harden_season_rollover_registration.sql");
const migration = read("supabase/migrations/20260930_idempotent_pick_saves.sql");
const extract = (text, kind, name) => {
  const start = text.indexOf(kind === "table" ? `create table if not exists public.${name} (` : `create or replace function public.${name}(`);
  const delimiter = kind === "table" ? "\n);" : "\n$$;";
  const end = text.indexOf(delimiter, start);
  assert.ok(start >= 0 && end > start, name);
  return text.slice(start, end + delimiter.length);
};
const A = "00000000-0000-4000-8000-000000000001";
const B = "00000000-0000-4000-8000-000000000002";
const bootstrap = [
  `create role anon; create role authenticated; create role service_role;
   create schema auth; create schema extensions; create extension pgcrypto with schema extensions;
   create table auth.users(id uuid primary key);
   create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
   grant usage on schema public, auth to authenticated, anon, service_role;`,
  ...["profiles", "drivers", "league_seasons", "season_participants", "app_metadata", "races", "picks", "race_driver_groups"].map(name => extract(schema, "table", name)),
  extract(original, "table", "pick_submission_versions"),
  extract(schema, "function", "set_updated_at"),
  extract(schema, "function", "is_registered_for_season"),
  extract(opening, "function", "pick_window_opens_at"),
  extract(opening, "function", "enforce_pick_deadline"),
  extract(hardening, "function", "ensure_race_pick_field_snapshot"),
  extract(hardening, "function", "validate_pick_groups"),
  extract(original, "function", "record_pick_submission_version"),
  `create trigger trg_enforce_pick_deadline before insert or update on public.picks for each row execute function public.enforce_pick_deadline();
   create trigger trg_picks_updated_at before update on public.picks for each row execute function public.set_updated_at();
   create trigger trg_validate_pick_groups before insert or update on public.picks for each row execute function public.validate_pick_groups();
   create trigger trg_record_pick_submission_version after insert or update on public.picks for each row execute function public.record_pick_submission_version();`
].join("\n");
const run = (command, args, input) => {
  const result = spawnSync(command, args, { input, encoding: "utf8", timeout: 25_000, maxBuffer: 4 * 1024 * 1024, cwd: fileURLToPath(root) });
  if (result.error || result.status !== 0) throw new Error(result.error?.message ?? result.stderr.trim());
  return result.stdout.trim();
};
const host = run("docker", ["context", "inspect", "--format", '{{(index .Endpoints "docker").Host}}']);
assert.ok(host.startsWith("unix://"), "Only a local Docker Unix socket is allowed.");
const container = `mound-pick-saves-${randomUUID()}`;
const docker = (args, input) => run("docker", ["--host", host, ...args], input);
const sqlArgs = ["exec", "-i", container, "psql", "-X", "-qAt", "-h", "127.0.0.1", "-U", "postgres", "-v", "ON_ERROR_STOP=1"];
const sql = text => docker(sqlArgs, text);
const actor = id => `set role authenticated; set request.jwt.claim.sub='${id}';`;
const asUser = (text, id = A) => sql(actor(id) + text);
const standard = "array[1,3,5,7,9,11]::bigint[]";
const indy = "array[1,5,9,13,17,21,25,29]::bigint[]";
const saveSql = (race = 1, speed = "135.500", ids = standard) => `select public.save_weekly_pick(${race},${speed},${ids});`;
const save = (...args) => JSON.parse(asUser(saveSql(...args)));
const count = () => Number(sql("select count(*) from public.pick_submission_versions;"));
const row = (race = 1) => sql(`select to_jsonb(pick) from public.picks pick where user_id='${A}' and race_id=${race};`);
const reset = () => sql(`truncate public.profiles, public.league_seasons, public.drivers restart identity cascade;
  insert into public.profiles(id,team_name) values('${A}','Fixture A'),('${B}','Fixture B');
  insert into public.league_seasons(id,season_year,display_name,status) values(1,2027,'Fixture 2027','active');
  insert into public.season_participants(season_id,profile_id,status,registered_at) values(1,'${A}','registered',now());
  insert into public.drivers(id,driver_name,current_standing,group_number) select n,'Fixture Driver '||n,n,least(6,((n-1)/2)+1) from generate_series(1,33) n;
  insert into public.races(id,season_id,round_number,race_name,qualifying_start_at,race_date,pick_window_key) values
    (1,1,1,'Fixture Race 1',now()+interval '1 day',now()+interval '2 days','00000000-0000-4000-8000-000000000010'),
    (2,1,2,'Fixture Race 2',now()+interval '1 day',now()+interval '3 days','00000000-0000-4000-8000-000000000010');`);
let checks = 0, started = false;
const check = (name, fn) => { fn(); checks++; console.log("PASS " + name); };
try {
  docker(["image", "inspect", "postgres:16-alpine", "--format", "{{.Id}}"]);
  docker(["run", "-d", "--rm", "--pull=never", "--network=none", "--name", container, "-e", "POSTGRES_HOST_AUTH_METHOD=trust", "postgres:16-alpine"]);
  started = true;
  let ready = false;
  for (let n = 0; n < 60; n++) {
    try { docker(["exec", container, "pg_isready", "-h", "127.0.0.1", "-U", "postgres"]); ready = true; break; }
    catch { await new Promise(resolve => setTimeout(resolve, 200)); }
  }
  assert.ok(ready);
  sql(bootstrap); sql(migration); sql(migration);
  sql(`insert into auth.users values('${A}'),('${B}');`);
  reset();
  check("migration can be reapplied and authenticated first saves retain the response contract", () => {
    const result = save();
    assert.deepEqual(Object.keys(result).sort(), ["message","nextRaceId","pickId","raceId","savedRaceCount","submissionVersion","updatedAt","windowRaceCount"].sort());
    assert.equal(result.submissionVersion, 1); assert.equal(result.savedRaceCount, 1); assert.equal(result.nextRaceId, 2); assert.equal(count(), 1);
  });
  check("identical normalized speed and nullable standard groups do not update the row or append a version", () => {
    const before = row(), result = save(1,"135.5");
    assert.equal(row(), before); assert.equal(count(), 1); assert.equal(result.submissionVersion, 1); assert.match(result.message, /already saved/); assert.equal(result.nextRaceId, 2);
    save(1,"135.5004"); assert.equal(row(), before); assert.equal(count(), 1);
  });
  check("real speed changes keep version history", () => {
    const before = JSON.parse(row()); const result = save(1,"135.501");
    assert.equal(count(), 2); assert.equal(result.submissionVersion, 2); assert.notEqual(result.updatedAt, before.updated_at);
  });
  check("real driver changes keep version history", () => {
    save(1,"135.501","array[2,3,5,7,9,11]::bigint[]"); assert.equal(count(), 3);
    assert.equal(JSON.parse(row()).driver_group1_id, 2);
  });
  check("unchanged second doubleheader submission still returns complete-window navigation", () => {
    save(2); const before = row(2), total = count(), result = save(2);
    assert.equal(result.nextRaceId, null); assert.equal(result.savedRaceCount, 2); assert.equal(result.windowRaceCount, 2);
    assert.equal(row(2), before); assert.equal(count(), total); assert.match(result.message, /Both doubleheader.*already saved/);
  });
  check("anonymous and service roles cannot call the participant RPC", () => {
    for (const role of ["anon", "service_role"]) assert.throws(() => sql(`set role ${role};${saveSql()}`), /permission denied/);
    assert.throws(() => asUser(saveSql(), ""), /Authentication required/);
  });
  check("a participant cannot reuse another participant's saved submission", () => {
    assert.throws(() => asUser(saveSql(), B), /Register for this league season/);
  });
  const same = "array[2,3,5,7,9,11]::bigint[]";
  check("unchanged submits still enforce current enrollment and active profiles", () => {
    sql(`update public.profiles set is_active=false where id='${A}';`); assert.throws(() => save(1,"135.501",same), /Register for this league season/);
    sql(`update public.profiles set is_active=true where id='${A}'; update public.season_participants set status='declined',registered_at=null where profile_id='${A}';`);
    assert.throws(() => save(1,"135.501",same), /Register for this league season/);
    sql(`update public.season_participants set status='registered',registered_at=now() where profile_id='${A}';`);
  });
  check("unchanged submits still reject completed seasons and archived races", () => {
    sql("update public.league_seasons set status='completed';"); assert.throws(() => save(1,"135.501",same), /active league season/);
    sql("update public.league_seasons set status='active';update public.races set is_archived=true where id=1;");
    assert.throws(() => save(1,"135.501",same), /archived races/); sql("update public.races set is_archived=false where id=1;");
  });
  check("unchanged submits still enforce the qualifying deadline", () => {
    sql("update public.races set qualifying_start_at=now()-interval '1 hour' where id=1;");
    assert.throws(() => save(1,"135.501",same), /qualifying has already started/);
    sql("update public.races set qualifying_start_at=now()+interval '1 day' where id=1;");
  });
  check("invalid speed, missing, duplicate and swapped drivers are still rejected", () => {
    assert.throws(() => save(1,"0"), /average speed/);
    assert.throws(() => save(1,"301"), /average speed/);
    assert.throws(() => save(1,"null"), /average speed/);
    assert.throws(() => save(1,"135.500","array[1,3,5,7,9]::bigint[]"), /each of the 6 groups/);
    assert.throws(() => save(1,"135.500","array[1,3,5,7,9,null]::bigint[]"), /each of the 6 groups/);
    assert.throws(() => save(1,"135.500","array[1,1,5,7,9,11]::bigint[]"), /different driver/);
    assert.throws(() => save(1,"135.500","array[3,1,5,7,9,11]::bigint[]"), /Invalid Group 1/);
  });
  check("unchanged submits still validate the frozen field", () => {
    sql("delete from public.race_driver_groups where race_id=1 and driver_id=2;");
    assert.throws(() => save(1,"135.501",same), /Invalid Group 1/);
    sql("insert into public.race_driver_groups(race_id,driver_id,group_number) values(1,2,1);");
  });
  check("unchanged submits remain blocked until the prior pick window's results are published", () => {
    const total = count();
    sql("update public.races set round_number=round_number+3;insert into public.races(id,season_id,round_number,race_name,qualifying_start_at,race_date) values(3,1,3,'Fixture prior window',now()-interval '2 days',now()-interval '1 day');");
    assert.throws(() => save(1,"135.501",same), /results are published for/);
    sql("update public.races set results_status='published' where id=3;");
    save(1,"135.501",same); assert.equal(count(),total);
  });
  reset();
  check("opening-week no-op attempts still enforce six days before qualifying", () => {
    save(); sql("update public.races set field_frozen_at=null,qualifying_start_at=now()+interval '8 days',race_date=now()+interval '9 days';");
    assert.throws(() => save(), /opens six days before qualifying/);
  });
  reset();
  sql("update public.races set pick_format='indy_500' where id=1;insert into public.race_driver_groups(race_id,driver_id,group_number,qualifying_position) select 1,n,least(8,((n-1)/4)+1),n from generate_series(1,33)n;");
  check("all eight Indy groups are preserved and no-op speed formatting does not add history", () => {
    save(1,"225.500",indy); const before = row(), total = count(); const result = save(1,"225.5",indy);
    assert.equal(row(), before); assert.equal(count(), total); assert.equal(result.submissionVersion, 1); assert.equal(JSON.parse(row()).driver_group8_id,29);
  });
  check("changing group eight creates a real new version", () => {
    const result = save(1,"225.500","array[1,5,9,13,17,21,25,30]::bigint[]"); assert.equal(result.submissionVersion, 2); assert.equal(count(), 2);
  });
  check("Indy no-op submits enforce race start while remaining open after qualifying", () => {
    sql("update public.races set qualifying_start_at=now()-interval '1 day' where id=1;");
    save(1,"225.500","array[1,5,9,13,17,21,25,30]::bigint[]"); assert.equal(count(), 2);
    sql("update public.races set race_date=now()-interval '1 hour' where id=1;");
    assert.throws(() => save(1,"225.500","array[1,5,9,13,17,21,25,30]::bigint[]"), /race has already started/);
  });
  reset();
  // Hold a genuine change uncommitted while a second RPC attempts the same data.
  // The original race-field lock plus ON CONFLICT row lock must serialize both.
  save();
  const locker = spawn("docker", ["--host", host, ...sqlArgs], { stdio: ["pipe", "pipe", "pipe"] });
  let text = "";
  const locked = new Promise((resolve,reject) => {
    const timer = setTimeout(() => reject(new Error("Concurrent fixture timed out")), 10_000);
    locker.stdout.on("data", data => { text += data; if (text.includes("PICK_LOCKED")) { clearTimeout(timer); resolve(); } });
  });
  const closed = new Promise(resolve => locker.on("close", resolve));
  locker.stderr.resume();
  let racer;
  try {
    locker.stdin.write(`begin;${actor(A)}${saveSql(1,"140.000")}\n\\echo PICK_LOCKED\n`);
    await locked;
    racer = spawn("docker", ["--host", host, ...sqlArgs], { stdio: ["pipe", "pipe", "pipe"] });
    let out = "", error = "";
    racer.stdout.on("data", data => { out += data; }); racer.stderr.on("data", data => { error += data; });
    const complete = new Promise(resolve => racer.on("close", code => resolve({code,out,error})));
    racer.stdin.end(actor(A) + saveSql(1,"140.0"));
    await new Promise(resolve => setTimeout(resolve, 200));
    locker.stdin.end("commit;\n\\q\n");
    const result = await complete;
    check("concurrent identical retries serialize to one actual new version", () => {
      assert.equal(result.code,0,result.error); assert.equal(count(),2);
      assert.match(result.out,/already saved/); assert.equal(JSON.parse(row()).average_speed,140);
    });
  } finally {
    if (!locker.stdin.writableEnded) locker.stdin.end("rollback;\n\\q\n");
    await closed;
    if (racer && racer.exitCode === null) racer.kill();
  }
  console.log(`PASS: ${checks} local idempotent pick checks; no live services used.`);
} finally {
  if (started) docker(["stop", container]);
}
