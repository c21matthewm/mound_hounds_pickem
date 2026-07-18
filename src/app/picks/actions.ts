"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getPreviousRaceResultsGate } from "@/lib/pickem-results-gate";
import { isProfileActive, isProfileComplete, type ProfileRow } from "@/lib/profile";
import {
  groupNumbersForCount,
  normalizeRacePickFormat,
  pickGroupCountForFormat,
  pickLockAtForRace
} from "@/lib/race-format";
import { isMissingColumnError } from "@/lib/supabase/schema-compat";
import { createServerSupabaseClient } from "@/lib/supabase/server";

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

const picksErrorRedirect = (message: string): never => {
  const params = new URLSearchParams({ error: message });
  redirect(`/picks?${params.toString()}`);
};

export async function saveWeeklyPickAction(formData: FormData) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("id,full_name,team_name,phone_number,phone_carrier,role,is_active")
    .eq("id", user.id)
    .maybeSingle<ProfileRow>();

  if (!profile || !isProfileComplete(profile)) {
    redirect("/onboarding");
  }

  if (!isProfileActive(profile)) {
    picksErrorRedirect("Your participant profile is inactive for the current season.");
  }

  const raceId = parsePositiveInt(asText(formData.get("race_id")));
  const averageSpeed = parsePositiveDecimal(asText(formData.get("average_speed")));

  if (!raceId || !averageSpeed) {
    picksErrorRedirect("A race, average speed, and one driver from each group are required.");
  }

  const raceIdValue = raceId as number;

  const { data: race, error: raceError } = await supabase
    .from("races")
    .select(
      "id,race_name,race_date,qualifying_start_at,is_archived,pick_format,season_id,round_number"
    )
    .eq("id", raceIdValue)
    .maybeSingle();

  if (raceError || !race) {
    picksErrorRedirect("Selected race not found.");
  }
  const raceIsArchived = (race as { is_archived: boolean }).is_archived;
  if (raceIsArchived) {
    picksErrorRedirect("This race has been archived and no longer accepts picks.");
  }

  const previousResultsGate = await getPreviousRaceResultsGate(
    supabase,
    race as {
      id: number;
      pick_format?: string | null;
      race_date: string;
      race_name: string;
      round_number: number;
      season_id: number;
    }
  );
  if (previousResultsGate.status === "blocked") {
    picksErrorRedirect(previousResultsGate.message);
  }

  const pickFormat = normalizeRacePickFormat((race as { pick_format?: string | null }).pick_format);
  const groupCount = pickGroupCountForFormat(pickFormat);
  const groupSelections = groupNumbersForCount(groupCount).map((groupNumber) =>
    parsePositiveInt(asText(formData.get(`driver_group${groupNumber}_id`)))
  );

  if (groupSelections.some((value) => value === null)) {
    picksErrorRedirect(
      `A race, average speed, and one driver from each of ${groupCount} groups are required.`
    );
  }

  const selectedDriverIds = groupSelections as number[];
  const uniqueCount = new Set(selectedDriverIds).size;
  if (uniqueCount !== groupCount) {
    picksErrorRedirect(`You must select ${groupCount} different drivers (one per group).`);
  }

  const pickLockAt = pickLockAtForRace(
    race as { pick_format?: string | null; qualifying_start_at: string; race_date: string }
  );
  const pickLockTime = new Date(pickLockAt);
  if (pickLockTime.getTime() <= Date.now()) {
    picksErrorRedirect(
      pickFormat === "indy_500"
        ? "Picks are locked because the race has already started."
        : "Picks are locked because qualifying has already started."
    );
  }

  let { error: upsertError } = await supabase.from("picks").upsert(
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

  if (
    upsertError &&
    pickFormat === "standard" &&
    (isMissingColumnError(upsertError, "driver_group7_id") ||
      isMissingColumnError(upsertError, "driver_group8_id"))
  ) {
    const legacyUpsertResponse = await supabase.from("picks").upsert(
      {
        average_speed: averageSpeed,
        driver_group1_id: selectedDriverIds[0],
        driver_group2_id: selectedDriverIds[1],
        driver_group3_id: selectedDriverIds[2],
        driver_group4_id: selectedDriverIds[3],
        driver_group5_id: selectedDriverIds[4],
        driver_group6_id: selectedDriverIds[5],
        race_id: raceIdValue,
        user_id: user.id
      },
      { onConflict: "user_id,race_id" }
    );

    upsertError = legacyUpsertResponse.error;
  }

  if (upsertError) {
    picksErrorRedirect(upsertError.message);
  }

  revalidatePath("/picks");
  redirect("/picks");
}
