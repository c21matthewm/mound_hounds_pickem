import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { KEEPER_ID, planAuthRemoval } from "./lib/prelaunch-2027-plan.mjs";

// One-time operator tool. No passwords, tokens, invite hashes, or Auth metadata
// are exported. All local reports are private and excluded from Git.
const keeperId = KEEPER_ID;
const command = process.argv[2] ?? "inventory";
assert.ok(["inventory", "export", "delete-users", "backup-race-images", "delete-race-images"].includes(command), "Unknown prelaunch command.");
if (fs.existsSync(".env.local")) process.loadEnvFile(".env.local");
for (const key of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]) {
  assert.ok(process.env[key], `Missing ${key}; configure locally, never paste credentials into chat.`);
}
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { fetch: (url, options) => fetch(url, { ...options, signal: AbortSignal.timeout(20_000) }) }
});
const checked = async (label, request) => {
  const response = await request;
  if (response.error) throw new Error(`${label} failed (code ${response.error.code ?? response.error.status ?? "unknown"}).`);
  return response;
};
const rows = async (table, columns, order = "id") => {
  const all = [];
  for (let offset = 0; ; offset += 500) {
    const { data } = await checked(`Read ${table}`, supabase.from(table).select(columns).order(order).range(offset, offset + 499));
    all.push(...data);
    if (data.length < 500) return all;
  }
};
const authIds = async () => {
  const ids = [];
  for (let page = 1; ; page += 1) {
    const { data } = await checked("List Auth accounts", supabase.auth.admin.listUsers({ page, perPage: 500 }));
    ids.push(...data.users.map((user) => user.id));
    if (data.users.length < 500) return ids.sort();
  }
};
const { data: keeper } = await checked("Read retained profile", supabase.from("profiles")
  .select("id,full_name,team_name,role,is_active").eq("id", keeperId).single());
const { data: keeperAuth } = await checked("Read retained Auth account", supabase.auth.admin.getUserById(keeperId));
assert.equal(keeperAuth.user.id, keeperId, "Retained Auth account does not match.");
assert.ok(keeper.full_name?.trim() && keeper.team_name?.trim(), "Complete the retained account's profile first.");

