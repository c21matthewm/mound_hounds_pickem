import "server-only";

import type { AppSupabaseClient } from "@/lib/supabase/types";

const BUCKETS = ["driver-headshots", "race-title-images"] as const;
type MediaBucket = (typeof BUCKETS)[number];
const PAGE_SIZE = 200;
const MAX_REFERENCE_ROWS = 10_000;
const MAX_RESTORE_POINTS = 2_000;
const MAX_SNAPSHOT_BYTES = 5 * 1024 * 1024;
const MAX_TOTAL_SNAPSHOT_BYTES = 50 * 1024 * 1024;
const MAX_STORAGE_ROWS = 10_000;
const MAX_STORAGE_REQUESTS = 200;
const MAX_STORAGE_DEPTH = 8;
const PREVIEW_LIMIT = 100;
const AUDIT_TIMEOUT_MS = 20_000;

export type StorageMediaCandidate = { path: string; bytes: number | null };
export type StorageMediaBucketAudit = {
  bucket: MediaBucket;
  storedCount: number;
  currentReferenceCount: number;
  recoveryOnlyCount: number;
  missingReferenceCount: number;
  unreferencedCount: number;
  unreferencedBytes: number;
  unknownSizeCount: number;
  candidates: StorageMediaCandidate[];
};
export type StorageMediaAudit = {
  completedAt: string;
  restorePointCount: number;
  buckets: StorageMediaBucketAudit[];
};

type CountedPage<T> = { data: T[] | null; error: unknown; count: number | null };
type Identified = { id: string | number };

// Exact counts, stable ordering, unique ids, and hard limits prevent a truncated
// API page from silently turning a referenced file into an audit candidate.
async function readCountedRows<T extends Identified>(
  loadPage: (from: number, to: number) => PromiseLike<CountedPage<T>>,
  maximum: number
): Promise<T[]> {
  const rows: T[] = [];
  const ids = new Set<string | number>();
  let expectedCount: number | null = null;
  for (;;) {
    const page = await loadPage(rows.length, rows.length + PAGE_SIZE - 1);
    if (page.error || !Array.isArray(page.data) || page.count === null ||
      !Number.isSafeInteger(page.count) || page.count < 0) {
      throw new Error("The media reference query did not return a complete counted page.");
    }
    if (page.count > maximum) throw new Error("The media reference audit exceeded its row limit.");
    if (expectedCount !== null && page.count !== expectedCount) {
      throw new Error("Media references changed during the audit. Run a fresh audit.");
    }
    expectedCount = page.count;
    for (const row of page.data) {
      if (row.id === undefined || row.id === null || ids.has(row.id)) {
        throw new Error("The media reference query returned missing or repeated row ids.");
      }
      ids.add(row.id);
      rows.push(row);
    }
    if (rows.length > expectedCount || rows.length > maximum || page.data.length > PAGE_SIZE) {
      throw new Error("The media reference query returned an inconsistent row count.");
    }
    if (rows.length === expectedCount) return rows;
    if (page.data.length === 0) throw new Error("The media reference query stopped before all rows were read.");
  }
}

const validateObjectPath = (path: string): void => {
  if (!path || path.length > 1024 || /[\\\u0000-\u001f\u007f]/.test(path) ||
    path.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new Error("A managed image contains an invalid object path.");
  }
};

function mediaReference(value: unknown, origin: string): { bucket: MediaBucket; path: string } | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") throw new Error("An image reference has an unexpected format.");
  let url: URL;
  try { url = new URL(value); } catch { return null; }
  if (url.origin !== origin) return null;
  for (const bucket of BUCKETS) {
    for (const operation of ["object/public", "object/sign", "object/authenticated", "render/image/public", "render/image/sign", "render/image/authenticated"]) {
      const prefix = `/storage/v1/${operation}/${bucket}/`;
      if (!url.pathname.startsWith(prefix)) continue;
      const path = decodeURIComponent(url.pathname.slice(prefix.length));
      validateObjectPath(path);
      return { bucket, path };
    }
  }
  return null;
}

