import { randomUUID } from "node:crypto";
import { configureResultsMonitorAction, publishStagedResultsAction, revalidateStagedResultsAction } from "@/app/admin/results-automation-actions";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { SubmitButton } from "@/components/submit-button";
import { automationRpc } from "@/lib/results-automation-store";
import { isObject } from "@/lib/results-automation-contract";
import type { AppSupabaseClient } from "@/lib/supabase/types";
import { formatLeagueDateTime, formatLeagueDateTimeLocalInput } from "@/lib/timezone";

type Source = { event_id: string; session_id: string; source_url: string; poll_after: string | null; next_poll_at:string|null; official_staged_at:string|null; monitor_enabled: boolean; last_checked_at: string | null; last_error_code: string | null; dispatch_error_code?:string|null };
type PreviewRow = { position: number | null; sourceDriverName: string; mappedDriverName: string | null; points: number; status: string };
type Run = { source_status: string; id: string; status: string; created_at: string; flags: Array<{ code: string; message: string }>; preview: { rows?: PreviewRow[]; winningAverageSpeed?: number | null; expectedResultCount?: number; readyCount?: number } };
const statusLabel: Record<string, string> = { READY_TO_PUBLISH: "Ready for approval", NEEDS_REVIEW: "Review required", SUPERSEDED: "Superseded preview", PUBLISHED: "Published" };
const control = "mt-1 block min-h-11 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm";
const action = "min-h-11 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold disabled:opacity-50";
export async function AdminResultsAutomation({ supabase, race }: { supabase: AppSupabaseClient; race: { id: number; race_name: string; race_date: string; field_frozen_at: string | null } }) {
  let source: Source | null = null;
  let canMonitor = false;
  let runs: Run[] = [];
  try {
    const state = await automationRpc(supabase, "results_automation_state", { p_race_id: race.id });
    if (!isObject(state)) throw new Error("Unavailable");
    canMonitor = state.can_monitor === true;
    source = isObject(state.source) ? state.source as unknown as Source : null;
    runs = Array.isArray(state.runs) ? state.runs as unknown as Run[] : [];
  } catch {
    return <aside className="mt-5 rounded-lg border border-slate-200 bg-slate-50 p-4" role="status">
      <h3 className="font-semibold">Automatic results detection</h3>
      <p className="mt-2 text-sm text-slate-600">Setup is required before automatic previews are available. Install the results automation migration and follow the commissioner setup guide. Manual preview and publication remain available below.</p>
    </aside>;
  }
  const latest = runs[0];
  const ready = canMonitor && latest?.status === "READY_TO_PUBLISH" && latest.source_status==="official" && latest.flags.length === 0;
  const after = new Date(Math.max(Date.parse(race.race_date)+150*60*1000,source?.poll_after?Date.parse(source.poll_after):0)).toISOString();
  const provisional=latest?.source_status==="provisional";
  const unconfirmed=latest?.source_status!=="official";
  const monitoring=canMonitor && source?.monitor_enabled && !source.official_staged_at;
  const checking=source?.official_staged_at?"Official results staged — automatic checks finished.":!monitoring?"Automatic checking is off for this race.":source?.next_poll_at?`Next check no earlier than ${formatLeagueDateTime(source.next_poll_at)}.`:`Checking can begin ${formatLeagueDateTime(after)}.`;
  const dispatchErrors:Record<string,string>={dispatch_auth:"The results worker could not start. Check or renew the GitHub token in Supabase Vault.",dispatch_setup:"The results worker could not be found. Check that the reviewed workflow is on the main branch.",dispatch_unavailable:"The results worker could not start. It will retry automatically.",dispatch_worker_missing:"The results worker has not checked in. Confirm its GitHub enabled setting and app connection."};

  return <section className="mt-5 min-w-0 rounded-lg border border-slate-200 bg-slate-50 p-4" aria-labelledby="automatic-results-heading">
    <h3 id="automatic-results-heading" className="font-semibold text-slate-900">Automatic race results</h3>
    <p className="mt-1 text-sm text-slate-600">Detection stages results for review. Nothing publishes until you approve this exact preview.</p>
    {!race.field_frozen_at ? <p className="mt-3 text-sm text-amber-800">Freeze the race field in Preparation before an automatic preview can become ready.</p> : null}
    {latest ? <div className="mt-4 rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2"><h4 className="font-semibold">{["PUBLISHED","SUPERSEDED"].includes(latest.status)?statusLabel[latest.status]:unconfirmed?(provisional?"Provisional results — awaiting official confirmation":"Awaiting official confirmation"):latest.status==="READY_TO_PUBLISH"?"Official results ready for approval":"Official results need review"}</h4><p className="text-xs text-slate-500">{formatLeagueDateTime(latest.created_at)}</p></div>
      <p className="mt-2 text-sm">{latest.preview.readyCount ?? 0} of {latest.preview.expectedResultCount ?? 0} drivers mapped · {latest.flags.length} flag{latest.flags.length === 1 ? "" : "s"} · Winning average speed: {latest.preview.winningAverageSpeed ?? "Missing"} MPH</p>

      {latest.flags.length ? <details className="mt-3" open><summary className="cursor-pointer text-sm font-semibold text-amber-900">Validation flags ({latest.flags.length})</summary><ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-amber-900">{latest.flags.map((flag, i) => <li key={`${flag.code}-${i}`}>{flag.message}</li>)}</ul></details> : null}
      <details className="mt-3"><summary className="cursor-pointer text-sm font-semibold">Review mapped results</summary><div className="mt-2 overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr><th className="p-2">Place</th><th className="p-2">Official driver</th><th className="p-2">Matched driver</th><th className="p-2 text-right">Points</th></tr></thead><tbody>{(latest.preview.rows ?? []).map((row, i) => <tr key={i} className="border-t border-slate-100"><td className="p-2">{row.position ?? "—"}</td><td className="p-2">{row.sourceDriverName}</td><td className="p-2">{row.mappedDriverName ?? "Unmatched"}</td><td className="p-2 text-right">{row.points >= 0 ? row.points : "Missing"}</td></tr>)}</tbody></table></div></details>
      <div className="mt-4 flex flex-wrap items-start gap-3">
        {!["PUBLISHED","SUPERSEDED"].includes(latest.status) ? <form action={revalidateStagedResultsAction}><input type="hidden" name="race_id" value={race.id} /><input type="hidden" name="run_id" value={latest.id} /><SubmitButton className={action} pendingLabel="Checking...">Recheck driver mapping</SubmitButton></form> : null}
        {ready ? <form action={publishStagedResultsAction} className="space-y-3"><input type="hidden" name="race_id" value={race.id} /><input type="hidden" name="run_id" value={latest.id} /><input type="hidden" name="approval_message_id" value={`admin:${randomUUID()}`} /><label className="flex items-start gap-2 text-sm"><input type="checkbox" required name="confirm_staged_publish" className="mt-1 h-4 w-4" />I reviewed this preview and approve publication to the league.</label><ConfirmSubmitButton className="min-h-11 rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white" confirmMessage={`Publish this verified preview for ${race.race_name}?`} pendingLabel="Publishing...">Approve and publish</ConfirmSubmitButton></form> : null}
      </div>
      {unconfirmed ? <p className="mt-3 text-sm text-amber-800">These results are not confirmed official. {monitoring ? "Automatic checks continue at 15-minute intervals. " : ""}Publication stays blocked until official confirmation and validation pass.</p> : latest.status === "NEEDS_REVIEW" ? <p className="mt-3 text-sm text-slate-600">Correct the race field or driver roster, then recheck. For source-text corrections, use the manual preview below; its publication supersedes earlier approvals for staged data.</p> : null}

    </div> : <p className="mt-4 rounded-md border border-dashed border-slate-300 bg-white p-3 text-sm text-slate-600">No official results staged yet. Add the INDYCAR results link below and enable checking.</p>}
    <details className="mt-4"><summary className="cursor-pointer text-sm font-semibold">Detection settings</summary>
      <form action={configureResultsMonitorAction} className="mt-3 grid gap-3 sm:grid-cols-2"><input type="hidden" name="race_id" value={race.id} />
        <label className="text-sm sm:col-span-2">Official INDYCAR results page<input className={control} name="source_url" type="url" required maxLength={1800} defaultValue={source?.source_url ?? ""} placeholder="https://www.indycar.com/..." /></label>
        <p className="text-xs text-slate-600 sm:col-span-2">The event and race session are read from this URL. For a doubleheader, paste the page for the correct race.</p>
        <p className="text-sm text-slate-600 sm:col-span-2">Starts automatically 2½ hours after the race start in your calendar. Checks every 15 minutes until official results are staged.</p>
        <details className="sm:col-span-2"><summary className="cursor-pointer text-xs">Advanced: delayed or resumed race</summary><label className="mt-2 block text-sm">Do not check before (Indianapolis time)<input className={control} type="datetime-local" name="poll_after" defaultValue={source?.poll_after?formatLeagueDateTimeLocalInput(source.poll_after):""} /></label><p className="mt-1 text-xs text-slate-500">Leave blank to follow the race calendar. This does not change pick deadlines.</p></details>
        <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" name="monitor_enabled" defaultChecked={source?.monitor_enabled ?? false} className="h-4 w-4" />Enable automatic detection for this race</label>
        <div className="sm:col-span-2"><SubmitButton className={action} pendingLabel="Saving...">Save detection settings</SubmitButton></div>
      </form>
      <p className="mt-3 text-sm text-slate-600">{checking}</p>
      {source?.dispatch_error_code?<p className="mt-2 text-sm text-amber-800">{dispatchErrors[source.dispatch_error_code]}</p>:null}
      {source?.last_error_code?<p className="mt-2 text-sm text-amber-800">{source.last_error_code==="finality_unknown"?"Waiting for verifiable official confirmation. Checking will continue.":source.last_error_code==="layout_error"?"The results format needs review. Manual entry is available.":"The last check could not finish. It will retry automatically."}</p>:null}
    </details>
    {runs.length > 1 ? <details className="mt-4"><summary className="cursor-pointer text-sm font-semibold">Recent preview history ({runs.length - 1})</summary><ul className="mt-2 space-y-1 text-xs text-slate-500">{runs.slice(1).map(run => <li key={run.id}>{formatLeagueDateTime(run.created_at)} · {statusLabel[run.status] ?? run.status} · {run.flags.length} flags</li>)}</ul></details> : null}
  </section>;
}
