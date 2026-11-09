import "server-only";

import { createServiceRoleSupabaseClient } from "@/lib/supabase/service-role";
import { automationRpc } from "@/lib/results-automation-store";
import { stageOfficialResults } from "@/lib/results-automation";
import { AUTOMATION_BODY_LIMIT, UUID_PATTERN, constantTimeSecret, isObject } from "@/lib/results-automation-contract";

export class AutomationRequestError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}
async function boundedJson(request: Request): Promise<Record<string, unknown>> {
  if (!request.headers.get("content-type")?.startsWith("application/json")) throw new AutomationRequestError("Use application/json.", 415);
  const length = request.headers.get("content-length");
  if (length && (!/^\d+$/.test(length) || Number(length) > AUTOMATION_BODY_LIMIT)) throw new AutomationRequestError("Payload is too large.", 413);
  const reader = request.body?.getReader();
  if (!reader) throw new AutomationRequestError("A JSON body is required.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new AutomationRequestError("Request body timed out.", 408)), 10_000); });
  try {
    while (true) {
      const chunk = await Promise.race([reader.read(), timeout]);
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > AUTOMATION_BODY_LIMIT) throw new AutomationRequestError("Payload is too large.", 413);
      chunks.push(chunk.value);
    }
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!isObject(parsed)) throw new AutomationRequestError("A JSON object is required.");
    return parsed;
  } catch (error) {
    if (error instanceof AutomationRequestError) throw error;
    throw new AutomationRequestError("Invalid JSON body.");
  } finally {
    clearTimeout(timer);
    await reader.cancel().catch(() => {});
  }
}
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
const raceId = (value: unknown): number => {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) throw new AutomationRequestError("A valid race ID is required.");
  return Number(value);
};
const dependencies = {
  createClient: createServiceRoleSupabaseClient, rpc: automationRpc,
  stage: stageOfficialResults
};
export function createResultsAutomationHandler(deps = dependencies) {
  return async function handle(request: Request): Promise<Response> {
    const expected = process.env.RESULTS_BRIDGE_SECRET ?? "";
    if (expected.length < 32) return reply({ error: "Results automation is not configured." }, 503);
    const supplied = request.headers.get("x-webhook-secret") ?? "";
    if (!supplied || !constantTimeSecret(supplied, expected)) return reply({ error: "Unauthorized." }, 401);
    try {
      const body = await boundedJson(request);
      switch (body.action) {
        case "stage": return reply(await deps.stage(deps.createClient(), body.payload));
        case "maintenance": return reply(await deps.rpc(deps.createClient(), "results_automation_maintenance", {}));
        case "candidates": return reply(await deps.rpc(deps.createClient(), "results_automation_candidates", {p_claim:body.claim===true}));
        case "monitor_result": {
          const errorCode = body.outcome === "error" && typeof body.error_code === "string" && /^[a-z0-9_.-]{1,80}$/.test(body.error_code) ? body.error_code : null;
          return reply(await deps.rpc(deps.createClient(), "results_automation_monitor_result", { p_race_id: raceId(body.race_id), p_error_code: errorCode, p_poll_token:typeof body.poll_token==="string"&&UUID_PATTERN.test(body.poll_token)?body.poll_token:null }));
        }
        default: throw new AutomationRequestError("Unknown results operation.");
      }
    } catch (error) {
      if (error instanceof AutomationRequestError) return reply({ error: error.message }, error.status);
      // Never echo SQL diagnostics, provider data, secrets, or raw input into a webhook response.
      return reply({ error: "Results operation failed. Check source setup and the installed migration in Admin." }, 409);
    }
  };
}
