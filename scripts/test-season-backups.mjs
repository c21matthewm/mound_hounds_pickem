import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Never reads application credentials or connects to an existing database. Only a
// fresh, network-disabled container from an already-cached image is accepted.
const projectRoot = new URL("../", import.meta.url);
const read = (relativePath) => readFileSync(new URL(relativePath, projectRoot), "utf8");
const schema = read("supabase/schema.sql");
const original = read("supabase/migrations/20260730_atomic_picks_and_season_recovery.sql");
const bounded = read("supabase/migrations/20260818_bound_recovery_jobs_and_registration.sql");
const portable = read("supabase/migrations/20260904_fix_portable_season_backups.sql");
const audit = read("supabase/migrations/20260725_harden_race_and_season_operations.sql");

const extract = (source, kind, name) => {
  const start = source.indexOf(`create ${kind === "function" ? "or replace function" : "table if not exists"} public.${name} (`);
  // Functions conventionally have no space before their argument list.
  const offset = start >= 0 ? start : source.indexOf(`create or replace function public.${name}(`);
  assert.ok(offset >= 0, `Missing ${kind} definition: ${name}`);
  const terminator = kind === "function" ? "\n$$;" : "\n);";
  const end = source.indexOf(terminator, offset);
  assert.ok(end > offset, `Unterminated ${kind} definition: ${name}`);
  return source.slice(offset, end + terminator.length);
};

// Use the real table constraints and recovery functions. Only Supabase's auth
// schema is shimmed; the application snapshot, hashing, audit, and restore code
// runs unchanged. Unrelated application triggers and RLS are outside this test.
const bootstrap = [
  `create role anon;
   create role authenticated;
   create role service_role;
   create schema auth;
   create schema extensions;
   create extension pgcrypto with schema extensions;
   create table auth.users (id uuid primary key);
   create function auth.uid() returns uuid language sql stable as $$
     select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
   $$;
   create function auth.role() returns text language sql stable as $$
     select current_setting('request.jwt.claim.role', true);
   $$;
   grant usage on schema public, auth to anon, authenticated, service_role;`,
  ...[
    "profiles", "drivers", "league_seasons", "season_participants", "app_metadata",
    "races", "picks", "results", "race_driver_groups", "admin_audit_events",
    "hall_of_fame_seasons", "hall_of_fame_entries"
  ].map((name) => extract(schema, "table", name)),
  extract(original, "table", "pick_submission_versions"),
  extract(original, "table", "season_restore_points"),
  `alter table public.season_restore_points add column retention_key text;
   alter table public.season_restore_points add column snapshot_bytes bigint not null default 0;`,
  extract(schema, "function", "is_admin"),
  extract(audit, "function", "write_admin_audit_event"),
  extract(schema, "function", "refresh_driver_standings_from_published_results"),
  extract(bounded, "function", "build_season_recovery_snapshot"),
  extract(original, "function", "season_recovery_row_counts"),
  extract(original, "function", "create_season_restore_point"),
  extract(original, "function", "import_season_restore_point"),
  extract(original, "function", "restore_season_from_restore_point"),
  extract(bounded, "function", "restore_season_from_restore_point_v2"),
  portable,
  read("tests/database/season-backup-fixtures.sql")
].join("\n\n");

if (process.argv.includes("--check-fixtures")) {
  console.log("Recovery fixture definitions loaded. PostgreSQL tests have not run.");
  process.exit(0);
}

const run = (command, args, input) => {
  const result = spawnSync(command, args, {
    cwd: fileURLToPath(projectRoot), encoding: "utf8", input,
    maxBuffer: 16 * 1024 * 1024, timeout: 30_000
  });
  if (result.error || result.status !== 0) {
    throw new Error(`${command} failed: ${result.error?.message ?? result.stderr.trim()}`);
  }
  return result.stdout.trim();
};

