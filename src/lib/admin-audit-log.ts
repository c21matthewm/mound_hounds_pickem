import { queryStringParam } from "@/lib/query";

export const ADMIN_AUDIT_PAGE_SIZE = 25;
export type AdminAuditQuery = {
  search: string;
  action: string;
  entity: string;
  before: number | null;
  after: number | null;
  detail: number | null;
  notice: string | null;
};
export type AdminAuditListRow = {
  id: number;
  action: string;
  entity_type: string;
  entity_id: string | null;
  summary: string;
  created_at: string;
};
export type AdminAuditDetail = {
  id: number;
  actorProfileId: string | null;
  before: string;
  after: string;
};
export type AdminAuditLogData = {
  query: AdminAuditQuery;
  rows: AdminAuditListRow[];
  hasOlder: boolean;
  hasNewer: boolean;
  detail: AdminAuditDetail | null;
  error: string | null;
  detailError: string | null;
};

export function parseAdminAuditQuery(params: Record<string, string | string[] | undefined>): AdminAuditQuery {
  const notices = new Set<string>();
  const text = (key: string) => (queryStringParam(params[key]) ?? "").trim();
  const exactFilter = (key: string) => {
    const value = text(key);
    if (!value || /^[a-z][a-z0-9_-]{0,63}$/.test(value)) return value;
    notices.add("An invalid action or entity filter was cleared.");
    return "";
  };
  const id = (key: string) => {
    const value = text(key);
    if (!value) return null;
    const number = Number(value);
    if (/^[1-9]\d{0,15}$/.test(value) && Number.isSafeInteger(number)) return number;
    notices.add("An invalid event or page reference was cleared.");
    return null;
  };
  const search = text("audit_q");
  if (search.length > 120) notices.add("Search text was shortened to 120 characters.");
  let before = id("audit_before");
  let after = id("audit_after");
  if (before && after) {
    before = null;
    after = null;
    notices.add("Conflicting page references were cleared; showing the latest matches.");
  }
  const query = {
    search: search.slice(0, 120), action: exactFilter("audit_action"),
    entity: exactFilter("audit_entity"), before, after, detail: id("audit_event"),
    notice: null as string | null
  };
  query.notice = notices.size ? [...notices].join(" ") : null;
  return query;
}

// Use an escaped regular expression for literal substring matching. Unlike LIKE,
// PostgREST imatch does not reinterpret a literal asterisk as a percent wildcard.
export function escapeAdminAuditSearch(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function adminAuditHref(query: AdminAuditQuery, navigation: {
  before?: number; after?: number; detail?: number | null; latest?: boolean;
} = {}): string {
  const params = new URLSearchParams({ tab: "health" });
  if (query.search) params.set("audit_q", query.search);
  if (query.action) params.set("audit_action", query.action);
  if (query.entity) params.set("audit_entity", query.entity);
  const changingPage = navigation.latest || navigation.before !== undefined || navigation.after !== undefined;
  const before = changingPage ? navigation.before : query.before;
  const after = changingPage ? navigation.after : query.after;
  if (before) params.set("audit_before", String(before));
  if (after) params.set("audit_after", String(after));
  const detail = navigation.detail === undefined ? null : navigation.detail;
  if (detail) params.set("audit_event", String(detail));
  return `/admin?${params.toString()}#${detail ? `audit-event-${detail}` : "audit-log"}`;
}

// Audit history is admin-only, but old records may contain values current writers omit.
// Keep previews small and remove common credential fields before they reach the UI.
export function adminAuditStatePreview(value: unknown): string {
  let remaining = 300;
  const redactKey = (key: string) => /password|passwd|secret|token|apikey|authorization|cookie|invitecode|registrationcode|credential|privatekey/.test(key.replace(/[^a-z0-9]/gi, "").toLowerCase());
  const visit = (item: unknown, depth: number): unknown => {
    if (--remaining < 0 || depth > 6) return "[Preview shortened]";
    if (item === null || item === undefined) return null;
    if (typeof item === "string") {
      const shortened = item.slice(0, 1000);
      // Signed URLs and invitation fragments have no value in an audit preview.
      if (/^https?:\/\//i.test(shortened)) {
        try { const url = new URL(shortened); return `${url.origin}${url.pathname}`; } catch { return "[Invalid URL]"; }
      }
      return shortened.replace(/\b(Bearer\s+)\S+/gi, "$1[redacted]") + (item.length > 1000 ? "…" : "");
    }
    if (typeof item === "number" || typeof item === "boolean") return item;
    if (Array.isArray(item)) {
      const result = [];
      for (const entry of item.slice(0, 30)) {
        if (remaining <= 0) break;
        result.push(visit(entry, depth + 1));
      }
      if (result.length < item.length) result.push("[Preview shortened]");
      return result;
    }
    if (typeof item === "object") {
      const result: Record<string, unknown> = Object.create(null);
      let count = 0;
      for (const key in item) {
        if (!Object.hasOwn(item, key)) continue;
        if (++count > 30 || remaining <= 0) { result["[Preview shortened]"] = true; break; }
        result[key.slice(0, 100)] = redactKey(key) ? "[redacted]" : visit((item as Record<string, unknown>)[key], depth + 1);
      }
      return result;
    }
    return "[Unsupported value]";
  };
  if (value === null || value === undefined) return "No state recorded.";
  const preview = JSON.stringify(visit(value, 0), null, 2);
  return preview.length > 6000 ? `${preview.slice(0, 5950)}\n[Preview shortened]` : preview;
}
