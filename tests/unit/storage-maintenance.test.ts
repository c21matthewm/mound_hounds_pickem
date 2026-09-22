import { describe, expect, it, vi } from "vitest";
import { auditOrphanedStorageImages } from "@/lib/storage-maintenance";
import type { AppSupabaseClient } from "@/lib/supabase/types";

vi.mock("server-only", () => ({}));

const ORIGIN = "https://example.supabase.co";
const image = (path: string, bucket = "driver-headshots") => `${ORIGIN}/storage/v1/object/public/${bucket}/${path}`;
const file = (name: string, bytes: number | null = 1024) => ({ id: `object-${name}`, name, metadata: bytes === null ? {} : { size: bytes } });
const directory = (name: string) => ({ id: null, name, metadata: null });
type Row = Record<string, unknown>;
type Fixture = {
  tables?: Record<string, Row[]>;
  media?: Row[];
  storage?: Record<string, Record<string, ReturnType<typeof file | typeof directory>[]>>;
  queryCap?: number;
  storageCap?: number;
  queryOverride?: (table: string, selection: string, from: number) => unknown;
};

function fixture(options: Fixture = {}) {
  const selections: string[] = [];
  const remove = vi.fn();
  const list = vi.fn(async (bucket: string, prefix: string, offset: number, limit: number) => ({
    data: (options.storage?.[bucket]?.[prefix] ?? []).slice(offset, offset + Math.min(limit, options.storageCap ?? limit)), error: null
  }));
  const client = {
    from: (table: string) => {
      let selection = "";
      let from = 0;
      let to = 0;
      let includeIds: unknown[] | null = null;
      const query = {
        select: (value: string) => { selection = value; selections.push(value); return query; },
        order: () => query,
        in: (_column: string, ids: unknown[]) => { includeIds = ids; return query; },
        range: (start: number, end: number) => { from = start; to = end; return query; },
        abortSignal: async () => {
          const override = options.queryOverride?.(table, selection, from);
          if (override !== undefined) return override;
          const rows = (selection.includes("driver_media:") ? options.media ?? [] : options.tables?.[table] ?? [])
            .filter((row) => includeIds === null || includeIds.includes(row.id));
          return { data: rows.slice(from, Math.min(to + 1, from + (options.queryCap ?? 200))), error: null, count: rows.length };
        }
      };
      return query;
    },
    storage: { from: (bucket: string) => ({ list: (prefix: string, { offset, limit }: { offset: number; limit: number }) => list(bucket, prefix, offset, limit), remove }) }
  } as unknown as AppSupabaseClient;
  return { client, list, remove, selections };
}

