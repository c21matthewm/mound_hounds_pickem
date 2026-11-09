import "server-only";
import type { Database, Json, AppSupabaseClient } from "@/lib/supabase/types";

type AutomationFunctions = Pick<Database["public"]["Functions"],
  | "get_results_automation_context" | "get_results_automation_run"
  | "configure_results_monitor" | "results_automation_maintenance"
  | "results_automation_candidates" | "results_automation_monitor_result"
  | "stage_race_results" | "results_automation_state"
  | "approve_staged_race_results" | "publish_staged_race_results"
  | "revalidate_staged_race_results"
>;
export async function automationRpc<Name extends keyof AutomationFunctions>(client: AppSupabaseClient, name: Name, args: AutomationFunctions[Name]["Args"]): Promise<Json> {
  const { data, error } = await client.rpc(name, args);
  if (error) throw new Error(error.message);
  return data;
}
