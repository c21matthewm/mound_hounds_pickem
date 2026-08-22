import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { finalizeRaceWinnerNow } from "@/lib/fantasy-winner";
import { errorReference, reportAppError } from "@/lib/app-error-reporter";
import {
  adminSafeErrorMessage,
  type AppErrorSafeContext
} from "@/lib/app-error-safety";
import { isRacePickFormat, type RacePickFormat } from "@/lib/race-format";
import { invalidateScoringCache } from "@/lib/scoring-cache";
import {
  isAdminWorkspaceTab,
  type AdminWorkspaceTab
} from "@/lib/admin-tabs";
import { SEASON_RECOVERY_MIGRATION_FILE } from "@/lib/season-recovery";
import { withMigrationHint } from "@/lib/supabase/migration-errors";

export const asText = (value: FormDataEntryValue | null): string =>
  typeof value === "string" ? value.trim() : "";

export const MAX_DRIVER_NAME_LENGTH = 100;
export const MAX_PROFILE_NAME_LENGTH = 100;
export const MAX_RACE_NAME_LENGTH = 200;

export type AdminTab = AdminWorkspaceTab;

export type RaceStatusRow = {
  id: number;
  is_archived: boolean;
  pick_format: RacePickFormat;
};

export type EditablePickWindowRace = {
  field_frozen_at: string | null;
  id: number;
  is_archived: boolean;
  pick_format: RacePickFormat;
  pick_window_key: string;
  qualifying_start_at: string;
  race_date: string;
  race_name: string;
  round_number: number;
  season_id: number;
};

export const parseAdminTab = (value: string): AdminTab | null => {
  return isAdminWorkspaceTab(value) ? value : null;
};

export const parseRacePickFormat = (value: string): RacePickFormat =>
  isRacePickFormat(value) ? value : "standard";

export const RESULT_PUBLICATION_MIGRATION_FILE =
  "supabase/migrations/20260709_harden_roles_and_result_publication.sql";
export const HALL_OF_FAME_MIGRATION_FILE =
  "supabase/migrations/20260717_add_hall_of_fame.sql";
export const LEAGUE_SEASONS_MIGRATION_FILE =
  "supabase/migrations/20260718_add_league_seasons_and_active_participants.sql";
export const OPERATIONS_HARDENING_MIGRATION_FILE =
  "supabase/migrations/20260725_harden_race_and_season_operations.sql";
export const SHARED_PICK_WINDOWS_MIGRATION_FILE =
  "supabase/migrations/20260726_add_shared_pick_windows.sql";
export const REMINDER_DELIVERY_MIGRATION_FILE =
  "supabase/migrations/20260822_harden_pick_reminder_delivery.sql";

export const withResultPublicationMigrationHint = (message: string): string =>
  /function .* does not exist|schema cache/i.test(message)
    ? withMigrationHint(message, RESULT_PUBLICATION_MIGRATION_FILE)
    : message;

export const adminRedirect = (
  key: "error" | "message",
  value: string,
  tab?: AdminTab,
  resultRaceId?: number | null
): never => {
  const redirectValue = key === "error"
    ? adminSafeErrorMessage(value, "The admin operation could not be completed.")
    : value;
  const params = new URLSearchParams({ [key]: redirectValue });
  if (tab) {
    params.set("tab", tab);
  }
  if (tab === "results" && resultRaceId) {
    params.set("result_race_id", String(resultRaceId));
  }
  redirect(`/admin?${params.toString()}`);
};

export const adminMutationRedirect = (
  key: "error" | "message",
  value: string,
  tab: AdminTab,
  resultRaceId?: number | null
): never => {
  // Some mutations can succeed before a later audit/refresh step reports an error.
  // Invalidating on every admin mutation exit prevents a partial success from serving stale scores.
  invalidateScoringCache();
  return adminRedirect(key, value, tab, resultRaceId);
};

type ReportAdminActionFailureInput = {
  actorProfileId?: string | null;
  code: string;
  context?: AppErrorSafeContext;
  error: unknown;
  fallback: string;
  resultRaceId?: number | null;
  route?: string;
  subsystem?: string;
  tab: AdminTab;
};

export const reportAdminActionFailure = async ({
  actorProfileId = null,
  code,
  context,
  error,
  fallback,
  resultRaceId = null,
  route,
  subsystem = "admin",
  tab
}: ReportAdminActionFailureInput): Promise<never> => {
  const reported = await reportAppError({
    actorProfileId,
    code,
    context,
    error,
    route: route ?? `/admin?tab=${tab}`,
    subsystem
  });
  const message = `${adminSafeErrorMessage(error, fallback)}${errorReference(reported)}`;

  return adminMutationRedirect("error", message, tab, resultRaceId);
};

export const createSeasonSafetySnapshot = async (
  supabase: SupabaseClient,
  seasonId: number,
  label: string,
  source: "pre_correction" | "pre_rollover" | "result_checkpoint",
  retentionKey: string
): Promise<void> => {
  const { error } = await supabase.rpc("create_season_restore_point_v2", {
    p_label: label.slice(0, 160),
    p_retention_key: retentionKey.slice(0, 120),
    p_season_id: seasonId,
    p_source: source
  });

  if (error) {
    throw new Error(withMigrationHint(error.message, SEASON_RECOVERY_MIGRATION_FILE));
  }
};