describe("storage media audit", () => {
  it("distinguishes current, recovery-only, missing references and unreferenced media across both buckets", async () => {
    const source = fixture({
      tables: {
        drivers: [ { id: 1, image_url: image("drivers/current.webp") }, { id: 2, image_url: image("drivers/missing.webp") }, { id: 3, image_url: "https://other.example/storage/v1/object/public/driver-headshots/drivers/unused.webp" } ],
        races: [{ id: 1, title_image_url: image("races/current.webp", "race-title-images") }],
        season_restore_points: [{ id: "backup-1", snapshot_bytes: 100, format_version: 1, checksum: "abc" }]
      },
      media: [{ id: "backup-1", checksum: "abc", driver_media: [{ image_url: image("drivers/recovery.webp") }], race_media: [{ title_image_url: image("races/old.webp", "race-title-images") }] }],
      storage: {
        "driver-headshots": { "": [directory("drivers")], drivers: [file("current.webp"), file("recovery.webp"), file("unused.webp", 8192)] },
        "race-title-images": { "": [directory("races")], races: [file("current.webp"), file("old.webp"), file("unused.webp", null)] }
      }
    });
    const result = await auditOrphanedStorageImages(source.client, ORIGIN);
    expect(result.restorePointCount).toBe(1);
    expect(result.buckets[0]).toMatchObject({ storedCount: 3, currentReferenceCount: 1, recoveryOnlyCount: 1, missingReferenceCount: 1, unreferencedCount: 1, unreferencedBytes: 8192, candidates: [{ path: "drivers/unused.webp", bytes: 8192 }] });
    expect(result.buckets[1]).toMatchObject({ currentReferenceCount: 1, recoveryOnlyCount: 1, unreferencedCount: 1, unknownSizeCount: 1 });
    expect(source.selections.some((selection) => selection.includes("driver_media:snapshot->drivers"))).toBe(true);
    expect(source.selections).not.toContain("snapshot");
    expect(source.remove).not.toHaveBeenCalled();
  });

  it("follows server-capped reference and storage pages until all rows have been checked", async () => {
    const source = fixture({
      queryCap: 3, storageCap: 2,
      tables: { drivers: Array.from({ length: 7 }, (_, id) => ({ id, image_url: image(`image-${id}.webp`) })) },
      storage: { "driver-headshots": { "": Array.from({ length: 8 }, (_, id) => file(`image-${id}.webp`)) } }
    });
    const result = await auditOrphanedStorageImages(source.client, ORIGIN);
    expect(result.buckets[0]).toMatchObject({ storedCount: 8, currentReferenceCount: 7, unreferencedCount: 1, candidates: [{ path: "image-7.webp", bytes: 1024 }] });
    expect(source.list).toHaveBeenCalledWith("driver-headshots", "", 8, 200);
  });

  it("recognizes encoded and transformed references even when the URL is in the other image column", async () => {
    const source = fixture({
      tables: { drivers: [{ id: 1, image_url: `${ORIGIN}/storage/v1/render/image/public/race-title-images/race%20photo.webp?width=100` }] },
      storage: { "race-title-images": { "": [file("race photo.webp")] } }
    });
    expect((await auditOrphanedStorageImages(source.client, ORIGIN)).buckets[1].unreferencedCount).toBe(0);
  });

  it.each([
    { data: null, error: null, count: 0 },
    { data: [], error: { message: "database failed" }, count: 0 },
    { data: [], error: null, count: null },
    { data: [], error: null, count: 5 },
    { data: [], error: null, count: 10_001 },
    { data: [{ id: 1 }, { id: 1 }], error: null, count: 2 }
  ])("rejects incomplete, failed, unbounded, or repeated reference rows (%j)", async (page) => {
    const source = fixture({ queryOverride: () => page });
    await expect(auditOrphanedStorageImages(source.client, ORIGIN)).rejects.toThrow();
    expect(source.list).not.toHaveBeenCalled();
    expect(source.remove).not.toHaveBeenCalled();
  });

  it("refuses a changing exact reference count", async () => {
    const source = fixture({ queryOverride: (_table, _selection, from) => ({ data: [{ id: from }], error: null, count: from === 0 ? 2 : 3 }) });
    await expect(auditOrphanedStorageImages(source.client, ORIGIN)).rejects.toThrow("changed");
  });

  it.each([
    { format_version: 2, snapshot_bytes: 100 },
    { format_version: 1, snapshot_bytes: 6 * 1024 * 1024 },
    { format_version: 1, snapshot_bytes: 0 }
  ])("checks snapshot format and size before fetching recovery media (%j)", async (metadata) => {
    const source = fixture({ tables: { season_restore_points: [{ id: "point", checksum: "abc", ...metadata }] } });
    await expect(auditOrphanedStorageImages(source.client, ORIGIN)).rejects.toThrow("unsupported format");
    expect(source.selections.some((selection) => selection.includes("driver_media:"))).toBe(false);
    expect(source.list).not.toHaveBeenCalled();
  });

  it.each([
    { media: [] },
    { media: [{ id: "point", checksum: "changed", driver_media: [], race_media: [] }] },
    { media: [{ id: "point", checksum: "abc", driver_media: null, race_media: [] }] }
  ])("rejects unreadable or changing recovery data instead of marking its files unreferenced (%j)", async ({ media }) => {
    const source = fixture({ tables: { season_restore_points: [{ id: "point", checksum: "abc", snapshot_bytes: 100, format_version: 1 }] }, media });
    await expect(auditOrphanedStorageImages(source.client, ORIGIN)).rejects.toThrow();
    expect(source.list).not.toHaveBeenCalled();
  });

  it("does not return a partial report if one bucket listing fails", async () => {
    const source = fixture({ storage: { "driver-headshots": { "": [file("unused.webp")] } } });
    source.list.mockRejectedValueOnce(new Error("Storage unavailable"));
    await expect(auditOrphanedStorageImages(source.client, ORIGIN)).rejects.toThrow("Storage unavailable");
    expect(source.remove).not.toHaveBeenCalled();
  });

  it("bounds a storage server that repeats a nonempty page", async () => {
    const source = fixture();
    source.list.mockResolvedValue({ data: [file("repeated.webp")], error: null });
    await expect(auditOrphanedStorageImages(source.client, ORIGIN)).rejects.toThrow("changed");
    expect(source.list).toHaveBeenCalledTimes(2);
  });

  it("bounds filename previews without undercounting files or bytes", async () => {
    const source = fixture({ storage: { "driver-headshots": { "": Array.from({ length: 105 }, (_, index) => file(`photo-${index}.webp`)) } } });
    const result = await auditOrphanedStorageImages(source.client, ORIGIN);
    expect(result.buckets[0]).toMatchObject({ unreferencedCount: 105, unreferencedBytes: 105 * 1024 });
    expect(result.buckets[0].candidates).toHaveLength(100);
  });
});
