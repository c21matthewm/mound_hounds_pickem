"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin";
import { reportAppError } from "@/lib/app-error-reporter";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/service-role";
import { asText, parsePositiveInteger } from "@/app/admin/action-runtime";
import {
  hasRulesPdfEnvelope, isConfirmedRulesSaveFailure, isSafeRulesDocumentUrl,
  RULES_DOCUMENT_MIGRATION, rulesPdfMetadataError, SEASON_RULES_BUCKET,
  type RulesUploadState
} from "@/lib/season-rules";

export async function uploadSeasonRulesDocumentAction(
  _previousState: RulesUploadState, formData: FormData
): Promise<RulesUploadState> {
  const { supabase, user } = await requireAdmin();
  const seasonId = parsePositiveInteger(asText(formData.get("season_id")));
  const expectedUrl = formData.get("expected_rules_document_url");
  const file = formData.get("rules_pdf");
  const fail = (message: string): RulesUploadState => ({ status: "error", message });
  if (!seasonId || typeof expectedUrl !== "string" || expectedUrl.length > 2048) {
    return fail("Refresh Seasons & League before uploading the rules PDF.");
  }
  if (!(file instanceof File)) return fail("Choose the season rules PDF to upload.");
  const metadataError = rulesPdfMetadataError(file);
  if (metadataError) return fail(metadataError);

  // Reject a stale or unavailable season before reading bytes or creating an
  // object. The RPC repeats these checks under a lock to cover concurrent edits.
  try {
    const { data: season, error } = await supabase.from("league_seasons")
      .select("id,status,rules_document_url").eq("id", seasonId)
      .maybeSingle<{ id: number; status: string; rules_document_url: string | null }>();
    if (error) return fail("The season could not be checked. Refresh Seasons & League and try again.");
    if (!season || !["active", "upcoming"].includes(season.status)) {
      return fail("Rules can only be uploaded for an active or upcoming season.");
    }
    if (season.rules_document_url !== (expectedUrl || null)) {
      return fail("The rules document has changed. Refresh Seasons & League before uploading again.");
    }
  } catch { return fail("The season could not be checked. Refresh Seasons & League and try again."); }

  let bytes: Uint8Array<ArrayBuffer>;
  try { bytes = new Uint8Array(await file.arrayBuffer()); }
  catch { return fail("The PDF could not be read. Choose the file again."); }
  if (!hasRulesPdfEnvelope(bytes)) return fail("This file is not a complete PDF. Export the rules as PDF and try again.");

  const report = async (code: string, error: unknown) => {
    try {
      await reportAppError({ actorProfileId: user.id, code,
        context: { entityType: "league_season", entityId: seasonId, operation: "upload_rules" },
        error, route: "/admin?tab=seasons", subsystem: "storage" });
    } catch { /* Reporting must not hide the outcome of a document save. */ }
  };
  // Authorization and all bounded file validation precede privileged storage access.
  let service: ReturnType<typeof createServiceRoleSupabaseClient>;
  try { service = createServiceRoleSupabaseClient(); }
  catch (error) {
    await report("rules-storage-unavailable", error);
    return fail("Rules storage is unavailable. Check System Health and try again.");
  }
  const bucket = service.storage.from(SEASON_RULES_BUCKET);
  const path = `seasons/${seasonId}/${randomUUID()}.pdf`;
  let publicUrl: string;
  try {
    publicUrl = bucket.getPublicUrl(path).data.publicUrl;
    if (!isSafeRulesDocumentUrl(publicUrl)) return fail("Rules storage needs a secure public URL. Check its configuration before uploading.");
    const { error } = await bucket.upload(path, bytes, { contentType: "application/pdf", upsert: false, cacheControl: "31536000" });
    if (error) {
      await report("rules-pdf-upload-failed", error);
      return fail(`The PDF upload could not be confirmed. Check Storage before retrying. If the season-rules bucket is missing, apply ${RULES_DOCUMENT_MIGRATION}.`);
    }
  } catch (error) {
    await report("rules-pdf-upload-failed", error);
    return fail("The PDF upload could not be confirmed. Check Storage before retrying.");
  }

  let result;
  try {
    result = await supabase.rpc("set_league_season_rules_document", {
      p_season_id: seasonId, p_rules_document_url: publicUrl,
      p_expected_rules_document_url: expectedUrl || null
    });
  } catch (error) {
    await report("rules-document-save-unconfirmed", error);
    revalidatePath("/admin"); revalidatePath("/rules");
    return fail("The rules save could not be confirmed. Refresh this page and check the current PDF before trying again. The uploaded file was retained.");
  }
  if (result.error || result.data === null) {
    const confirmedFailure = result.error && isConfirmedRulesSaveFailure(result.error.code);
    if (confirmedFailure) {
      // Only this attempt's unique object can be removed. Older PDFs stay available
      // to prior links and recovery snapshots, even after a successful replacement.
      try {
        const cleanup = await bucket.remove([path]);
        if (cleanup.error) await report("rules-pdf-cleanup-failed", cleanup.error);
      } catch (error) { await report("rules-pdf-cleanup-failed", error); }
    }
    await report("rules-document-save-failed", result.error ?? new Error("Rules save returned no result."));
    revalidatePath("/admin"); revalidatePath("/rules");
    if (result.error?.code === "PGRST202" || result.error?.code === "42883") {
      return fail(`Rules uploads are not enabled yet. Apply ${RULES_DOCUMENT_MIGRATION} in Supabase, then retry.`);
    }
    return fail(confirmedFailure
      ? "The rules were not changed. Refresh Seasons & League: the season or its rules may have changed while you were uploading."
      : "The rules save could not be confirmed. Refresh this page and check the current PDF before trying again. The uploaded file was retained.");
  }
  revalidatePath("/admin"); revalidatePath("/rules");
  return { status: "success", message: "Rules PDF published. Participants can open it from Rules & Regulations." };
}
