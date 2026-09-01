import type { AppSupabaseClient } from "@/lib/supabase/types";

export type LeagueSeasonStatus = "active" | "completed" | "upcoming";

export type LeagueSeason = {
  activatedAt: string | null;
  completedAt: string | null;
  displayName: string;
  id: number;
  registrationCodeConfiguredAt: string | null;
  rosterConfiguredAt: string | null;
  rulesDocumentUrl: string | null;
  seasonYear: number;
  status: LeagueSeasonStatus;
};

type LeagueSeasonRow = {
  activated_at: string | null;
  completed_at: string | null;
  display_name: string;
  id: number;
  registration_code_configured_at: string | null;
  roster_configured_at: string | null;
  rules_document_url: string | null;
  season_year: number;
  status: LeagueSeasonStatus;
};

const toLeagueSeason = (row: LeagueSeasonRow): LeagueSeason => ({
  activatedAt: row.activated_at,
  completedAt: row.completed_at,
  displayName: row.display_name,
  id: row.id,
  registrationCodeConfiguredAt: row.registration_code_configured_at,
  rosterConfiguredAt: row.roster_configured_at,
  rulesDocumentUrl: row.rules_document_url,
  seasonYear: row.season_year,
  status: row.status
});

const SEASON_FIELDS =
  "id,season_year,display_name,status,activated_at,completed_at,registration_code_configured_at,roster_configured_at,rules_document_url";

export async function loadActiveLeagueSeason(
  supabase: AppSupabaseClient
): Promise<LeagueSeason | null> {
  const { data, error } = await supabase
    .from("league_seasons")
    .select(SEASON_FIELDS)
    .eq("status", "active")
    .maybeSingle<LeagueSeasonRow>();

  if (error) {
    throw new Error(`Failed loading the active league season: ${error.message}`);
  }

  return data ? toLeagueSeason(data) : null;
}

export async function loadLeagueSeasons(
  supabase: AppSupabaseClient
): Promise<LeagueSeason[]> {
  const { data, error } = await supabase
    .from("league_seasons")
    .select(SEASON_FIELDS)
    .order("season_year", { ascending: false });

  if (error) {
    throw new Error(`Failed loading league seasons: ${error.message}`);
  }

  return ((data ?? []) as LeagueSeasonRow[]).map(toLeagueSeason);
}