if (command === "backup-race-images" || command === "delete-race-images") {
  assert.ok(process.argv[3], "Provide the saved inventory (backup) or image manifest (delete).");
  const input = JSON.parse(fs.readFileSync(process.argv[3], "utf8"));
  const fingerprint = createHash("sha256").update(process.env.NEXT_PUBLIC_SUPABASE_URL).digest("hex");
  assert.equal(input.projectFingerprint, fingerprint, "Image inventory belongs to another project.");
  assert.equal(input.keeperId, keeperId);
  const objectPath = (value) => {
    if (!value) return null;
    const url = new URL(value);
    const prefix = "/storage/v1/object/public/race-title-images/";
    if (url.origin !== new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).origin || !url.pathname.startsWith(prefix)) return null;
    const result = decodeURIComponent(url.pathname.slice(prefix.length));
    assert.ok(result.startsWith("races/") && !result.split("/").includes(".."), "Unexpected race image path.");
    return result;
  };
  const digest = (contents) => createHash("sha256").update(contents).digest("hex");
  const download = async (name) => {
    const { data } = await checked("Download inventoried race image", supabase.storage.from("race-title-images").download(name));
    return Buffer.from(await data.arrayBuffer());
  };
  if (command === "backup-race-images") {
    const directory = path.resolve(`.local/prelaunch-2027/race-images-${Date.now()}`);
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    const objects = [];
    for (const name of [...new Set(input.races.map((race) => objectPath(race.title_image_url)).filter(Boolean))]) {
      const contents = await download(name);
      const localFile = `${digest(name)}${/\.(webp|png|jpe?g)$/i.exec(name)?.[0] ?? ".bin"}`;
      fs.writeFileSync(path.join(directory, localFile), contents, { flag: "wx", mode: 0o600 });
      objects.push({ name, localFile, sha256: digest(contents), bytes: contents.length });
    }
    const manifest = { keeperId, projectFingerprint: fingerprint, objects };
    fs.writeFileSync(path.join(directory, "manifest.json"), JSON.stringify(manifest, null, 2), { flag: "wx", mode: 0o600 });
    console.log(JSON.stringify({ savedTo: directory, images: objects.length, bytes: objects.reduce((total, object) => total + object.bytes, 0) }, null, 2));
  } else {
    assert.deepEqual(await authIds(), [keeperId], "Finish Auth cleanup before image removal.");
    const { data: marker } = await checked("Read reset marker", supabase.from("app_metadata").select("value").eq("key", "prelaunch_2027_reset").single());
    assert.equal(JSON.parse(marker.value).keeper_id, keeperId);
    const [races, drivers, snapshots] = await Promise.all([
      rows("races", "id,title_image_url"), rows("drivers", "id,image_url"), rows("season_restore_points", "id")
    ]);
    assert.equal(snapshots.length, 0, "New recovery snapshots appeared; review their image references first.");
    const referenced = new Set([...races.map((race) => objectPath(race.title_image_url)), ...drivers.map((driver) => objectPath(driver.image_url))].filter(Boolean));
    const directory = path.dirname(path.resolve(process.argv[3]));
    for (const object of input.objects) {
      assert.ok(object.name.startsWith("races/") && !object.name.split("/").includes(".."));
      assert.equal(path.basename(object.localFile), object.localFile, "Invalid backup filename.");
      assert.ok(!referenced.has(object.name), "An inventoried image is still in use; stop before deleting it.");
      assert.equal(digest(fs.readFileSync(path.join(directory, object.localFile))), object.sha256, "Image backup checksum failed.");
      assert.equal(digest(await download(object.name)), object.sha256, "A stored image changed since backup; stop before deleting it.");
    }
    // Verify every target before starting removal; this bucket and list are fixed.
    const names = [...new Set(input.objects.map((object) => object.name))];
    assert.ok(names.length <= 18, "Unexpectedly large image deletion manifest.");
    if (names.length) await checked("Remove verified unused race images", supabase.storage.from("race-title-images").remove(names));
    const { data: remaining } = await checked("Verify race image removal", supabase.storage.from("race-title-images").list("races", { limit: 1000 }));
    assert.equal(remaining.length, 0, "Some race images remain; review the bucket before declaring cleanup complete.");
    console.log(`Removed ${names.length} backed-up, unreferenced race images. Driver images were not changed.`);
  }
} else if (command === "delete-users") {
  assert.ok(process.argv[3], "Provide the saved pre-cleanup inventory file.");
  const inventory = JSON.parse(fs.readFileSync(process.argv[3], "utf8"));
  const { data: resetRow } = await checked("Read cleanup marker", supabase.from("app_metadata")
    .select("value").eq("key", "prelaunch_2027_reset").single());
  const clearedTables = ["races", "picks", "results", "pick_submission_versions", "race_driver_groups", "pick_reminders",
    "feedback_items", "season_restore_points"];
  const counts = {};
  for (const table of clearedTables) {
    const { count } = await checked(`Verify empty ${table}`, supabase.from(table).select("*", { count: "exact", head: true }));
    counts[table] = count;
  }
  const [users, profiles, hallSeasons, hallEntries] = await Promise.all([
    authIds(), rows("profiles", "id,role,is_active"), rows("hall_of_fame_seasons", "*"), rows("hall_of_fame_entries", "*")
  ]);
  const targets = planAuthRemoval({ inventory, keeper, users, profiles, counts,
    projectFingerprint: createHash("sha256").update(process.env.NEXT_PUBLIC_SUPABASE_URL).digest("hex"),
    reset: JSON.parse(resetRow.value), hallOfFame: { seasons: hallSeasons, entries: hallEntries }
  });
  assert.ok(keeperAuth.user.email_confirmed_at, "Retained email must remain confirmed.");
  let deleted = 0;
  for (const id of targets) {
    await checked(`Delete test account ${deleted + 1} of ${targets.length}`, supabase.auth.admin.deleteUser(id, false));
    deleted += 1;
    console.log(`Deleted ${deleted} of ${targets.length} approved test accounts.`);
  }
  assert.deepEqual(await authIds(), [keeperId], "Unexpected accounts remain after removal.");
  assert.deepEqual((await rows("profiles", "id")).map((profile) => profile.id), [keeperId]);
  assert.deepEqual({ seasons: await rows("hall_of_fame_seasons", "*"), entries: await rows("hall_of_fame_entries", "*") },
    inventory.hallOfFame, "Archive verification failed after Auth removal.");
  console.log(`PASS: ${deleted} test Auth accounts removed; retained administrator and archived standings verified.`);
} else if (command === "export") {
  const directory = path.resolve(`.local/prelaunch-2027/export-${Date.now()}`);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const exported = {};
  const tables = {
    profiles: "id", drivers: "id", league_seasons: "id", season_participants: "season_id,profile_id",
    races: "id", picks: "id", results: "id", race_driver_groups: "race_id,driver_id",
    pick_submission_versions: "id", pick_reminders: "id", feedback_items: "id", season_restore_points: "id",
    hall_of_fame_seasons: "id", hall_of_fame_entries: "id", admin_audit_events: "id", app_error_events: "id",
    job_runs: "id", job_status: "job_name"
  };
  for (const [table, order] of Object.entries(tables)) {
    const chunks = [];
    let count = 0;
    for (let offset = 0; ; offset += 500) {
      const url = new URL(`/rest/v1/${table}`, process.env.NEXT_PUBLIC_SUPABASE_URL);
      url.search = new URLSearchParams({ select: "*", order, offset: String(offset), limit: "500" }).toString();
      const response = await fetch(url, {
        headers: { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}` },
        signal: AbortSignal.timeout(20_000)
      });
      assert.ok(response.ok, `Export ${table} failed (HTTP ${response.status}).`);
      // Preserve REST's numeric literals, including trailing decimal digits.
      const raw = (await response.text()).trim();
      const page = JSON.parse(raw);
      assert.ok(Array.isArray(page), `Export ${table} did not return rows.`);
      count += page.length;
      if (page.length) chunks.push(raw.slice(1, -1));
      if (page.length < 500) break;
    }
    const contents = `[${chunks.join(",")} ]\n`;
    fs.writeFileSync(path.join(directory, `${table}.json`), contents, { flag: "wx", mode: 0o600 });
    exported[table] = { count, sha256: createHash("sha256").update(contents).digest("hex") };
  }
  fs.writeFileSync(path.join(directory, "manifest.json"), JSON.stringify({
    capturedAt: new Date().toISOString(), keeperId, tables: exported,
    limitations: "Application data export only. No Auth credentials/accounts, invite hashes, configuration secrets, or image binaries. Not an app Recovery upload or a transactionally consistent project backup."
  }, null, 2), { flag: "wx", mode: 0o600 });
  console.log(JSON.stringify({ savedTo: directory, tables: exported }, null, 2));
} else {
  const tables = ["profiles", "league_seasons", "season_participants", "drivers", "races", "picks", "results",
    "race_driver_groups", "pick_submission_versions", "pick_reminders", "feedback_items", "season_restore_points",
    "hall_of_fame_seasons", "hall_of_fame_entries", "admin_audit_events", "app_error_events", "job_runs", "job_status",
    "registration_attempt_limits"];
  const counts = {};
  // Bounded concurrency: avoid hitting every endpoint simultaneously.
  for (let offset = 0; offset < tables.length; offset += 4) {
    const batch = await Promise.all(tables.slice(offset, offset + 4).map(async (table) => {
      const { count } = await checked(`Count ${table}`, supabase.from(table).select("*", { count: "exact", head: true }));
      return [table, count];
    }));
    Object.assign(counts, Object.fromEntries(batch));
  }
  const [users, profiles, seasons, races, snapshots, hallSeasons, hallEntries] = await Promise.all([
    authIds(), rows("profiles", "id,role,is_active"),
    rows("league_seasons", "id,season_year,status,registration_code_configured_at,roster_configured_at"),
    rows("races", "id,season_id,results_status,is_archived,title_image_url"),
    rows("season_restore_points", "id,season_id,season_year,source,created_by,snapshot_bytes"),
    rows("hall_of_fame_seasons", "*"), rows("hall_of_fame_entries", "*")
  ]);
  const projectFingerprint = createHash("sha256").update(process.env.NEXT_PUBLIC_SUPABASE_URL).digest("hex");
  const report = {
    capturedAt: new Date().toISOString(), projectFingerprint, keeperId,
    keeper: { ...keeper, emailConfirmed: Boolean(keeperAuth.user.email_confirmed_at) },
    counts: { authUsers: users.length, ...counts },
    authUserIds: users, profiles, seasons, races, snapshots,
    hallOfFame: { seasons: hallSeasons, entries: hallEntries }
  };
  const directory = path.resolve(".local/prelaunch-2027");
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const filename = path.join(directory, `inventory-${Date.now()}.json`);
  fs.writeFileSync(filename, `${JSON.stringify(report, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  console.log(JSON.stringify({
    savedTo: filename, keeper: report.keeper, counts: report.counts,
    authAccountsWithoutProfiles: users.filter((id) => !profiles.some((profile) => profile.id === id)).length,
    seasons: seasons.map((season) => ({ ...season, raceCount: races.filter((race) => race.season_id === season.id).length })),
    hallOfFame: hallSeasons.map((season) => ({ year: season.season_year, entries: hallEntries.filter((entry) => entry.season_id === season.id).length })),
    snapshotBytes: snapshots.reduce((total, snapshot) => total + Number(snapshot.snapshot_bytes), 0)
  }, null, 2));
}
