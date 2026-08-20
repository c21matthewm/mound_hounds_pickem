import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

export type AdminAuditEvent = {
  action: string;
  afterState?: Record<string, unknown> | null;
  beforeState?: Record<string, unknown> | null;
  entityId: string;
  entityType: string;
  summary: string;
};

export const recordAdminAudit = async (
  supabase: SupabaseClient,
  event: AdminAuditEvent
): Promise<void> => {
  const { error } = await supabase.rpc("write_admin_audit_event", {
    p_action: event.action,
    p_after_state: event.afterState ?? null,
    p_before_state: event.beforeState ?? null,
    p_entity_id: event.entityId,
    p_entity_type: event.entityType,
    p_summary: event.summary
  });

  if (error) {
    console.error("[audit] Failed recording admin event:", error.message);
  }
};
