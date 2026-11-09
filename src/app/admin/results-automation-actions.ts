"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin";
import { recordAdminAudit } from "@/lib/admin-audit";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/service-role";
import { automationRpc } from "@/lib/results-automation-store";
import { approveAndPublishStagedResults, buildAutomationPreview, loadAutomationContext } from "@/lib/results-automation";
import { UUID_PATTERN, isObject, officialRacePageIdentity, parseSourcePayload } from "@/lib/results-automation-contract";
import { serializeJson } from "@/lib/supabase/json";
import { parseLeagueDateTimeLocalInput } from "@/lib/timezone";
import { adminMutationRedirect, asText, parsePositiveInteger } from "@/app/admin/action-runtime";

export async function configureResultsMonitorAction(form: FormData) {
  const { supabase } = await requireAdmin();
  const raceId = parsePositiveInteger(asText(form.get("race_id")));
  const sourceUrl = asText(form.get("source_url"));
  const identity = officialRacePageIdentity(sourceUrl);
  const override=asText(form.get("poll_after"));
  const pollAfter=override?parseLeagueDateTimeLocalInput(override):null;
  if (!raceId || (override&&!pollAfter) || !identity) {
    return adminMutationRedirect("error", "Paste the exact official INDYCAR race-results page URL and choose a valid Indianapolis monitoring time.", "results", raceId);
  }
  try {
    const race = await supabase.from("races").select("league_seasons!inner(season_year)").eq("id", raceId).single();
    if (race.error || race.data?.league_seasons.season_year !== identity.season) throw new Error("The source year must match the race season.");
    await automationRpc(supabase, "configure_results_monitor", { p_race_id: raceId, p_event_id: identity.eventId, p_session_id: identity.sessionId, p_source_url: sourceUrl,
      p_poll_after: pollAfter, p_enabled: form.get("monitor_enabled") === "on" });
    await recordAdminAudit(supabase, { action: "configure_results_monitor", entityId: String(raceId), entityType: "race", summary: "Updated official results detection settings." });
  } catch {
    return adminMutationRedirect("error", "Monitor settings could not be saved. Check the results automation migration and official source details.", "results", raceId);
  }
  revalidatePath("/admin");
  return adminMutationRedirect("message", "Official results detection settings saved. Detection only stages a preview; publication still requires approval.", "results", raceId);
}
export async function revalidateStagedResultsAction(form: FormData) {
  const { supabase } = await requireAdmin();
  const raceId = parsePositiveInteger(asText(form.get("race_id")));
  const id = asText(form.get("run_id"));
  if (!raceId || !UUID_PATTERN.test(id)) return adminMutationRedirect("error", "Select a valid staged preview.", "results", raceId);
  try {
    const service = createServiceRoleSupabaseClient();
    const run = await automationRpc(service, "get_results_automation_run", { p_run_id: id });
    if (!isObject(run) || run.race_id !== raceId) throw new Error("Preview mismatch.");
    const payload = parseSourcePayload(run.source_payload);
    const { context, contextHash } = await loadAutomationContext(service, raceId);
    const { preview, flags } = buildAutomationPreview(payload, context);
    await automationRpc(supabase, "revalidate_staged_race_results", { p_run_id: id, p_context_hash: contextHash,
      p_preview: serializeJson({ ...preview, raceName: context.race.race_name }), p_flags: serializeJson(flags) });
    await recordAdminAudit(supabase, { action: "revalidate_staged_results", entityType: "race", entityId: String(raceId), summary: `Revalidated official preview with ${flags.length} flags.` });
  } catch {
    return adminMutationRedirect("error", "The preview could not be refreshed. A newer source version, changed race, or missing migration may require a new preview.", "results", raceId);
  }
  revalidatePath("/admin");
  return adminMutationRedirect("message", "Preview checked against the current race field. Review its flags before approving.", "results", raceId);
}
export async function publishStagedResultsAction(form: FormData) {
  const { supabase, user } = await requireAdmin();
  const raceId = parsePositiveInteger(asText(form.get("race_id")));
  const id = asText(form.get("run_id"));
  const messageId = asText(form.get("approval_message_id"));
  if (!raceId || !UUID_PATTERN.test(id) || !/^admin:[a-f0-9-]{36}$/.test(messageId) || form.get("confirm_staged_publish") !== "on") {
    return adminMutationRedirect("error", "Review and confirm this exact staged result before publishing.", "results", raceId);
  }
  let message: string;
  try {
    // Publication requires the authenticated Admin session and this exact reviewed run.
    const run = await automationRpc(createServiceRoleSupabaseClient(), "get_results_automation_run", { p_run_id: id });
    if (!isObject(run) || run.race_id !== raceId) throw new Error("Preview mismatch.");
    const result = await approveAndPublishStagedResults(supabase, id, messageId, user.id);
    message = result.message;
  } catch {
    return adminMutationRedirect("error", "Publication blocked. Resolve flags and refresh this preview; approval must match the current race field.", "results", raceId);
  }
  return adminMutationRedirect("message", message, "results", raceId);
}
