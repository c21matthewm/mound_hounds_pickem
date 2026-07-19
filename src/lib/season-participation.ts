import type { SupabaseClient } from "@supabase/supabase-js";

export type SeasonParticipationStatus = "declined" | "registered";

export type SeasonParticipation = {
  decidedAt: string;
  profileId: string;
  registeredAt: string | null;
  seasonId: number;
  status: SeasonParticipationStatus;
};

type SeasonParticipationRow = {
  decided_at: string;
  profile_id: string;
  registered_at: string | null;
  season_id: number;
  status: SeasonParticipationStatus;
};

export async function loadSeasonParticipation(
  supabase: SupabaseClient,
  seasonId: number,
  profileId: string
): Promise<SeasonParticipation | null> {
  const { data, error } = await supabase
    .from("season_participants")
    .select("season_id,profile_id,status,registered_at,decided_at")
    .eq("season_id", seasonId)
    .eq("profile_id", profileId)
    .maybeSingle<SeasonParticipationRow>();

  if (error) {
    throw new Error(
      `Failed loading season registration: ${error.message}. Apply the latest Supabase migration before deploying this version.`
    );
  }

  return data
    ? {
        decidedAt: data.decided_at,
        profileId: data.profile_id,
        registeredAt: data.registered_at,
        seasonId: data.season_id,
        status: data.status
      }
    : null;
}

export const isRegisteredForSeason = (
  participation: SeasonParticipation | null | undefined
): boolean => participation?.status === "registered";
