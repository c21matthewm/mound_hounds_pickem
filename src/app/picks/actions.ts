"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAppUser } from "@/lib/authenticated-user";
import { isValidAverageSpeedMph } from "@/lib/race-format";
import { withMigrationHint } from "@/lib/supabase/migration-errors";

const ATOMIC_PICK_MIGRATION_FILE =
  "supabase/migrations/20260730_atomic_picks_and_season_recovery.sql";

type SaveWeeklyPickResult = {
  message: string;
  nextRaceId: number | null;
  pickId: number;
  raceId: number;
  savedRaceCount: number;
  submissionVersion: number;
  updatedAt: string;
  windowRaceCount: number;
};

const asText = (value: FormDataEntryValue | null): string =>
  typeof value === "string" ? value.trim() : "";

const parsePositiveInt = (value: string): number | null => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

const parsePositiveDecimal = (value: string): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const picksErrorRedirect = (message: string, raceId?: number): never => {
  const params = new URLSearchParams({ error: message });
  if (raceId) {
    params.set("race_id", String(raceId));
  }
  redirect(`/picks?${params.toString()}`);
};

const parseSaveResult = (value: unknown): SaveWeeklyPickResult | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const candidate = value as Partial<SaveWeeklyPickResult>;
  if (
    typeof candidate.message !== "string" ||
    typeof candidate.pickId !== "number" ||
    typeof candidate.raceId !== "number" ||
    typeof candidate.savedRaceCount !== "number" ||
    typeof candidate.submissionVersion !== "number" ||
    typeof candidate.updatedAt !== "string" ||
    typeof candidate.windowRaceCount !== "number" ||
    (candidate.nextRaceId !== null && typeof candidate.nextRaceId !== "number")
  ) {
    return null;
  }

  return candidate as SaveWeeklyPickResult;
};

export async function saveWeeklyPickAction(formData: FormData) {
  const { supabase } = await requireAppUser({
    requireRegistration: true,
    requireSeasonDecision: true
  });

  const raceId = parsePositiveInt(asText(formData.get("race_id")));
  const averageSpeed = parsePositiveDecimal(asText(formData.get("average_speed")));
  if (!raceId || !averageSpeed || !isValidAverageSpeedMph(averageSpeed)) {
    picksErrorRedirect(
      "A race, an average speed between 0 and 300 MPH, and one driver from each group are required.",
      raceId ?? undefined
    );
  }

  const driverIds = Array.from({ length: 8 }, (_, index) =>
    parsePositiveInt(asText(formData.get(`driver_group${index + 1}_id`)))
  );
  if (driverIds.slice(0, 6).some((driverId) => driverId === null)) {
    picksErrorRedirect("Select one driver from every group before saving.", raceId as number);
  }

  const hasGroupSeven = driverIds[6] !== null;
  const hasGroupEight = driverIds[7] !== null;
  if (hasGroupSeven !== hasGroupEight) {
    picksErrorRedirect("Select one driver from every group before saving.", raceId as number);
  }

  const selectedDriverIds = (hasGroupSeven ? driverIds : driverIds.slice(0, 6)) as number[];
  const { data, error } = await supabase.rpc("save_weekly_pick", {
    p_average_speed: averageSpeed,
    p_driver_ids: selectedDriverIds,
    p_race_id: raceId
  });

  if (error) {
    const message = /function .*save_weekly_pick.*does not exist|schema cache/i.test(error.message)
      ? withMigrationHint(error.message, ATOMIC_PICK_MIGRATION_FILE)
      : error.message;
    picksErrorRedirect(message, raceId as number);
  }

  const result = parseSaveResult(data);
  if (!result) {
    picksErrorRedirect(
      "Your save response could not be verified. Reload the form before trying again.",
      raceId as number
    );
  }
  const savedResult = result as SaveWeeklyPickResult;

  revalidatePath("/picks");
  revalidatePath("/dashboard");

  const params = new URLSearchParams({
    message: savedResult.message,
    race_id: String(savedResult.nextRaceId ?? savedResult.raceId)
  });
  redirect(`/picks?${params.toString()}`);
}