type ReferenceSets = Record<MediaBucket, Set<string>>;
const emptyReferences = (): ReferenceSets => ({ "driver-headshots": new Set(), "race-title-images": new Set() });
const addReference = (sets: ReferenceSets, value: unknown, origin: string) => {
  const reference = mediaReference(value, origin);
  if (reference) sets[reference.bucket].add(reference.path);
};

function readRecoveryMedia(value: unknown, column: "image_url" | "title_image_url", references: ReferenceSets, origin: string) {
  if (!Array.isArray(value) || value.length > MAX_REFERENCE_ROWS) {
    throw new Error("A recovery snapshot has missing or unsupported media records.");
  }
  for (const row of value) {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      throw new Error("A recovery snapshot contains an invalid media record.");
    }
    // Older snapshots can legitimately predate optional image columns.
    addReference(references, (row as Record<string, unknown>)[column], origin);
  }
}

async function listBucketFiles(service: AppSupabaseClient, bucket: MediaBucket, signal: AbortSignal): Promise<StorageMediaCandidate[]> {
  const directories = [{ prefix: "", depth: 0 }];
  const visited = new Set<string>();
  const objects = new Set<string>();
  const files: StorageMediaCandidate[] = [];
  let rowCount = 0;
  let requestCount = 0;

  for (let directoryIndex = 0; directoryIndex < directories.length; directoryIndex += 1) {
    const directory = directories[directoryIndex];
    if (directory.depth > MAX_STORAGE_DEPTH || visited.has(directory.prefix)) {
      throw new Error("The storage listing exceeded its directory limits.");
    }
    visited.add(directory.prefix);
    let offset = 0;
    for (;;) {
      if (++requestCount > MAX_STORAGE_REQUESTS) throw new Error("The storage audit exceeded its request limit.");
      const { data, error } = await service.storage.from(bucket).list(directory.prefix, {
        limit: PAGE_SIZE, offset, sortBy: { column: "name", order: "asc" }
      }, { signal });
      if (error || !Array.isArray(data) || data.length > PAGE_SIZE) {
        throw new Error("A media bucket could not be fully listed.");
      }
      // Read through an empty page even after a short page: a server-side cap
      // smaller than PAGE_SIZE must not hide files in the remainder.
      if (data.length === 0) break;
      offset += data.length;
      rowCount += data.length;
      if (rowCount > MAX_STORAGE_ROWS) throw new Error("The storage audit exceeded its file limit.");
      for (const row of data) {
        if (!row.name || row.name.includes("/")) throw new Error("Storage returned an invalid file name.");
        const path = directory.prefix ? `${directory.prefix}/${row.name}` : row.name;
        validateObjectPath(path);
        if (objects.has(path)) throw new Error("Storage changed during the audit. Run a fresh audit.");
        objects.add(path);
        if (row.id === null) {
          directories.push({ prefix: path, depth: directory.depth + 1 });
        } else if (typeof row.id === "string" && row.id) {
          const size: unknown = row.metadata?.size;
          files.push({ path, bytes: typeof size === "number" && Number.isSafeInteger(size) && size >= 0 ? size : null });
        } else {
          throw new Error("Storage returned an unrecognized file or directory.");
        }
      }
    }
  }
  return files;
}

/**
 * Read-only inventory, never a deletion authorization. Storage uploads, URL
 * edits, and recovery restores do not currently share a lock with this scan.
 * A second scan cannot make a subsequent Storage.remove atomic with those
 * writes, so this module deliberately exposes no purge operation.
 */
