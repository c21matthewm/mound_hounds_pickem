import "server-only";

import { createServiceRoleSupabaseClient } from "@/lib/supabase/service-role";

export type JobName = "fantasy-winner" | "pick-reminders";
export type CompletedJobStatus = "degraded" | "succeeded";

type JobRunOptions<T> = {
  completionForResult?: (result: T) => {
    errorMessage?: string | null;
    status: CompletedJobStatus;
  };
};

const asSummary = (value: unknown): Record<string, unknown> => {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return { result: value ?? null };
};

export async function withJobRun<T>(
  jobName: JobName,
  run: () => Promise<T>,
  options: JobRunOptions<T> = {}
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
    const completion = options.completionForResult?.(result) ?? {
      errorMessage: null,
      status: "succeeded" as const
    };

    if (typeof jobRunId === "number") {
      const { error: finishError } = await supabase.rpc("finish_job_run", {
        p_error_message: completion.errorMessage ?? null,
        p_job_run_id: jobRunId,
        p_status: completion.status,
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
