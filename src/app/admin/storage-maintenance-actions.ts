"use server";

import { requireAdmin } from "@/lib/admin";
import { errorReference, reportAppError } from "@/lib/app-error-reporter";
import { auditOrphanedStorageImages, type StorageMediaAudit } from "@/lib/storage-maintenance";
import { getSupabaseEnv } from "@/lib/supabase/env";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/service-role";

export type StorageMediaAuditState = {
  audit: StorageMediaAudit | null;
  error: string | null;
};

export async function auditStorageImagesAction(): Promise<StorageMediaAuditState> {
  // Authorize before constructing a service client. Never accept client bucket
  // names, object paths, or claimed audit results as input to privileged reads.
  const { user } = await requireAdmin();
  try {
    const audit = await auditOrphanedStorageImages(createServiceRoleSupabaseClient(), getSupabaseEnv().url);
    return { audit, error: null };
  } catch (error) {
    const reported = await reportAppError({
      actorProfileId: user.id,
      code: "storage-media-audit-failed",
      context: { operation: "audit_media" },
      error,
      route: "/admin?tab=drivers",
      severity: "warning",
      subsystem: "storage"
    });
    return {
      audit: null,
      error: `The storage audit could not finish. No files were changed. Try again; if it continues, check System Health for details.${errorReference(reported)}`
    };
  }
}
