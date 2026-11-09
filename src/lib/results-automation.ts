import "server-only";

import { randomBytes } from "node:crypto";
import { after } from "next/server";
import { notifyAdminsOfStagedResults } from "@/lib/admin-results-push";
import { revalidatePath, revalidateTag } from "next/cache";
import { buildRaceResultsPreview, type RaceResultsPreviewDriver, type RaceResultsPreviewGroup } from "@/lib/race-results-preview";
import { normalizeRacePickFormat } from "@/lib/race-format";
import { SCORING_CACHE_TAG } from "@/lib/scoring-cache";
import { serializeJson } from "@/lib/supabase/json";
import type { AppSupabaseClient } from "@/lib/supabase/types";
import { canonicalSiteOrigin } from "@/lib/site-url";
import { createPublishedRaceCheckpoint, finalizePublishedRaceWinner } from "@/app/admin/action-runtime";
import { automationRpc } from "@/lib/results-automation-store";
import { hashText, isObject, parseSourcePayload, sourcePayloadHash, type AutomationFlag, type SourceResultsPayload } from "@/lib/results-automation-contract";

type AutomationContext = {
  race: { id: number; race_name: string; season_id: number; season: number; season_status: string; race_date: string; results_status: string; is_archived: boolean; pick_format: string; field_frozen_at: string | null; round_number: number };
  source: { event_id: string; session_id: string; source_url: string; monitor_enabled: boolean; poll_after: string | null } | null;
  drivers: RaceResultsPreviewDriver[]; raceDriverGroups: RaceResultsPreviewGroup[];
};
export async function loadAutomationContext(client: AppSupabaseClient, raceId: number) {
  const data = await automationRpc(client, "get_results_automation_context", { p_race_id: raceId });
  if (!isObject(data) || !isObject(data.context) || typeof data.context_hash !== "string") throw new Error("Race source context is unavailable.");
  return { context: data.context as unknown as AutomationContext, contextHash: data.context_hash };
}
export function buildAutomationPreview(payload: SourceResultsPayload, context: AutomationContext) {
  const extraFlags: AutomationFlag[] = [];
  const source = context.source;
  const flag = (code: string, message: string) => extraFlags.push({ code, message });
  if (!source || payload.season !== context.race.season || payload.event_id !== source.event_id || payload.session_id !== source.session_id || payload.source_url !== source.source_url) {
    flag("source_identity", "Official source, season, event, or race session does not match this race.");
  }
  if(payload.source_status==="official"&&(!payload.official_evidence||!/^[ ]*OFFICIAL (?:FINAL |RACE )?RESULTS[ ]*$/i.test(payload.official_evidence.header)))flag("official_confirmation_missing","Official post-race confirmation is missing. Checking will continue.");
  if (payload.source_status !== "official") flag("not_official", "Results are not explicitly marked official/final by the source.");
  if (context.race.is_archived || context.race.season_status !== "active" || Date.parse(context.race.race_date) > Date.now()) flag("race_ineligible", "Only past-due races in the active season are eligible.");
  const winnerRows = payload.rows.filter(row => row.position === 1);
  const winningSpeed = winnerRows.length === 1 ? winnerRows[0].average_speed ?? payload.race_average_speed : null;
  if (winnerRows.length === 1 && winnerRows[0].average_speed !== null && payload.race_average_speed !== null
    && Math.abs(winnerRows[0].average_speed - payload.race_average_speed) > 0.001) flag("speed_conflict", "Winner and race average speeds disagree.");
  const parsed = {
    ignoredLineCount: 0, winningAverageSpeed: winningSpeed,
    rows: payload.rows.map((row, i) => ({ averageSpeed: row.average_speed, carNumber: row.car_number, driverName: row.driver_name, lineNumber: i + 1, points: row.points ?? -1, position: row.position }))
  };
  for (const row of payload.rows) {
    if (row.points === null) flag("missing_points", `Official race points are missing for ${row.driver_name}.`);
    if (row.laps === null || row.laps < 0) flag("missing_laps", `Completed laps are missing or invalid for ${row.driver_name}.`);
    if (!row.status) flag("missing_status", `Result status is missing for ${row.driver_name}.`);
    if (!row.car_number || !/^\d{1,3}$/.test(row.car_number)) flag("missing_car", `Car number is missing or invalid for ${row.driver_name}.`);
  }
  const preview = buildRaceResultsPreview({ parsed, raceId: context.race.id, pickFormat: normalizeRacePickFormat(context.race.pick_format),
    drivers: context.drivers, raceDriverGroups: context.raceDriverGroups, fieldFrozen: Boolean(context.race.field_frozen_at) });
  const flags = [...preview.flags.map(({ code, message }) => ({ code, message })), ...extraFlags];
  return { preview: { ...preview, flags, isClean: preview.isClean && flags.length === 0 }, flags };
}
export function summarizeRun(value: unknown) {
  if (!isObject(value)) return null;
  const preview = isObject(value.preview) ? value.preview : {};
  const flags = Array.isArray(value.flags) ? value.flags : [];
  return { run_id: value.id, race_id: value.race_id, race_name: preview.raceName ?? preview.selectedRaceName ?? `Race ${value.race_id}`,
    payload_hash: value.payload_hash, source_status: isObject(value.source_payload)?value.source_payload.source_status:"unknown", status: value.status, is_clean: value.status === "READY_TO_PUBLISH" && flags.length === 0,
    flags_count: flags.length, flags, preview_url: `${canonicalSiteOrigin()}/admin?tab=results&result_race_id=${value.race_id}` };
}
export async function stageOfficialResults(client: AppSupabaseClient, input: unknown) {
  const payload = parseSourcePayload(input);
  const { context, contextHash } = await loadAutomationContext(client, payload.race_id);
  const { preview, flags } = buildAutomationPreview(payload, context);
  const data = await automationRpc(client, "stage_race_results", { p_race_id: payload.race_id, p_payload_hash: sourcePayloadHash(payload),
    p_context_hash: contextHash, p_source_payload: serializeJson(payload), p_preview: serializeJson({ ...preview, raceName: context.race.race_name }), p_flags: serializeJson(flags) });
  if (!isObject(data)) throw new Error("Staging response is invalid.");
  const run=summarizeRun(data.run);
  if(data.status==="staged"&&run&&["READY_TO_PUBLISH","NEEDS_REVIEW"].includes(String(run.status))) {
    try { after(async()=>{try{await notifyAdminsOfStagedResults(client,run);}catch{console.error("[admin-results-push] Alert unavailable; preview remains staged.");}}); }
    catch { console.error("[admin-results-push] Alert could not be scheduled; preview remains staged."); }
  }
  return { status: data.status, already_processed:data.status==="already_processed", already_published: context.race.results_status==="published", run };
}
function refreshResultsViews(): boolean {
  let refreshed = true;
  try { revalidateTag(SCORING_CACHE_TAG, { expire: 0 }); } catch { refreshed = false; }
  for (const path of ["/admin", "/dashboard", "/leaderboard", "/picks", "/race-center"]) {
    try { revalidatePath(path); } catch { refreshed = false; }
  }
  return refreshed;
}
export async function approveAndPublishStagedResults(client: AppSupabaseClient, runId: string, messageId: string, approverId: string) {
  const token = randomBytes(32).toString("hex");
  const approval = await automationRpc(client, "approve_staged_race_results", { p_run_id: runId, p_message_id: messageId, p_token_hash: hashText(token), p_approver_id: approverId });
  if (isObject(approval) && approval.status === "blocked") throw new Error("This approval request was blocked. A new approval is required.");
  if (isObject(approval) && approval.status === "already_processed") {
    refreshResultsViews();
    return { status: "already_processed", message: "These results have already been published." };
  }
  const result = await automationRpc(client, "publish_staged_race_results", { p_run_id: runId, p_message_id: messageId, p_approval_token: token });
  if (!isObject(result)) throw new Error("Publication response is invalid.");
  refreshResultsViews();
  if (result.status === "already_processed") return { status: "already_processed", message: "These results have already been published." };
  // The database has committed. Follow-up failures must never report publication as blocked.
  let followUpNeeded = false;
  let winner: Awaited<ReturnType<typeof finalizePublishedRaceWinner>> = { status: "pending", winnerProfileId: null, errorMessage: null };
  try { winner = await finalizePublishedRaceWinner(client, Number(result.race_id)); }
  catch { followUpNeeded = true; }
  try {
    const checkpointError = await createPublishedRaceCheckpoint(client, { id: Number(result.race_id), raceName: String(result.race_name), roundNumber: Number(result.round_number), seasonId: Number(result.season_id) }, winner);
    if (checkpointError) followUpNeeded = true;
  } catch { followUpNeeded = true; }
  if (!refreshResultsViews()) followUpNeeded = true;
  const warning = winner.status === "pending" || followUpNeeded ? " Check Admin for a cache, winner, or recovery follow-up." : "";
  return { status: "published", message: `${result.race_name} results published! League leaderboard is now live.${warning}` };
}
