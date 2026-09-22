import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

// No application environment files, remote database, image pull, or network.
// Uses a cached PostgreSQL image through a local Docker Unix socket only.
const projectRoot = new URL("../", import.meta.url);
const read = path => readFileSync(new URL(path, projectRoot), "utf8");
const schema = read("supabase/schema.sql");
const extract = (source, kind, name) => {
  const prefix = kind === "table" ? `create table if not exists public.${name} (` : `create or replace function public.${name}(`;
  const start = source.indexOf(prefix);
  const suffix = kind === "table" ? "\n);" : "\n$$;";
  const end = source.indexOf(suffix, start);
  assert.ok(start >= 0 && end > start, `Missing fixture definition ${name}`);
  return source.slice(start, end + suffix.length);
};
const migration = read("supabase/migrations/20260919_add_season_rules_documents.sql");
const bootstrap = [
  `create role anon; create role authenticated; create role service_role bypassrls;
   create schema auth; create table auth.users(id uuid primary key);
   create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
   create function auth.role() returns text language sql stable as $$ select current_setting('request.jwt.claim.role',true) $$;
   create schema storage;
   create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
   create table storage.objects(bucket_id text,name text);
   alter table storage.objects enable row level security;
   grant usage on schema auth,public,storage to anon,authenticated,service_role;
   grant all on storage.objects to anon,authenticated,service_role;`,
  ...["profiles", "league_seasons", "admin_audit_events"].map(name => extract(schema, "table", name)),
  extract(schema, "function", "is_admin"),
  extract(read("supabase/migrations/20260725_harden_race_and_season_operations.sql"), "function", "write_admin_audit_event"),
  migration
].join("\n");
const fixture = read("tests/database/season-rules-documents.sql");
if (process.argv.includes("--check-fixtures")) { console.log("Rules fixture definitions loaded; PostgreSQL tests have not run."); process.exit(0); }
const run = (command, args, input) => {
  const result = spawnSync(command, args, { encoding: "utf8", input, maxBuffer: 4 * 1024 * 1024, timeout: 30_000 });
  if (result.error || result.status !== 0) throw new Error(`${command}: ${result.error?.message ?? result.stderr.trim()}`);
  return result.stdout.trim();
};
const dockerHost = process.env.DOCKER_HOST || run("docker", ["context", "inspect", "--format", '{{(index .Endpoints "docker").Host}}']);
assert.ok(dockerHost.startsWith("unix://"), "Only a local Docker Unix socket is supported.");
const container = `mound-rules-test-${randomUUID()}`;
const docker = (args, input) => run("docker", ["--host", dockerHost, ...args], input);
const psqlArgs = ["exec", "--interactive", container, "psql", "-X", "-qAt", "-U", "postgres", "-d", "rules_test", "-v", "ON_ERROR_STOP=1"];
const actor = "00000000-0000-4000-8000-000000000101";
const prefix = `set mhp.test_mode='isolated';set request.jwt.claim.sub='${actor}';set request.jwt.claim.role='authenticated';\n`;
const sql = statement => docker(psqlArgs, prefix + statement);
const asyncSql = statement => {
  const child = spawn("docker", ["--host", dockerHost, ...psqlArgs], { stdio: ["pipe", "pipe", "pipe"] });
  let output = "", error = "", readyResolve;
  const ready = new Promise(resolve => { readyResolve = resolve; });
  child.stdout.on("data", data => { output += data.toString(); if (output.includes("RULES_READY")) readyResolve(); });
  child.stderr.on("data", data => { error += data.toString(); });
  const complete = new Promise((resolve, reject) => { child.on("error", reject); child.on("close", code => { readyResolve(); resolve({ code, output, error }); }); });
  child.stdin.end(prefix + statement);
  return { ready, complete };
};
let started = false;
try {
  docker(["image", "inspect", "postgres:16-alpine", "--format", "{{.Id}}"]);
  docker(["run", "--detach", "--rm", "--pull=never", "--network=none", "--name", container,
    "--env", "POSTGRES_HOST_AUTH_METHOD=trust", "--env", "POSTGRES_DB=rules_test", "postgres:16-alpine"]);
  started = true;
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try { docker(["exec", container, "pg_isready", "-U", "postgres", "-d", "rules_test"]); ready = true; break; }
    catch { await new Promise(resolve => setTimeout(resolve, 250)); }
  }
  assert.ok(ready, "Disposable PostgreSQL did not become ready.");
  sql(bootstrap);
  assert.match(sql(fixture), /PASS: season rules authorization/);
  console.log("PASS: authorization, unsafe URLs, concurrent-edit checks, unchanged/cleared rules, audit rollback and restrictive Storage policy.");
  sql(migration);
  for (const settings of ["public=false", "file_size_limit=10485760", "allowed_mime_types=array['text/html']"]) {
    sql(`update storage.buckets set ${settings} where id='season-rules';`);
    assert.throws(() => sql(migration), /existing season-rules bucket has unexpected settings/);
    sql("update storage.buckets set public=true,file_size_limit=5242880,allowed_mime_types=array['application/pdf'] where id='season-rules';");
  }
  console.log("PASS: migration is repeatable and refuses incompatible existing bucket settings.");
  sql(`insert into auth.users values ('${actor}'); insert into profiles(id,full_name,team_name,role,is_active) values ('${actor}','Admin','Admin','admin',false);
    insert into league_seasons(id,season_year,display_name,status,rules_document_url) values (1,2027,'2027','active','/old.pdf');`);
  const first = asyncSql("begin; select set_league_season_rules_document(1,'/new.pdf','/old.pdf'); select 'RULES_READY'; select pg_sleep(2); commit;");
  await first.ready;
  const competing = asyncSql("select set_league_season_rules_document(1,'/competing.pdf','/old.pdf');");
  const [saved, refused] = await Promise.all([first.complete, competing.complete]);
  assert.equal(saved.code, 0, saved.error);
  assert.notEqual(refused.code, 0);
  assert.match(refused.error, /could not obtain lock on row in relation "league_seasons"/);
  assert.throws(() => sql("select set_league_season_rules_document(1,'/stale.pdf','/old.pdf');"), /rules document has changed/);
  assert.equal(sql("select rules_document_url from league_seasons where id=1;"), "/new.pdf");
  assert.equal(sql("select count(*) from admin_audit_events where action='update_rules_document';"), "1");
  console.log("PASS: simultaneous saves cannot overwrite a newer document or create a second audit event.");
} finally {
  if (started) docker(["stop", "--time", "1", container]);
}
