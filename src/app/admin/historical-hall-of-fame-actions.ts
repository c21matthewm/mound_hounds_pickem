"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin";
import { errorReference, reportAppError } from "@/lib/app-error-reporter";
import {
  parseHistoricalHallOfFameImport,
  type HistoricalImportActionState
} from "@/lib/hall-of-fame-import";

const text = (value: FormDataEntryValue | null) => typeof value === "string" ? value : "";

export async function importHistoricalHallOfFameAction(
  _previousState: HistoricalImportActionState,
  formData: FormData
): Promise<HistoricalImportActionState> {
  const { supabase, user } = await requireAdmin();
  const preview = parseHistoricalHallOfFameImport({
    seasonYear: text(formData.get("season_year")),
    raceCount: text(formData.get("race_count")),
    spreadsheet: text(formData.get("spreadsheet_paste"))
  });
  if (preview.errors.length || preview.seasonYear === null || preview.raceCount === null) {
    return { status: "error", message: preview.errors[0] ?? "Review the season details before importing." };
  }
  if (text(formData.get("confirm_historical_import")) !== "yes") {
    return { status: "error", message: "Confirm that you reviewed the final places, champion, and season totals before importing." };
  }
  // The create-only RPC owns the transaction and audit event. It never calls the
  // normal finalization RPC, which intentionally replaces an existing snapshot.
  const { data, error } = await supabase.rpc("import_historical_hall_of_fame_season", {
    p_entries: preview.entries,
    p_race_count: preview.raceCount,
    p_season_year: preview.seasonYear
  });
  if (error) {
    if (error.code === "23505") {
      return { status: "error", message: `${preview.seasonYear} already has a Hall of Fame archive. Open its final standings to review it; this importer cannot replace it.` };
    }
    if (error.code === "PGRST202" || error.code === "42883") {
      return { status: "error", message: "Import is not enabled in this database yet. Apply supabase/migrations/20260913_add_historical_hall_of_fame_import.sql in Supabase, then retry." };
    }
    if (error.code === "42501") return { status: "error", message: "An administrator account is required to import a season." };
    const reported = await reportAppError({
      actorProfileId: user.id,
      code: "historical-hall-of-fame-import-failed",
      context: { entityId: preview.seasonYear, entityType: "hall_of_fame_season", operation: "import" },
      error,
      route: "/admin",
      severity: "error",
      subsystem: "admin-hall-of-fame"
    });
    return { status: "error", message: `The import could not be confirmed. Check Hall of Fame before trying again.${errorReference(reported)}` };
  }
  if (data === null) return { status: "error", message: "The import could not be confirmed. Check Hall of Fame before trying again." };
  revalidatePath("/admin");
  revalidatePath("/leaderboard");
  return {
    status: "success",
    seasonYear: preview.seasonYear,
    message: `${preview.seasonYear} imported: ${preview.entries.length} participants, ${preview.raceCount} races. Champion: ${preview.entries[0].team_name}.`
  };
}
