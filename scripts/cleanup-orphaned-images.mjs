import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const apply = process.argv.includes("--apply");

const readEnvFromFile = (key) => {
  const envPath = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return null;

  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const splitIndex = trimmed.indexOf("=");
    if (splitIndex <= 0 || trimmed.slice(0, splitIndex).trim() !== key) continue;
    return trimmed.slice(splitIndex + 1).trim().replace(/^['"]|['"]$/g, "");
  }

  return null;
};

const requiredEnv = (key) => {
  const value = process.env[key]?.trim() || readEnvFromFile(key)?.trim();
  if (!value) throw new Error(`Missing required env var: ${key}`);
  return value;
};

const supabaseUrl = requiredEnv("NEXT_PUBLIC_SUPABASE_URL");

// This maintenance script only uses REST and Storage APIs. Supplying a no-op
// transport avoids requiring Node's WebSocket implementation on older dev machines.
class UnusedWebSocketTransport {}

const supabase = createClient(supabaseUrl, requiredEnv("SUPABASE_SERVICE_ROLE_KEY"), {
  auth: { autoRefreshToken: false, persistSession: false },
  realtime: { transport: UnusedWebSocketTransport }
});

const managedPathFromUrl = (bucket, publicUrl) => {
  if (!publicUrl) return null;
  try {
    const candidate = new URL(publicUrl);
    if (candidate.host !== new URL(supabaseUrl).host) return null;
    const marker = `/storage/v1/object/public/${bucket}/`;
    const index = candidate.pathname.indexOf(marker);
    return index < 0 ? null : decodeURIComponent(candidate.pathname.slice(index + marker.length));
  } catch {
    return null;
  }
};

const listFiles = async (bucket, prefix) => {
  const files = [];
  const directories = [prefix];

  while (directories.length > 0) {
    const directory = directories.shift();
    let offset = 0;

    while (true) {
      const { data, error } = await supabase.storage.from(bucket).list(directory, {
        limit: 1000,
        offset,
        sortBy: { column: "name", order: "asc" }
      });
      if (error) throw new Error(`Failed listing ${bucket}/${directory}: ${error.message}`);

      const rows = data ?? [];
      for (const row of rows) {
        const objectPath = directory ? `${directory}/${row.name}` : row.name;
        if (row.id) files.push(objectPath);
        else directories.push(objectPath);
      }

      if (rows.length < 1000) break;
      offset += rows.length;
    }
  }

  return files;
};

const cleanupBucket = async ({ bucket, column, prefix, table }) => {
  const { data, error } = await supabase.from(table).select(column);
  if (error) throw new Error(`Failed reading ${table}.${column}: ${error.message}`);

  const referenced = new Set(
    (data ?? [])
      .map((row) => managedPathFromUrl(bucket, row[column]))
      .filter((value) => typeof value === "string" && value.length > 0)
  );
  const stored = await listFiles(bucket, prefix);
  const orphaned = stored.filter((objectPath) => !referenced.has(objectPath));

  console.log(`${bucket}: ${stored.length} stored, ${referenced.size} referenced, ${orphaned.length} orphaned`);
  orphaned.forEach((objectPath) => console.log(`  ${apply ? "DELETE" : "DRY RUN"} ${objectPath}`));

  if (apply && orphaned.length > 0) {
    for (let index = 0; index < orphaned.length; index += 100) {
      const { error: removeError } = await supabase.storage
        .from(bucket)
        .remove(orphaned.slice(index, index + 100));
      if (removeError) throw new Error(`Failed deleting from ${bucket}: ${removeError.message}`);
    }
  }

  return orphaned.length;
};

const driverOrphans = await cleanupBucket({
  bucket: "driver-headshots",
  column: "image_url",
  prefix: "drivers",
  table: "drivers"
});
const raceOrphans = await cleanupBucket({
  bucket: "race-title-images",
  column: "title_image_url",
  prefix: "races",
  table: "races"
});

console.log(
  `${apply ? "Removed" : "Found"} ${driverOrphans + raceOrphans} orphaned managed image(s).${
    apply ? "" : " Run again with --apply to delete only the listed objects."
  }`
);