const container = `mound-hounds-backup-test-${randomUUID()}`;
const image = process.env.SEASON_BACKUP_TEST_IMAGE || "postgres:17";
let dockerHost;
let started = false;
const docker = (args, input) => run("docker", ["--host", dockerHost, ...args], input);
const adminId = "00000000-0000-4000-8000-000000000001";
const participantId = "00000000-0000-4000-8000-000000000002";
const literal = (value) => `'${String(value).replaceAll("'", "''")}'`;
const json = (value) => `${literal(JSON.stringify(value))}::jsonb`;
const checksum = (value) => createHash("sha256").update(value, "utf8").digest("hex");
const sql = (statement, user = adminId) => docker([
  "exec", "--interactive", container, "psql", "-X", "-qAt",
  "--host", "127.0.0.1", "--username", "postgres", "--dbname", "season_backup_test",
  "--set", "ON_ERROR_STOP=1"
], `set request.jwt.claim.sub = ${literal(user)};
    set request.jwt.claim.role = 'authenticated';
    ${statement}`);
const selectJson = (statement) => JSON.parse(sql(`select ${statement};`));
const expectSqlError = (statement, pattern, user) => {
  assert.throws(() => sql(statement, user), pattern);
};
const importDocument = (document) => selectJson(`public.import_season_restore_point_v2(${json(document)})`);

