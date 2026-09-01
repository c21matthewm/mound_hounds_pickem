"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin";
import { recordAdminAudit } from "@/lib/admin-audit";
import { withMigrationHint } from "@/lib/supabase/migration-errors";
import { buildLeagueScoringSnapshotUncached } from "@/lib/scoring";
import {
  HALL_OF_FAME_MIGRATION_FILE,
  LEAGUE_SEASONS_MIGRATION_FILE,
  adminMutationRedirect,
  asText,
  createSeasonSafetySnapshot,
  parseAdminTab,
  parsePositiveInteger,
  reportAdminActionFailure
} from "@/app/admin/action-runtime";

export async function finalizeHallOfFameSeasonAction(formData: FormData) {
  const { supabase, user } = await requireAdmin();
  const tab = parseAdminTab(asText(formData.get("tab"))) ?? "results";
  const redirectWithTab = (key: "error" | "message", value: string): never =>
    adminMutationRedirect(key, value, tab);
  const seasonId = parsePositiveInteger(asText(formData.get("season_id")));

  if (!seasonId) {
    return redirectWithTab(
      "error",
      "An active season is required before final standings can be saved."
    );
  }

  const { data: season, error: seasonError } = await supabase
    .from("league_seasons")
    .select("id,season_year,status")
    .eq("id", seasonId)
    .maybeSingle<{ id: number; season_year: number; status: string }>();
  if (seasonError) {
    await reportAdminActionFailure({
      actorProfileId: user.id,
      code: "load-hall-of-fame-season-failed",
      context: { entityId: seasonId, entityType: "league_season", operation: "finalize" },
      error: withMigrationHint(seasonError.message, LEAGUE_SEASONS_MIGRATION_FILE),
      fallback: "The active season could not be loaded.",
      tab
    });
  }
  if (!season) {
    redirectWithTab("error", "Active season not found.");
  }
  const selectedSeason = season as { id: number; season_year: number; status: string };
  if (selectedSeason.status !== "active") {
    redirectWithTab("error", "Only the active season can be finalized.");
  }
  const seasonIdValue = seasonId as number;
  const seasonYear = selectedSeason.season_year;

  const { data: seasonRaces, error: racesError } = await supabase
    .from("races")
    .select("id,race_name,race_date,results_status,round_number")
    .eq("is_archived", false)
    .eq("season_id", seasonIdValue)
    .order("round_number", { ascending: true });

  if (racesError) {
    await reportAdminActionFailure({
      actorProfileId: user.id,
      code: "load-hall-of-fame-races-failed",
      context: { entityId: seasonIdValue, entityType: "league_season", operation: "finalize" },
      error: racesError,
      fallback: "The season races could not be loaded.",
      tab
    });
  }

  const races = seasonRaces ?? [];
  if (races.length === 0) {
    redirectWithTab("error", `No active races were found for the ${seasonYear} season.`);
  }

  const unpublishedRaces = races.filter((race) => race.results_status !== "published");
  if (unpublishedRaces.length > 0) {
    redirectWithTab(
      "error",
      `Publish every race before finalizing the season. Still waiting on: ${unpublishedRaces
        .map((race) => race.race_name)
        .join(", ")}.`
    );
  }

  const finalRace = races[races.length - 1];
  if (Date.parse(finalRace.race_date) > Date.now()) {
    redirectWithTab("error", `The final scheduled race, ${finalRace.race_name}, has not started yet.`);
  }

  let snapshot: Awaited<ReturnType<typeof buildLeagueScoringSnapshotUncached>> | null = null;
  try {
    snapshot = await buildLeagueScoringSnapshotUncached(seasonIdValue);
  } catch (snapshotError) {
    await reportAdminActionFailure({
      actorProfileId: user.id,
      code: "calculate-hall-of-fame-failed",
      context: { entityId: seasonIdValue, entityType: "league_season", operation: "finalize" },
      error: snapshotError,
      fallback: "Failed to calculate final season standings.",
      tab
    });
  }

  if (!snapshot) {
    redirectWithTab("error", "Failed to calculate final season standings.");
  }
  const finalSnapshot = snapshot as Awaited<
    ReturnType<typeof buildLeagueScoringSnapshotUncached>
  >;

  if (finalSnapshot.raceColumns.length !== races.length || finalSnapshot.leaderboardRows.length === 0) {
    redirectWithTab(
      "error",
      "Final standings are incomplete. Confirm every race has published result rows before trying again."
    );
  }

  const entries = finalSnapshot.leaderboardRows.map((row) => ({
    final_rank: row.currentStanding,
    race_breakdown: finalSnapshot.raceColumns.map((race) => ({
      points: row.raceBreakdown[race.raceId] ?? 0,
      race_date: race.raceDate,
      race_id: race.raceId,
      race_name: race.raceName,
      round_number: race.roundNumber
    })),
    team_name: row.teamName,
    total_points: row.totalPoints
  }));

  try {
    await createSeasonSafetySnapshot(
      supabase,
      seasonIdValue,
      `Before finalizing ${seasonYear} Hall of Fame standings`,
      "pre_rollover",
      `season:${seasonIdValue}:hall-of-fame`
    );
  } catch (snapshotError) {
    await reportAdminActionFailure({
      actorProfileId: user.id,
      code: "hall-of-fame-backup-failed",
      context: { entityId: seasonIdValue, entityType: "league_season", operation: "finalize" },
      error: snapshotError,
      fallback: "Could not create the required pre-finalization backup.",
      tab
    });
  }

  const { error } = await supabase.rpc("finalize_hall_of_fame_season", {
    p_entries: entries,
    p_race_count: finalSnapshot.raceColumns.length,
    p_season_year: seasonYear
  });

  if (error) {
    await reportAdminActionFailure({
      actorProfileId: user.id,
      code: "finalize-hall-of-fame-failed",
      context: { entityId: seasonIdValue, entityType: "league_season", operation: "finalize" },
      error: /function .* does not exist|schema cache|hall_of_fame/i.test(error.message)
        ? withMigrationHint(error.message, HALL_OF_FAME_MIGRATION_FILE)
        : error,
      fallback: "The Hall of Fame standings could not be finalized.",
      tab
    });
  }

  await recordAdminAudit(supabase, {
    action: "finalize_hall_of_fame",
    afterState: {
      participant_count: entries.length,
      race_count: finalSnapshot.raceColumns.length,
      season_year: seasonYear
    },
    entityId: String(seasonIdValue),
    entityType: "league_season",
    summary: `Finalized ${seasonYear} Hall of Fame standings.`
  });

  revalidatePath("/admin");
  revalidatePath("/leaderboard");
  redirectWithTab(
    "message",
    `${seasonYear} final standings saved to the Hall of Fame. This snapshot remains available after drivers are retired or replaced.`
  );
}
