import "server-only";

import { randomUUID } from "node:crypto";
import {
  sanitizeAppErrorContext,
  sanitizeErrorRoute,
  sanitizeTechnicalSummary,
  type AppErrorSafeContext
} from "@/lib/app-error-safety";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/service-role";

export type AppErrorSeverity = "warning" | "error" | "critical";

export type ReportAppErrorInput = {
  actorProfileId?: string | null;
  code: string;
  context?: AppErrorSafeContext;
  error: unknown;
  route: string;
  severity?: AppErrorSeverity;
  subsystem: string;
};

export type ReportedAppError = {
  correlationId: string;
  recorded: boolean;
};

const normalizeIdentifier = (value: string, fallback: string, maxLength: number): string => {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9_.-]+/g, "-");
  return (normalized || fallback).slice(0, maxLength);
};

export async function reportAppError({
  actorProfileId = null,
  code,
  context,
  error,
  route,
  severity = "error",
  subsystem
}: ReportAppErrorInput): Promise<ReportedAppError> {
  const correlationId = randomUUID();
  const technicalSummary = sanitizeTechnicalSummary(error);

  try {
    const supabase = createServiceRoleSupabaseClient();
    const { error: reportError } = await supabase.rpc("record_app_error_event", {
      p_actor_profile_id: actorProfileId,
      p_correlation_id: correlationId,
      p_error_code: normalizeIdentifier(code, "unknown-error", 80),
      p_route: sanitizeErrorRoute(route),
      p_safe_context: sanitizeAppErrorContext(context),
      p_severity: severity,
      p_subsystem: normalizeIdentifier(subsystem, "application", 40),
      p_technical_summary: technicalSummary
    });

    if (reportError) {
      console.error("[app-errors] Failed recording application error:", reportError.message);
      console.error(`[app-errors:${correlationId}] ${technicalSummary}`);
      return { correlationId, recorded: false };
    }

    return { correlationId, recorded: true };
  } catch (reportError) {
    console.error("[app-errors] Error reporter unavailable:", sanitizeTechnicalSummary(reportError));
    console.error(`[app-errors:${correlationId}] ${technicalSummary}`);
    return { correlationId, recorded: false };
  }
}

export const errorReference = (reported: ReportedAppError): string =>
  reported.recorded ? ` Reference: ${reported.correlationId.slice(0, 8).toUpperCase()}.` : "";
