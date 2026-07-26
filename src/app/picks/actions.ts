"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAppUser } from "@/lib/authenticated-user";
import { getPreviousRaceResultsGate } from "@/lib/pickem-results-gate";
import {
  groupNumbersForCount,
  isValidAverageSpeedMph,
  normalizeRacePickFormat,
  pickGroupCountForFormat,
  pickLockAtForRace
} from "@/lib/race-format";

const asText = (value: FormDataEntryValue | null): string =>
  typeof value === "string" ? value.trim() : "";

const parsePositiveInt = (value: string): number | null => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null;
  }

  return parsed;
};

const parsePositiveDecimal = (value: string): number | null => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }

  return parsed;
};

const picksErrorRedirect = (message: string, raceId?: number): never => {
  const params = new URLSearchParams({ error: message });
  if (raceId) {
    params.set("race_id", String(raceId));
  }
  redirect(`/picks?${params.toString()}`);
};

export async function saveWeeklyPickAction(formData: FormData) {
  const { supabase, user } = await requireAppUser({
    requireRegistration: true,
    requireSeasonDecision: true
  });

  const raceId = parsePositiveInt(asText(formData.get("race_id")));
  const averageSpeed = parsePositiveDecimal(asText(formData.get("average_speed")));

  if (!raceId || !averageSpeed || !isValidAverageSpeedMph(averageSpeed)) {
    picksErrorRedirect(
      "A race, an average speed between 0 and 300 MPH, and one driver from each group are required."
    );
  }

  const raceIdValue = raceId as number;

  const { data: race, error: raceError } = await supabase
    .from("races")
    .select(
      "id,race_name,race_date,qualifying_start_at,is_archived,pick_format,pick_window_key,season_id,round_number"
    )
    .eq("id", raceIdValue)
    .maybeSingle();

  if (raceError || !race) {
    picksErrorRedirect("Selected race not found.", raceIdValue);
  }
  const raceIsArchived = (race as { is_archived: boolean }).is_archived;
  if (raceIsArchived) {
    picksErrorRedirect("This race has been archived and no longer accepts picks.", raceIdValue);
  }

  const previousResultsGate = await getPreviousRaceResultsGate(
    supabase,
    race as {
      id: number;
      pick_format?: string | null;
      pick_window_key: string;
      race_date: string;
      race_name: string;
      round_number: number;
      season_id: number;
    }
  );
  if (previousResultsGate.status === "blocked") {
    picksErrorRedirect(previousResultsGate.message, raceIdValue);
  }

  const pickFormat = normalizeRacePickFormat((race as { pick_format?: string | null }).pick_format);
  const groupCount = pickGroupCountForFormat(pickFormat);
  const groupSelections = groupNumbersForCount(groupCount).map((groupNumber) =>
    parsePositiveInt(asText(formData.get(`driver_group${groupNumber}_id`)))
  );

  if (groupSelections.some((value) => value === null)) {
    picksErrorRedirect(
      `A race, average speed, and one driver from each of ${groupCount} groups are required.`,
      raceIdValue
    );
  }

  const selectedDriverIds = groupSelections as number[];
  const uniqueCount = new Set(selectedDriverIds).size;
  if (uniqueCount !== groupCount) {
    picksErrorRedirect(
      `You must select ${groupCount} different drivers (one per group).`,
      raceIdValue
    );
  }

  const pickLockAt = pickLockAtForRace(
    race as { pick_format?: string | null; qualifying_start_at: string; race_date: string }
  );
  const pickLockTime = new Date(pickLockAt);
  if (pickLockTime.getTime() <= Date.now()) {
    picksErrorRedirect(
      pickFormat === "indy_500"
        ? "Picks are locked because the race has already started."
        : "Picks are locked because qualifying has already started.",
      raceIdValue
    );
  }

  const { error: upsertError } = await supabase.from("picks").upsert(
    {
      average_speed: averageSpeed,
      driver_group1_id: selectedDriverIds[0],
      driver_group2_id: selectedDriverIds[1],
      driver_group3_id: selectedDriverIds[2],
      driver_group4_id: selectedDriverIds[3],
      driver_group5_id: selectedDriverIds[4],
      driver_group6_id: selectedDriverIds[5],
      driver_group7_id: pickFormat === "indy_500" ? selectedDriverIds[6] : null,
      driver_group8_id: pickFormat === "indy_500" ? selectedDriverIds[7] : null,
      race_id: raceIdValue,
      user_id: user.id
    },
    { onConflict: "user_id,race_id" }
  );

  if (upsertError) {
    picksErrorRedirect(upsertError.message, raceIdValue);
  }

  const racePickWindowKey = (race as { pick_window_key: string }).pick_window_key;
  const { data: windowRaces, error: windowRacesError } = await supabase
    .from("races")
    .select("id,race_name,round_number")
    .eq("is_archived", false)
    .eq("pick_window_key", racePickWindowKey)
    .order("round_number", { ascending: true });

  if (windowRacesError) {
    picksErrorRedirect(
      `Your picks were saved, but the next form could not be loaded: ${windowRacesError.message}`,
      raceIdValue
    );
  }

  const windowRaceIds = (windowRaces ?? []).map((windowRace) => windowRace.id);
  const { data: savedRows, error: savedRowsError } = await supabase
    .from("picks")
    .select("race_id")
    .eq("user_id", user.id)
    .in("race_id", windowRaceIds);

  if (savedRowsError) {
    picksErrorRedirect(
      `Your picks were saved, but submission progress could not be loaded: ${savedRowsError.message}`,
      raceIdValue
    );
  }

  const savedRaceIds = new Set((savedRows ?? []).map((savedRow) => savedRow.race_id));
  const missingRace = (windowRaces ?? []).find(
    (windowRace) => !savedRaceIds.has(windowRace.id)
  );
  const params = new URLSearchParams();
  params.set("race_id", String(missingRace?.id ?? raceIdValue));
  params.set(
    "message",
    missingRace
      ? `${(race as { race_name: string }).race_name} picks saved. Complete ${missingRace.race_name} next.`
      : windowRaceIds.length > 1
        ? "Both doubleheader race submissions are saved."
        : "Your picks are saved."
  );

  revalidatePath("/picks");
  revalidatePath("/dashboard");
  revalidatePath("/race-center");
  redirect(`/picks?${params.toString()}`);
}
