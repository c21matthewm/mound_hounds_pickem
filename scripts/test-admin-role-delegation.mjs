import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Fictional accounts in a disposable, network-disabled local PostgreSQL container.
// No .env files, app services, existing databases, image pulls, or remote sockets.
const root = process.argv[2] ?? fileURLToPath(new URL("..", import.meta.url));
const migrationPath = process.argv[3] ?? path.join(root, "supabase/migrations/20260913_admin_role_delegation.sql");
const schema = readFileSync(path.join(root, "supabase/schema.sql"), "utf8");
const hardening = readFileSync(path.join(root, "supabase/migrations/20260725_harden_race_and_season_operations.sql"), "utf8");
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
const missing = "00000000-0000-4000-8000-000000000099";
const bootstrap = [
  `create role anon; create role authenticated; create role service_role;
   create schema auth;
   create table auth.users (id uuid primary key);
   create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
   create function auth.role() returns text language sql stable as $$ select current_setting('request.jwt.claim.role', true) $$;
   grant usage on schema auth, public to authenticated, anon, service_role;`,
  extract(schema, "table", "profiles"), extract(schema, "table", "admin_audit_events"),
  extract(schema, "function", "is_admin"), extract(schema, "function", "protect_profile_role"),
  extract(hardening, "function", "write_admin_audit_event"),
  `create trigger trg_protect_profile_role before insert or update of role, is_active on public.profiles
     for each row execute function public.protect_profile_role();
   grant select, insert, update, delete on public.profiles to authenticated;
   alter table public.profiles enable row level security;
   create policy profiles_read on public.profiles for select to authenticated using(id=auth.uid() or public.is_admin(auth.uid()));
   create policy profiles_update on public.profiles for update to authenticated using(id=auth.uid() or public.is_admin(auth.uid())) with check(id=auth.uid() or public.is_admin(auth.uid()));
   insert into auth.users values ('${A}'), ('${B}'), ('${C}'), ('${D}');`
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
const container = `mound-admin-roles-test-${randomUUID()}`;
const psqlArgs = ["exec", "-i", container, "psql", "-X", "-qAt", "-h", "127.0.0.1", "-U", "postgres", "-v", "ON_ERROR_STOP=1"];
const sql = (statement) => docker(psqlArgs, statement);
const actor = (id) => `set role authenticated; set request.jwt.claim.role='authenticated'; set request.jwt.claim.sub='${id}';`;
const rpc = (target, role, previous) => `select public.admin_update_participant_role('${target}', '${role}', '${previous}');`;
const asUser = (id, statement) => sql(`${actor(id)} ${statement}`);
const reset = () => sql(`truncate public.admin_audit_events, public.profiles restart identity cascade;
  insert into public.profiles(id,full_name,team_name,role,is_active) values
  ('${A}','Fictional Admin A','Fictional Team A','admin',true),
  ('${B}','Fictional Admin B','Fictional Team B','admin',true),
  ('${C}','Fictional Member C','Fictional Team C','participant',true),
  ('${D}',null,'Fictional Team D','participant',true);`);
const roleOf = (id) => sql(`select role from public.profiles where id='${id}';`);
const adminCount = () => sql("select count(*) from public.profiles where role='admin';");
const auditCount = () => sql("select count(*) from public.admin_audit_events;");
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
let started = false;
let checks = 0;
try {
  docker(["run", "-d", "--rm", "--pull=never", "--network=none", "--name", container,
    "-e", "POSTGRES_HOST_AUTH_METHOD=trust", "postgres:16-alpine"]);
  started = true;
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try { docker(["exec", container, "pg_isready", "-h", "127.0.0.1", "-U", "postgres"]); ready = true; break; }
    catch { await new Promise((resolve) => setTimeout(resolve, 200)); }
  }
  assert.ok(ready, "Local test database did not start.");
  sql(bootstrap);
  sql(migration);
  sql(migration); // migration reruns do not drop protections or overwrite account data
  reset();

  asUser(A, rpc(C, "admin", "participant"));
  assert.equal(roleOf(C), "admin");
  const audit = JSON.parse(sql("select to_jsonb(event) from public.admin_audit_events event limit 1;"));
  assert.equal(audit.actor_profile_id, A);
  assert.equal(audit.entity_id, C);
  assert.deepEqual(audit.before_state, { role: "participant", is_active: true });
  assert.deepEqual(audit.after_state, { role: "admin", is_active: true });
  checks += 1;
  assert.throws(() => asUser(A, rpc(C, "admin", "participant")), /role has changed/);
  assert.equal(auditCount(), "1"); checks += 1;
  assert.throws(() => asUser(A, rpc(A, "participant", "admin")), /own admin access/); checks += 1;
  assert.throws(() => asUser(A, `update public.profiles set role='participant' where id='${A}';`), /own admin access/); checks += 1;
  assert.throws(() => asUser(A, rpc(D, "admin", "participant")), /participant’s name and team/); checks += 1;
  assert.throws(() => asUser(A, rpc(missing, "admin", "participant")), /not found/); checks += 1;
  assert.throws(() => asUser(A, rpc(B, "owner", "admin")), /valid participant and role/); checks += 1;

  reset();
  assert.throws(() => asUser(C, rpc(C, "admin", "participant")), /Only an admin/);
  assert.throws(() => asUser(C, `update public.profiles set role='admin' where id='${C}';`), /Only an administrator/);
  assert.equal(roleOf(C), "participant"); checks += 1;
  assert.throws(() => sql(`set role anon; ${rpc(C, "admin", "participant")}`), /permission denied/); checks += 1;
  assert.throws(() => sql(`set role service_role; ${rpc(C, "admin", "participant")}`), /permission denied/); checks += 1;

  // A disabled admin can still administer the league, but cannot remove its only
  // participation-enabled admin until another eligible admin exists.
  asUser(A, `update public.profiles set is_active=false where id='${B}';`);
  assert.throws(() => asUser(B, rpc(A, "participant", "admin")), /Another admin with participation enabled/);
  assert.throws(() => asUser(B, `update public.profiles set role='participant' where id='${A}';`), /Another admin with participation enabled/);
  asUser(B, rpc(C, "admin", "participant"));
  asUser(B, rpc(A, "participant", "admin"));
  assert.equal(roleOf(A), "participant"); checks += 1;

  reset();
  asUser(A, rpc(B, "participant", "admin"));
  asUser(A, `update public.profiles set is_active=false where id='${A}';`);
  assert.equal(sql(`select public.is_admin('${A}');`), "t");
  asUser(A, rpc(C, "admin", "participant"));
  assert.equal(roleOf(C), "admin"); checks += 1;

  reset();
  sql(`delete from public.profiles where id='${B}';`);
  assert.throws(() => sql(`delete from public.profiles where id='${A}';`), /Another admin with participation enabled/);
  assert.equal(adminCount(), "1"); checks += 1;

  reset();
  sql("create function public.fixture_reject_audit() returns trigger language plpgsql as $$ begin raise exception 'fixture audit failure'; end $$; create trigger fixture_reject_audit before insert on public.admin_audit_events for each row execute function public.fixture_reject_audit();");
  assert.throws(() => asUser(A, rpc(C, "admin", "participant")), /fixture audit failure/);
  assert.equal(roleOf(C), "participant"); assert.equal(auditCount(), "0");
  sql("drop trigger fixture_reject_audit on public.admin_audit_events;"); checks += 1;

  reset();
  const crossed = session(`${actor(A)} begin; ${rpc(B, "participant", "admin")}`, "crossed-held");
  await crossed.ready;
  assert.throws(() => asUser(B, rpc(A, "participant", "admin")), /Another account change is in progress/);
  crossed.child.stdin.end("commit;\n");
  assert.equal((await crossed.closed).code, 0);
  assert.throws(() => asUser(B, rpc(A, "participant", "admin")), /Only an admin/);
  assert.equal(adminCount(), "1"); checks += 1;

  reset();
  const eligibility = session(`${actor(A)} begin; update public.profiles set is_active=false where id='${B}';`, "eligibility-held");
  await eligibility.ready;
  assert.throws(() => asUser(B, rpc(A, "participant", "admin")), /Another account change is in progress/);
  eligibility.child.stdin.end("commit;\n");
  assert.equal((await eligibility.closed).code, 0);
  assert.throws(() => asUser(B, rpc(A, "participant", "admin")), /Another admin with participation enabled/);
  assert.equal(adminCount(), "2"); checks += 1;

  // An old transaction snapshot must not allow the now-demoted co-admin to use
  // its stale view of either the actor's role or the remaining admin count.
  reset();
  const stale = session(`${actor(B)} begin isolation level repeatable read; select count(*) from public.profiles;`, "stale-snapshot-held");
  await stale.ready;
  asUser(A, rpc(B, "participant", "admin"));
  stale.child.stdin.end(`${rpc(A, "participant", "admin")} commit;\n`);
  const staleResult = await stale.closed;
  assert.notEqual(staleResult.code, 0);
  assert.match(staleResult.errorOutput, /could not serialize access|Only an admin|admin access has changed/);
  assert.equal(adminCount(), "1"); checks += 1;

  console.log(`PASS: ${checks} offline PostgreSQL role delegation checks, including concurrent demotions, eligibility semantics, stale snapshots, and atomic audit rollback.`);
} finally {
  for (const child of sessions) if (child.exitCode === null) child.stdin.end("rollback;\n");
  if (started) docker(["stop", "--time", "1", container]);
}
