import "server-only";
import type { AppSupabaseClient } from "@/lib/supabase/types";
import { ADMIN_AUDIT_PAGE_SIZE, adminAuditStatePreview, escapeAdminAuditSearch, type AdminAuditLogData, type AdminAuditQuery } from "@/lib/admin-audit-log";

// Call only after requireAdmin(), with its authenticated client. RLS additionally limits
// audit reads to administrators. No service-role client, totals, offsets, or JSON in lists.
export async function loadAdminAuditLog(supabase: AppSupabaseClient, query: AdminAuditQuery): Promise<AdminAuditLogData> {
  const result: AdminAuditLogData = {query,rows:[],hasOlder:false,hasNewer:false,detail:null,error:null,detailError:null};
  const signal = AbortSignal.timeout(8000);
  try {
    let request = supabase.from("admin_audit_events")
      .select("id,action,entity_type,entity_id,summary,created_at")
      .order("id", { ascending: query.after !== null })
      .limit(ADMIN_AUDIT_PAGE_SIZE + 1).abortSignal(signal);
    if (query.search) request = request.regexIMatch("summary", escapeAdminAuditSearch(query.search));
    if (query.action) request = request.eq("action", query.action);
    if (query.entity) request = request.eq("entity_type", query.entity);
    if (query.before) request = request.lt("id", query.before);
    if (query.after) request = request.gt("id", query.after);
    const response = await request;
    if (response.error) throw response.error;
    const data = response.data ?? [];
    const more = data.length > ADMIN_AUDIT_PAGE_SIZE;
    const page = data.slice(0, ADMIN_AUDIT_PAGE_SIZE);
    result.rows = query.after ? page.reverse() : page;
    result.hasOlder = query.after !== null ? result.rows.length > 0 : more;
    result.hasNewer = query.after !== null ? more : query.before !== null && result.rows.length > 0;
  } catch {
    result.error = "The admin audit log could not be loaded. Try again; other diagnostics remain available.";
    return result;
  }
  if (query.detail !== null && result.rows.some((row) => row.id === query.detail)) {
    try {
      const response = await supabase.from("admin_audit_events")
        .select("id,actor_profile_id,before_state,after_state").eq("id", query.detail).abortSignal(signal).maybeSingle();
      if (response.error || !response.data) throw response.error ?? new Error("Event unavailable");
      result.detail = {
        id: response.data.id, actorProfileId: response.data.actor_profile_id,
        before: adminAuditStatePreview(response.data.before_state), after: adminAuditStatePreview(response.data.after_state)
      };
    } catch {
      result.detailError = "This event’s state could not be loaded. Close the details and try again.";
    }
  } else if (query.detail !== null) {
    result.detailError = "That event is not on this page. Choose an event from the results below.";
  }
  return result;
}