export const createPublishedRaceCheckpoint = async (
  supabase: SupabaseClient,
  race: { id: number; raceName: string; roundNumber: number; seasonId: number },
  winnerOutcome: WinnerFinalizationOutcome
): Promise<string | null> => {
  try {
    await createSeasonSafetySnapshot(
      supabase,
      race.seasonId,
      `Finalized R${race.roundNumber}: ${race.raceName}${
        winnerOutcome.status === "pending" ? " (winner pending)" : ""
      }`,
      "result_checkpoint",
      `race:${race.id}`
    );
    return null;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not create the race checkpoint.";
    console.error(`[recovery] Post-publication checkpoint failed for race ${race.id}:`, message);
    await reportAppError({
      code: "create-result-checkpoint-failed",
      context: {
        entityId: race.id,
        entityType: "race",
        operation: "result_checkpoint",
        raceId: race.id,
        seasonId: race.seasonId
      },
      error,
      route: "/admin?tab=results",
      severity: "critical",
      subsystem: "recovery"
    });
    return message;
  }
};

export type WinnerFinalizationOutcome = {
  errorMessage: string | null;
  status: "finalized" | "pending";
  winnerProfileId: string | null;
};

export const finalizePublishedRaceWinner = async (
  supabase: SupabaseClient,
  raceId: number
): Promise<WinnerFinalizationOutcome> => {
  try {
    return {
      errorMessage: null,
      status: "finalized",
      winnerProfileId: await finalizeRaceWinnerNow(supabase, raceId)
    };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown fantasy winner calculation error.";
    console.error(
      `[fantasy-winner] Immediate finalization failed for race ${raceId}; automatic retry remains pending:`,
      errorMessage
    );
    await reportAppError({
      code: "finalize-fantasy-winner-failed",
      context: {
        entityId: raceId,
        entityType: "race",
        operation: "finalize_winner",
        raceId
      },
      error,
      route: "/admin?tab=results",
      severity: "warning",
      subsystem: "scoring"
    });

    return {
      errorMessage,
      status: "pending",
      winnerProfileId: null
    };
  }
};

export const fantasyWinnerPublicationMessage = (outcome: WinnerFinalizationOutcome): string =>
  outcome.status === "finalized"
    ? "The fantasy winner was recalculated immediately."
    : "Fantasy winner calculation is pending an automatic retry.";

export const parsePositiveInteger = (value: string): number | null => {
  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null;
  }

  return parsed;
};

export const parseNonNegativeNumber = (value: string): number | null => {
  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }

  return parsed;
};

export const timestampsMatch = (left: string, right: string): boolean =>
  Date.parse(left) === Date.parse(right);

export const isUuid = (value: string): boolean =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

const driverGroupForIndex = (index: number): number => {
  if (index < 4) return 1;
  if (index < 8) return 2;
  if (index < 12) return 3;
  if (index < 16) return 4;
  if (index < 20) return 5;
  return 6;
};

export async function refreshDriverStandingsAndGroups(supabase: SupabaseClient) {
  const { data: activeDrivers, error: activeDriversError } = await supabase
    .from("drivers")
    .select("id,championship_points,current_standing,driver_name")
    .eq("is_active", true)
    .order("championship_points", { ascending: false })
    .order("current_standing", { ascending: true })
    .order("driver_name", { ascending: true });

  if (activeDriversError) {
    throw new Error(activeDriversError.message);
  }

  const { data: inactiveDrivers, error: inactiveDriversError } = await supabase
    .from("drivers")
    .select("id,current_standing,driver_name")
    .eq("is_active", false)
    .order("current_standing", { ascending: true })
    .order("driver_name", { ascending: true });

  if (inactiveDriversError) {
    throw new Error(inactiveDriversError.message);
  }

  const rankedActiveDrivers = activeDrivers ?? [];
  const inactiveDriverRows = inactiveDrivers ?? [];

  const activeUpdateResponses = await Promise.all(
    rankedActiveDrivers.map((driver, index) =>
      supabase
        .from("drivers")
        .update({
          current_standing: index + 1,
          group_number: driverGroupForIndex(index)
        })
        .eq("id", driver.id)
    )
  );

  const inactiveUpdateResponses = await Promise.all(
    inactiveDriverRows.map((driver, index) =>
      supabase
        .from("drivers")
        .update({
          // Keep inactive drivers after active drivers for deterministic ordering.
          current_standing: rankedActiveDrivers.length + index + 1,
          group_number: 6
        })
        .eq("id", driver.id)
    )
  );

  const failed = [...activeUpdateResponses, ...inactiveUpdateResponses].find(
    (result) => result.error
  );

  if (failed?.error) {
    throw new Error(failed.error.message);
  }
}

export async function ensureRaceIsActive(supabase: SupabaseClient, raceId: number) {
  const { data: race, error } = await supabase
    .from("races")
    .select("id,is_archived,pick_format")
    .eq("id", raceId)
    .maybeSingle<RaceStatusRow>();

  if (error) {
    throw new Error(error.message);
  }

  if (!race) {
    throw new Error("Selected race was not found.");
  }

  if (race.is_archived) {
    throw new Error("Selected race is archived. Unarchive it before updating winners or results.");
  }
}