try {
  dockerHost = process.env.DOCKER_HOST || run("docker", [
    "context", "inspect", "--format", '{{(index .Endpoints "docker").Host}}'
  ]);
  assert.ok(dockerHost.startsWith("unix://"), "Use a local Docker Unix socket; remote Docker hosts are refused.");
  docker(["info", "--format", "{{.ServerVersion}}"]);
  docker(["image", "inspect", image, "--format", "{{.Id}}"]);
  docker([
    "run", "--detach", "--rm", "--pull=never", "--network=none", "--name", container,
    "--env", "POSTGRES_HOST_AUTH_METHOD=trust", "--env", "POSTGRES_DB=season_backup_test", image
  ]);
  started = true;

  let ready = false;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      docker(["exec", container, "pg_isready", "--host", "127.0.0.1", "--username", "postgres", "--dbname", "season_backup_test"]);
      ready = true;
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  assert.ok(ready, "Disposable PostgreSQL did not become ready.");
  sql(bootstrap);

  const created = selectJson("public.create_season_restore_point(1, 'Portability fixture', 'manual')");
  const exported = selectJson(`public.export_season_restore_point(${literal(created.id)}::uuid)`);
  assert.equal(exported.formatVersion, 2);
  assert.equal(exported.checksum, checksum(exported.snapshotText));
  assert.match(exported.snapshotText, /"payout": 0\.00/);
  assert.match(exported.snapshotText, /"average_speed": 190\.000/);
  assert.match(exported.snapshotText, /"official_winning_average_speed": 190\.000/);

  // Simulate both the server's download serialization and browser upload parse.
  const uploaded = JSON.parse(JSON.stringify(JSON.parse(JSON.stringify(exported)), null, 2));
  assert.equal(uploaded.snapshotText, exported.snapshotText);
  const imported = importDocument(uploaded);
  assert.equal(imported.source, "uploaded");
  assert.equal(imported.formatVersion, 1, "Internal restore points retain their existing format.");
  const stored = selectJson(`jsonb_build_object('text', snapshot::text, 'checksum', checksum)
    from public.season_restore_points where id = ${literal(imported.id)}::uuid`);
  assert.equal(stored.text, exported.snapshotText);
  assert.equal(stored.checksum, checksum(stored.text));

  // The raw file checksum also covers whitespace; storage uses the canonical
  // jsonb checksum expected by the unchanged restore validator.
  const spacedText = `\n  ${exported.snapshotText}\n`;
  const spacedImport = importDocument({ ...uploaded, snapshotText: spacedText, checksum: checksum(spacedText) });
  const canonical = selectJson(`jsonb_build_object('text', snapshot::text, 'checksum', checksum)
    from public.season_restore_points where id = ${literal(spacedImport.id)}::uuid`);
  assert.equal(canonical.checksum, checksum(canonical.text));
  assert.notEqual(canonical.checksum, checksum(spacedText));

  const tampered = { ...uploaded, snapshotText: uploaded.snapshotText.replace('"payout": 0.00', '"payout": 1.00') };
  const pointCount = sql("select count(*) from public.season_restore_points;");
  expectSqlError(`select public.import_season_restore_point_v2(${json(tampered)});`, /checksum validation failed/i);
  assert.equal(sql("select count(*) from public.season_restore_points;"), pointCount);

  for (const malformedText of ["{", "[]", "null"]) {
    const invalid = { ...uploaded, snapshotText: malformedText, checksum: checksum(malformedText) };
    expectSqlError(`select public.import_season_restore_point_v2(${json(invalid)});`, /snapshot.*(valid JSON|JSON object)/i);
  }

  // Valid v1 files retain their strict validation. A v1 file whose decimal
  // representation changed in JavaScript must continue to fail validation.
  const legacy = { ...uploaded, formatVersion: 1, snapshot: JSON.parse(uploaded.snapshotText) };
  delete legacy.snapshotText;
  expectSqlError(`select public.import_season_restore_point_v2(${json(legacy)});`, /checksum validation failed/i);
  const legacyText = sql(`select (${json(legacy.snapshot)})::text;`);
  assert.notEqual(checksum(legacyText), uploaded.checksum);
  legacy.checksum = checksum(legacyText);
  assert.equal(importDocument(legacy).source, "uploaded");

  expectSqlError(`select public.export_season_restore_point(${literal(created.id)}::uuid);`, /Admin access required/i, participantId);
  expectSqlError(`select public.import_season_restore_point_v2(${json(uploaded)});`, /Admin access required/i, participantId);
  for (const signature of ["public.export_season_restore_point(uuid)", "public.import_season_restore_point_v2(jsonb)"]) {
    assert.equal(sql(`select has_function_privilege('anon', ${literal(signature)}, 'execute');`), "f");
    assert.equal(sql(`select has_function_privilege('authenticated', ${literal(signature)}, 'execute');`), "t");
  }

  // Exercise the real restore transaction and its pre-restore safety snapshot.
  sql("update public.races set payout = 75.25, official_winning_average_speed = 180.125 where id = 1; update public.picks set average_speed = 181.250 where id = 1;");
  const restored = selectJson(`public.restore_season_from_restore_point_v2(${literal(imported.id)}::uuid, 2026)`);
  assert.equal(restored.restoredPointId, imported.id);
  const recovered = selectJson("jsonb_build_object('payout', payout::text, 'speed', official_winning_average_speed::text, 'pickSpeed', (select average_speed::text from public.picks where id = 1), 'versions', (select count(*) from public.pick_submission_versions)) from public.races where id = 1");
  assert.deepEqual(recovered, { payout: "0.00", speed: "190.000", pickSpeed: "190.000", versions: 1 });
  const safety = selectJson(`jsonb_build_object('source', source, 'payout', snapshot->'races'->0->>'payout')
    from public.season_restore_points where id = ${literal(restored.safetyPointId)}::uuid`);
  assert.deepEqual(safety, { source: "pre_restore", payout: "75.25" });
  assert.equal(sql("select count(*) from public.results;"), "6");
  assert.equal(sql("select count(*) from public.race_driver_groups;"), "6");

  // Deliberately corrupt a fixture row (unrelated immutability triggers are not
  // installed) to verify both consumers still enforce the internal checksum.
  sql(`update public.season_restore_points set checksum = repeat('0', 64) where id = ${literal(imported.id)}::uuid;`);
  expectSqlError(`select public.export_season_restore_point(${literal(imported.id)}::uuid);`, /Stored backup checksum validation failed/i);
  expectSqlError(`select public.restore_season_from_restore_point_v2(${literal(imported.id)}::uuid, 2026);`, /Stored backup checksum validation failed/i);
  console.log("Passed PostgreSQL backup export/import/restore, decimal preservation, tampering, legacy compatibility, admin access, and safety snapshot checks.");
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  if (!started) {
    console.error(`Start local Docker with a cached ${image} image to run this test. This runner never pulls images or uses application credentials.`);
  }
  process.exitCode = 1;
} finally {
  if (started) {
    docker(["rm", "--force", container]);
  }
}
