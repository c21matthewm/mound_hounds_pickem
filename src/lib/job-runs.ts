import "server-only";

import { createServiceRoleSupabaseClient } from "@/lib/supabase/service-role";

export type JobName = "fantasy-winner" | "pick-reminders";

const asSummary = (value: unknown): Record<string, unknown> => {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return { result: value ?? null };
};

export async function withJobRun<T>(
  jobName: JobName,
  run: () => Promise<T>
): Promise<T> {
  const supabase = createServiceRoleSupabaseClient();
  const { data: jobRunId, error: startError } = await supabase.rpc("start_job_run", {
    p_job_name: jobName
  });

  if (startError) {
    console.error(`[jobs] Failed starting ${jobName} heartbeat:`, startError.message);
  }

  try {
    const result = await run();

    if (typeof jobRunId === "number") {
      const { error: finishError } = await supabase.rpc("finish_job_run", {
        p_error_message: null,
        p_job_run_id: jobRunId,
        p_status: "succeeded",
        p_summary: asSummary(result)
      });
      if (finishError) {
        console.error(`[jobs] Failed completing ${jobName} heartbeat:`, finishError.message);
      }
    }

    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : `Unknown ${jobName} failure.`;

    if (typeof jobRunId === "number") {
      const { error: finishError } = await supabase.rpc("finish_job_run", {
        p_error_message: message,
        p_job_run_id: jobRunId,
        p_status: "failed",
        p_summary: {}
      });
      if (finishError) {
        console.error(`[jobs] Failed recording ${jobName} failure:`, finishError.message);
      }
    }

    throw error;
  }
}
