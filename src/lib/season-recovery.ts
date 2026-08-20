export const SEASON_RECOVERY_MIGRATION_FILE =
  "supabase/migrations/20260818_bound_recovery_jobs_and_registration.sql";

export const SEASON_BACKUP_FORMAT = "mound-hounds-season-backup";
export const SEASON_BACKUP_FORMAT_VERSION = 1;

export type SeasonRecoveryRowCounts = Record<string, number>;

export type SeasonRestorePointSummary = {
  checksum: string;
  created_at: string;
  format_version: number;
  id: string;
  label: string;
  row_counts: SeasonRecoveryRowCounts;
  schema_version: string;
  season_id: number;
  season_year: number;
  snapshot_bytes: number;
  retention_key: string | null;
  source:
    | "automatic"
    | "result_checkpoint"
    | "pre_correction"
    | "pre_rollover"
    | "manual"
    | "pre_restore"
    | "uploaded";
};

export type SeasonRestoreDifference = {
  backupCount: number;
  currentCount: number;
  differentRows: number;
};

export type SeasonRestorePreview = {
  checksum: string;
  createdAt: string;
  differences: Record<string, SeasonRestoreDifference>;
  formatVersion: number;
  id: string;
  label: string;
  schemaVersion: string;
  seasonId: number;
  seasonYear: number;
  source: SeasonRestorePointSummary["source"];
};

const safeFilenamePart = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);

export const seasonBackupFilename = ({
  createdAt,
  label,
  seasonYear
}: {
  createdAt: string;
  label: string;
  seasonYear: number;
}): string => {
  const datePart = Number.isNaN(Date.parse(createdAt))
    ? "undated"
    : new Date(createdAt).toISOString().replace(/[:.]/g, "-");
  const labelPart = safeFilenamePart(label) || "backup";

  return `mound-hounds-${seasonYear}-${labelPart}-${datePart}.json`;
};
