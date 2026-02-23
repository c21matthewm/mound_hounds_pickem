"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { isProfileComplete, type ProfileRow } from "@/lib/profile";
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
  if (Number.isNaN(parsed) || parsed <= 0) {
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
    .select("id,full_name,team_name,phone_number,phone_carrier,role")
    .eq("id", user.id)
    .maybeSingle<ProfileRow>();

  if (!profile || !isProfileComplete(profile)) {
    redirect("/onboarding");
  }

  const raceId = parsePositiveInt(asText(formData.get("race_id")));
  const averageSpeed = parsePositiveDecimal(asText(formData.get("average_speed")));
  const groupSelections = [
    parsePositiveInt(asText(formData.get("driver_group1_id"))),
    parsePositiveInt(asText(formData.get("driver_group2_id"))),
    parsePositiveInt(asText(formData.get("driver_group3_id"))),
    parsePositiveInt(asText(formData.get("driver_group4_id"))),
    parsePositiveInt(asText(formData.get("driver_group5_id"))),
    parsePositiveInt(asText(formData.get("driver_group6_id")))
  ];

  if (!raceId || !averageSpeed || groupSelections.some((value) => value === null)) {
    picksErrorRedirect("A race, average speed, and one driver from each group are required.");
  }

  const selectedDriverIds = groupSelections as number[];
  const uniqueCount = new Set(selectedDriverIds).size;
  if (uniqueCount !== 6) {
    picksErrorRedirect("You must select 6 different drivers (one per group).");
  }

  const { data: race, error: raceError } = await supabase
    .from("races")
    .select("id,race_date,qualifying_start_at,is_archived")
    .eq("id", raceId)
    .maybeSingle();

  if (raceError || !race) {
    picksErrorRedirect("Selected race not found.");
  }
  const raceIsArchived = (race as { is_archived: boolean }).is_archived;
  if (raceIsArchived) {
    picksErrorRedirect("This race has been archived and no longer accepts picks.");
  }
  const qualifyingStartAt = (race as { qualifying_start_at: string }).qualifying_start_at;

  const qualifyingTime = new Date(qualifyingStartAt);
  if (qualifyingTime.getTime() <= Date.now()) {
    picksErrorRedirect("Picks are locked because qualifying has already started.");
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
      race_id: raceId,
      user_id: user.id
    },
    { onConflict: "user_id,race_id" }
  );

  if (upsertError) {
    picksErrorRedirect(upsertError.message);
  }

  revalidatePath("/picks");
  redirect("/picks");
}