export async function auditOrphanedStorageImages(service: AppSupabaseClient, supabaseUrl: string): Promise<StorageMediaAudit> {
  const origin = new URL(supabaseUrl).origin;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), AUDIT_TIMEOUT_MS);
  const signal = controller.signal;
  try {
    const current = emptyReferences();
    const recovery = emptyReferences();
    const drivers = await readCountedRows((from, to) => service.from("drivers")
      .select("id,image_url", { count: "exact" }).order("id").range(from, to).abortSignal(signal), MAX_REFERENCE_ROWS);
    const races = await readCountedRows((from, to) => service.from("races")
      .select("id,title_image_url", { count: "exact" }).order("id").range(from, to).abortSignal(signal), MAX_REFERENCE_ROWS);
    drivers.forEach((row) => addReference(current, row.image_url, origin));
    races.forEach((row) => addReference(current, row.title_image_url, origin));

    // Inspect sizes before fetching recovery data; project only media-bearing
    // rows so participant profiles and picks never enter this audit response.
    const points = await readCountedRows((from, to) => service.from("season_restore_points")
      .select("id,snapshot_bytes,format_version,checksum", { count: "exact" })
      .order("id").range(from, to).abortSignal(signal), MAX_RESTORE_POINTS);
    let snapshotBytes = 0;
    for (const point of points) {
      if (point.format_version !== 1 || !Number.isSafeInteger(point.snapshot_bytes) ||
        point.snapshot_bytes <= 0 || point.snapshot_bytes > MAX_SNAPSHOT_BYTES) {
        throw new Error("A recovery snapshot is too large or has an unsupported format for this audit.");
      }
      snapshotBytes += point.snapshot_bytes;
      if (snapshotBytes > MAX_TOTAL_SNAPSHOT_BYTES) throw new Error("Recovery media exceeded the audit size limit.");
    }
    for (let start = 0; start < points.length; start += 25) {
      const batch = points.slice(start, start + 25);
      const expected = new Map(batch.map((point) => [point.id, point.checksum]));
      const mediaRows = await readCountedRows((from, to) => service.from("season_restore_points")
        .select("id,checksum,driver_media:snapshot->drivers,race_media:snapshot->races", { count: "exact" })
        .in("id", batch.map((point) => point.id)).order("id").range(from, to).abortSignal(signal), batch.length);
      if (mediaRows.length !== batch.length) {
        throw new Error("A recovery snapshot changed or could not be read. Run a fresh audit.");
      }
      for (const row of mediaRows) {
        if (!expected.has(row.id) || row.checksum !== expected.get(row.id)) {
          throw new Error("A recovery snapshot changed or could not be read. Run a fresh audit.");
        }
        readRecoveryMedia(row.driver_media, "image_url", recovery, origin);
        readRecoveryMedia(row.race_media, "title_image_url", recovery, origin);
      }
    }

    const buckets: StorageMediaBucketAudit[] = [];
    for (const bucket of BUCKETS) {
      const files = await listBucketFiles(service, bucket, signal);
      const stored = new Set(files.map((file) => file.path));
      const unreferenced = files.filter((file) => !current[bucket].has(file.path) && !recovery[bucket].has(file.path));
      const referenced = new Set([...current[bucket], ...recovery[bucket]]);
      buckets.push({
        bucket,
        storedCount: files.length,
        currentReferenceCount: files.filter((file) => current[bucket].has(file.path)).length,
        recoveryOnlyCount: files.filter((file) => !current[bucket].has(file.path) && recovery[bucket].has(file.path)).length,
        missingReferenceCount: [...referenced].filter((path) => !stored.has(path)).length,
        unreferencedCount: unreferenced.length,
        unreferencedBytes: unreferenced.reduce((total, file) => total + (file.bytes ?? 0), 0),
        unknownSizeCount: unreferenced.filter((file) => file.bytes === null).length,
        candidates: unreferenced.slice(0, PREVIEW_LIMIT)
      });
    }
    return { completedAt: new Date().toISOString(), restorePointCount: points.length, buckets };
  } finally {
    clearTimeout(timeout);
  }
}
