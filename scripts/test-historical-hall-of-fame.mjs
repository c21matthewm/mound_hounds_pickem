import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

// Never reads app credentials, uses an existing DB, downloads an image, or
// connects to a remote Docker daemon. Every run creates a network-disabled DB.
const projectRoot = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, projectRoot), "utf8");
const schema = read("supabase/schema.sql");
const audit = read("supabase/migrations/20260725_harden_race_and_season_operations.sql");
const extract = (source, kind, name) => {
  const prefix = kind === "table" ? `create table if not exists public.${name} (` : `create or replace function public.${name}(`;
  const start = source.indexOf(prefix);
  const terminator = kind === "table" ? "\n);" : "\n$$;";
  const end = source.indexOf(terminator, start);
  assert.ok(start >= 0 && end > start, `Cannot find ${name} definition.`);
  return source.slice(start, end + terminator.length);
};
const bootstrap = [
  `create role anon; create role authenticated; create role service_role;
   create schema auth; create table auth.users (id uuid primary key);
   create function auth.uid() returns uuid language sql stable as $$
     select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
   $$;
   create function auth.role() returns text language sql stable as $$
     select current_setting('request.jwt.claim.role', true);
   $$;
   grant usage on schema public, auth to anon, authenticated, service_role;`,
  ...["profiles", "hall_of_fame_seasons", "hall_of_fame_entries", "admin_audit_events"].map((name) => extract(schema, "table", name)),
  extract(schema, "function", "is_admin"),
  extract(audit, "function", "write_admin_audit_event"),
  read("supabase/migrations/20260913_add_historical_hall_of_fame_import.sql")
].join("\n\n");
const fixtures = read("tests/database/historical-hall-of-fame-import.sql");
if (process.argv.includes("--check-fixtures")) {
  console.log("Historical Hall of Fame fixture definitions loaded. PostgreSQL tests have not run.");
  process.exit(0);
}
const run = (command, args, input) => {
  const result = spawnSync(command, args, { encoding: "utf8", input, maxBuffer: 4 * 1024 * 1024, timeout: 30_000 });
  if (result.error || result.status !== 0) throw new Error(`${command}: ${result.error?.message ?? result.stderr.trim()}`);
  return result.stdout.trim();
};
const dockerHost = process.env.DOCKER_HOST || run("docker", ["context", "inspect", "--format", '{{(index .Endpoints "docker").Host}}']);
assert.ok(dockerHost.startsWith("unix://"), "Only a local Docker Unix socket is supported.");
const container = `mound-hounds-hall-import-test-${randomUUID()}`;
const image = "postgres:16-alpine";
const docker = (args, input) => run("docker", ["--host", dockerHost, ...args], input);
const psqlArgs = ["exec", "--interactive", container, "psql", "-X", "-qAt", "--host", "127.0.0.1", "-U", "postgres", "-d", "hall_import_test", "-v", "ON_ERROR_STOP=1"];
const actor = "00000000-0000-4000-8000-000000000101";
const sqlPrefix = `set request.jwt.claim.sub='${actor}'; set request.jwt.claim.role='authenticated'; set mhp.test_mode='isolated';\n`;
const sql = (statement) => docker(psqlArgs, sqlPrefix + statement);
const asyncSql = (statement) => {
  const child = spawn("docker", ["--host", dockerHost, ...psqlArgs], { stdio: ["pipe", "pipe", "pipe"] });
  let output = "";
  let error = "";
  let readyResolve;
  const ready = new Promise((resolve) => { readyResolve = resolve; });
  child.stdout.on("data", (data) => { output += data.toString(); if (output.includes("IMPORT_READY")) readyResolve(); });
  child.stderr.on("data", (data) => { error += data.toString(); });
  const complete = new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => { readyResolve(); resolve({ code, output, error }); });
  });
  child.stdin.end(sqlPrefix + statement);
  return { ready, complete };
};
let started = false;
try {
  docker(["image", "inspect", image, "--format", "{{.Id}}"]);
  docker(["run", "--detach", "--rm", "--pull=never", "--network=none", "--name", container,
    "--env", "POSTGRES_HOST_AUTH_METHOD=trust", "--env", "POSTGRES_DB=hall_import_test", image]);
  started = true;
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try { docker(["exec", container, "pg_isready", "--host", "127.0.0.1", "-U", "postgres", "-d", "hall_import_test"]); ready = true; break; }
    catch { await new Promise((resolve) => setTimeout(resolve, 250)); }
  }
  assert.ok(ready, "Disposable PostgreSQL did not become ready.");
  sql(bootstrap);
  assert.match(sql(fixtures), /PASS: historical imports/);
  console.log("PASS: input validation, administrator access, original archive protection, normal app corrections, and atomic rollback.");

  // Fixtures roll back. Seed one admin for isolated concurrent writers.
  sql(`insert into auth.users values ('${actor}');
       insert into profiles (id,full_name,team_name,role,is_active) values ('${actor}','Admin','Admin','admin',true);`);
  const original = '[{"final_rank":1,"team_name":"Historical winner","total_points":40}]';
  const replacement = '[{"final_rank":1,"team_name":"Replacement","total_points":80,"race_breakdown":[{"race_id":1,"points":80}]}]';
  const first = asyncSql(`begin; select import_historical_hall_of_fame_season(2026,1,'${original}'); select 'IMPORT_READY'; select pg_sleep(2); commit;`);
  await first.ready;
  const second = asyncSql(`select finalize_hall_of_fame_season(2026,1,'${replacement}');`);
  const [imported, prevented] = await Promise.all([first.complete, second.complete]);
  assert.equal(imported.code, 0, imported.error);
  assert.notEqual(prevented.code, 0);
  assert.match(prevented.error, /Historical Hall of Fame archives cannot be replaced/);
  assert.equal(sql("select champion_team_name from hall_of_fame_seasons where season_year=2026;"), "Historical winner");

  const duplicateFirst = asyncSql(`begin; select import_historical_hall_of_fame_season(2025,1,'${original}'); select 'IMPORT_READY'; select pg_sleep(2); commit;`);
  await duplicateFirst.ready;
  const duplicateSecond = asyncSql(`select import_historical_hall_of_fame_season(2025,1,'${original}');`);
  const [winner, refused] = await Promise.all([duplicateFirst.complete, duplicateSecond.complete]);
  assert.equal(winner.code, 0, winner.error);
  assert.notEqual(refused.code, 0);
  assert.match(refused.error, /duplicate key value violates unique constraint/);
  assert.equal(sql("select count(*) from admin_audit_events where after_state->>'season_year'='2025';"), "1");
  console.log("PASS: concurrent imports are create-only and a concurrent app finalization cannot replace an imported archive.");
} finally {
  if (started) docker(["stop", "--time", "1", container]);
}
