export const RECOVERY_RETENTION_MIGRATION_FILE =
  "supabase/migrations/20260930_recovery_retention.sql";
export const MANUAL_BACKUP_PROTECTION_KEY = "manual:protected";

export type RecoveryRetention = {
  seasonId: number;
  seasonYear: number;
  routineLimit: number;
  totalCount: number;
  totalBytes: number;
  routineCount: number;
  protectedCount: number;
  cleanupCount: number;
  cleanupBytes: number;
  reviewToken: string;
};
export type RecoveryCleanupResult = {
  deletedCount: number;
  deletedBytes: number;
  retention: RecoveryRetention;
};
export type RecoveryProtectionResult = {
  id: string;
  protected: boolean;
  retentionKey: string | null;
  retention: RecoveryRetention;
};

const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
const count = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
export const isRestorePointId = (value: unknown): value is string =>
  typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
export const isRetentionReviewToken = (value: unknown): value is string =>
  typeof value === "string" && /^[0-9a-f]{64}$/i.test(value);

export function parseRecoveryRetention(value: unknown): RecoveryRetention | null {
  const data = record(value);
  if (!data || !count(data.seasonId) || data.seasonId === 0 ||
    !count(data.seasonYear) || data.seasonYear < 2000 || data.seasonYear > 2100 ||
    data.routineLimit !== 3 || !isRetentionReviewToken(data.reviewToken) ||
    ![data.totalCount, data.totalBytes, data.routineCount, data.protectedCount,
      data.cleanupCount, data.cleanupBytes].every(count)) return null;
  const totalCount = data.totalCount as number;
  const routineCount = data.routineCount as number;
  const protectedCount = data.protectedCount as number;
  const cleanupCount = data.cleanupCount as number;
  const totalBytes = data.totalBytes as number;
  const cleanupBytes = data.cleanupBytes as number;
  if (routineCount + protectedCount !== totalCount ||
    cleanupCount !== Math.max(0, routineCount - 3) || cleanupBytes > totalBytes) return null;
  return {
    seasonId: data.seasonId, seasonYear: data.seasonYear, routineLimit: 3,
    totalCount, totalBytes, routineCount, protectedCount, cleanupCount, cleanupBytes,
    reviewToken: data.reviewToken
  };
}
export function parseRecoveryCleanupResult(value: unknown): RecoveryCleanupResult | null {
  const data = record(value);
  if (!data || !count(data.deletedCount) || !count(data.deletedBytes)) return null;
  const retention = parseRecoveryRetention(data.retention);
  return retention ? { deletedCount: data.deletedCount, deletedBytes: data.deletedBytes, retention } : null;
}
export function parseRecoveryProtectionResult(value: unknown): RecoveryProtectionResult | null {
  const data = record(value);
  if (!data || !isRestorePointId(data.id) || typeof data.protected !== "boolean" ||
    (data.protected ? typeof data.retentionKey !== "string" || !data.retentionKey : data.retentionKey !== null)) return null;
  const retention = parseRecoveryRetention(data.retention);
  return retention ? {
    id: data.id, protected: data.protected,
    retentionKey: data.retentionKey as string | null, retention
  } : null;
}
export function formatRecoveryBytes(bytes: number): string {
  return bytes < 1024 * 1024
    ? `${Math.max(0, bytes / 1024).toFixed(1)} KB`
    : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
