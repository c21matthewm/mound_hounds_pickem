import "server-only";

import { reportAppError } from "@/lib/app-error-reporter";
import { serializeJson } from "@/lib/supabase/json";
import type { AppSupabaseClient } from "@/lib/supabase/types";

export type AdminAuditEvent = {
  action: string;
  afterState?: Record<string, unknown> | null;
  beforeState?: Record<string, unknown> | null;
  entityId: string;
  entityType: string;
  summary: string;
};

export const recordAdminAudit = async (
  supabase: AppSupabaseClient,
  event: AdminAuditEvent
): Promise<void> => {
  const { error } = await supabase.rpc("write_admin_audit_event", {
    p_action: event.action,
    p_after_state: event.afterState ? serializeJson(event.afterState) : null,
    p_before_state: event.beforeState ? serializeJson(event.beforeState) : null,
    p_entity_id: event.entityId,
    p_entity_type: event.entityType,
    p_summary: event.summary
  });

  if (error) {
    console.error("[audit] Failed recording admin event:", error.message);
    await reportAppError({
      code: "write-admin-audit-failed",
      context: {
        entityId: event.entityId,
        entityType: event.entityType,
        operation: event.action
      },
      error,
      route: "/admin",
      severity: "warning",
      subsystem: "admin-audit"
    });
  }
};
