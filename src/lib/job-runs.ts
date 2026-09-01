import "server-only";

import { createServiceRoleSupabaseClient } from "@/lib/supabase/service-role";
import { serializeJson } from "@/lib/supabase/json";

export type JobName = "fantasy-winner" | "pick-reminders";
export type CompletedJobStatus = "degraded" | "succeeded";

type JobRunOptions<T> = {
  completionForResult?: (result: T) => {
    errorMessage?: string | null;
    status: CompletedJobStatus;
  };
  shouldRecordResult?: (result: T) => boolean;
};

const asSummary = (value: unknown) => {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return serializeJson(value);
  }

  return serializeJson({ result: value ?? null });
};

export async function withJobRun<T>(
  jobName: JobName,
  run: () => Promise<T>,
  options: JobRunOptions<T> = {}
): Promise<T> {
  const supabase = createServiceRoleSupabaseClient();
  const { data: jobRunToken, error: startError } = await supabase.rpc("start_job_status", {
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

    if (typeof jobRunToken === "string") {
      const { error: finishError } = await supabase.rpc("finish_job_status", {
        p_error_message: completion.errorMessage ?? null,
        p_job_name: jobName,
        p_record_event:
          completion.status !== "succeeded" || Boolean(options.shouldRecordResult?.(result)),
        p_run_token: jobRunToken,
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

    if (typeof jobRunToken === "string") {
      const { error: finishError } = await supabase.rpc("finish_job_status", {
        p_error_message: message,
        p_job_name: jobName,
        p_record_event: true,
        p_run_token: jobRunToken,
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
