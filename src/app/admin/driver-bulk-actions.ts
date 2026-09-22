"use server";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin";
import { reportAppError } from "@/lib/app-error-reporter";
import { invalidateScoringCache } from "@/lib/scoring-cache";
import { parseDriverRosterSelection } from "@/lib/admin-driver-bulk";
import { adminRedirect, asText, reportAdminActionFailure } from "@/app/admin/action-runtime";

export async function bulkUpdateDriverRosterAction(formData: FormData) {
  const {supabase,user} = await requireAdmin();
  const operation = asText(formData.get("operation"));
  let drivers;
  try {
    if (!["activate","deactivate"].includes(operation)) throw new Error("Choose a roster action.");
    drivers = parseDriverRosterSelection(asText(formData.get("selected_drivers")));
  } catch {
    return adminRedirect("error","Choose a roster action and between 1 and 100 distinct drivers.","drivers");
  }
  const refreshViews = () => {
    invalidateScoringCache();
    for (const path of ["/admin", "/dashboard", "/picks", "/leaderboard"]) revalidatePath(path);
  };
  const unconfirmed = async (error: unknown) => {
    refreshViews();
    try {
      await reportAppError({actorProfileId:user.id,code:"bulk-driver-roster-unconfirmed",context:{entityType:"driver_roster",operation:"bulk_status"},error,route:"/admin?tab=drivers",subsystem:"admin"});
    } catch { /* Reporting must not hide instructions for checking a possible commit. */ }
    return adminRedirect("error", "The roster update could not be confirmed. Refresh Drivers & Groups and check the selected drivers before retrying.", "drivers");
  };
  let result;
  try {
    result = await supabase.rpc("admin_set_driver_roster_status",{p_drivers:drivers,p_is_active:operation === "activate"});
  } catch (error) {
    return unconfirmed(error);
  }
  const {data,error} = result;
  if (error) {
    if (["PGRST202","42883"].includes(error.code)) return adminRedirect("error","Bulk driver changes are not configured yet. Apply the bulk driver roster migration, then retry.","drivers");
    if (["55P03","40P01","40001"].includes(error.code)) return adminRedirect("error","The roster is being updated. Refresh and try again.","drivers");
    if (!/^[0-9A-Z]{5}$/.test(error.code) || error.code === "40003" || error.code.startsWith("08")) return unconfirmed(error);
    return reportAdminActionFailure({actorProfileId:user.id,code:"bulk-driver-roster-failed",context:{entityType:"driver_roster",operation:"bulk_status"},error,fallback:"The driver roster could not be updated.",tab:"drivers"});
  }
  const count = data && typeof data === "object" && !Array.isArray(data) && typeof data.changed_count === "number" ? data.changed_count : null;
  if (count === null || !Number.isInteger(count) || count < 0 || count > drivers.length) return unconfirmed(new Error("Unexpected roster update response."));
  refreshViews();
  const message = `${count} driver${count === 1 ? "" : "s"} updated.`;
  return adminRedirect("message",`${message} Current groups were refreshed; saved race fields and results were preserved.`,"drivers");
}
