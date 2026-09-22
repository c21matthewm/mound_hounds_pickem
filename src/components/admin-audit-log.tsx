import { adminAuditHref, type AdminAuditLogData } from "@/lib/admin-audit-log";
import { CompactNotice, actionControlClassName } from "@/components/ui-primitives";
import { formatLeagueDateTime } from "@/lib/timezone";

export function AdminAuditLog({ auditLog }: { auditLog: AdminAuditLogData }) {
  const { query, rows, detail, error, detailError, hasOlder, hasNewer } = auditLog;
  const filtered = Boolean(query.search || query.action || query.entity);
  const fieldClassName = "mt-1 min-h-11 w-full min-w-0 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm";
  return (
    <section aria-labelledby="audit-log-heading" className="mt-5 min-w-0 border-t border-slate-200 pt-5" id="audit-log">
      <h3 className="font-semibold text-slate-900" id="audit-log-heading">Admin audit log</h3>
      <p className="mt-1 text-sm text-slate-600">Search administrative changes and inspect an event’s recorded before and after states.</p>
      <form action="/admin#audit-log" className="mt-3 grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-4" method="get">
        <input name="tab" type="hidden" value="health" />
        <label className="min-w-0 text-xs font-semibold text-slate-700">
          Search event summary
          <input className={fieldClassName} defaultValue={query.search} maxLength={120} name="audit_q" placeholder="e.g. Long Beach" type="search" />
        </label>
        <label className="min-w-0 text-xs font-semibold text-slate-700">
          Action (exact)
          <input className={fieldClassName} defaultValue={query.action} maxLength={64} name="audit_action" pattern={"[a-z][a-z0-9_\\-]*"} placeholder="e.g. publish_results" type="text" />
        </label>
        <label className="min-w-0 text-xs font-semibold text-slate-700">
          Entity type (exact)
          <input className={fieldClassName} defaultValue={query.entity} maxLength={64} name="audit_entity" pattern={"[a-z][a-z0-9_\\-]*"} placeholder="e.g. race" type="text" />
        </label>
        <div className="flex flex-wrap items-end gap-2">
          <button className={actionControlClassName("secondary", "min-h-11")} type="submit">Search audit log</button>
          {filtered ? <a className="py-3 text-sm font-semibold text-blue-700 underline" href="/admin?tab=health#audit-log">Clear filters</a> : null}
        </div>
      </form>
      {query.notice ? <CompactNotice className="mt-3" tone="warning">{query.notice}</CompactNotice> : null}
      {error ? <CompactNotice className="mt-3" tone="warning">{error} <a className="underline" href={adminAuditHref(query)}>Retry audit log</a></CompactNotice> : null}
      {detailError ? <CompactNotice className="mt-3" tone="warning">{detailError}</CompactNotice> : null}
      {!error && rows.length === 0 ? (
        <p className="mt-4 text-sm text-slate-600">{query.before || query.after ? "No events remain on this page." : filtered ? "No admin events match these filters." : "No admin events have been recorded yet."}</p>
      ) : null}
      <ol className="mt-4 divide-y divide-slate-200">
        {rows.map((event) => {
          const expanded = detail?.id === event.id;
          return (
            <li className="min-w-0 py-4" id={`audit-event-${event.id}`} key={event.id}>
              <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1 basis-56">
                  <p className="break-words text-sm font-medium text-slate-900 [overflow-wrap:anywhere]">{event.summary}</p>
                  <p className="mt-1 break-words text-xs text-slate-500 [overflow-wrap:anywhere]">
                    <time dateTime={event.created_at}>{formatLeagueDateTime(event.created_at, { dateStyle: "medium", timeStyle: "short" })}</time> · Event {event.id}
                  </p>
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-600">
                    <a className="break-all underline" href={adminAuditHref({...query, action:event.action}, {latest:true})} title={`Filter action: ${event.action}`}>{event.action}</a>
                    <a className="break-all underline" href={adminAuditHref({...query, entity:event.entity_type}, {latest:true})} title={`Filter entity: ${event.entity_type}`}>{event.entity_type}</a>
                    {event.entity_id ? <span className="break-all">Record {event.entity_id}</span> : null}
                  </div>
                </div>
                <a aria-controls={expanded ? `audit-state-${event.id}` : undefined} aria-expanded={expanded} className={actionControlClassName("secondary", "min-h-11 text-xs")} href={adminAuditHref(query, {detail: expanded ? null : event.id})}>
                  {expanded ? "Close details" : "View details"}<span className="sr-only"> for event {event.id}</span>
                </a>
              </div>
              {expanded ? (
                <div className="mt-3 min-w-0 rounded-md bg-slate-50 p-3" id={`audit-state-${event.id}`}>
                  <p className="break-all text-xs text-slate-600">{detail.actorProfileId ? `Admin profile: ${detail.actorProfileId}` : "Admin profile is no longer available."}</p>
                  <p className="mt-1 text-xs text-slate-500">Sensitive fields are hidden. Large state previews may be shortened.</p>
                  <div className="mt-3 grid min-w-0 gap-3 lg:grid-cols-2">
                    {([ ["Before", detail.before], ["After", detail.after] ] as const).map(([label, state]) => (
                      <section className="min-w-0" key={label} aria-label={`${label} event ${event.id}`}>
                        <h4 className="text-xs font-semibold text-slate-700">{label}</h4>
                        <pre className="mt-1 max-h-80 overflow-y-auto whitespace-pre-wrap break-words rounded border border-slate-200 bg-white p-3 text-xs text-slate-800 [overflow-wrap:anywhere]" tabIndex={0}>{state}</pre>
                      </section>
                    ))}
                  </div>
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>
      <nav aria-label="Admin audit history pages" className="mt-3 flex flex-wrap items-center gap-3">
        {hasNewer && rows[0] ? <a className={actionControlClassName("secondary", "min-h-11")} href={adminAuditHref(query,{after:rows[0].id})}>Newer events</a> : null}
        {hasOlder && rows.at(-1) ? <a className={actionControlClassName("secondary", "min-h-11")} href={adminAuditHref(query,{before:rows.at(-1)!.id})}>Older events</a> : null}
        {query.before || query.after ? <a className="py-3 text-sm font-semibold text-blue-700 underline" href={adminAuditHref(query,{latest:true})}>Latest {filtered ? "matching " : ""}events</a> : null}
        {!error && rows.length > 0 ? <span className="text-xs text-slate-500">Showing {rows.length} event{rows.length === 1 ? "" : "s"}, newest first.</span> : null}
      </nav>
    </section>
  );
}
