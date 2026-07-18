import type { SupabaseClient } from "@supabase/supabase-js";
import {
  INDY_500_QUALIFYING_FIELD_SIZE,
  normalizeRacePickFormat,
  type RacePickFormat
} from "@/lib/race-format";

export type PickemRaceForResultsGate = {
  id: number;
  pick_format?: RacePickFormat | string | null;
  race_date: string;
  race_name: string;
  round_number: number;
  season_id: number;
  results_status?: "draft" | "published" | null;
};

type PreviousRaceRow = PickemRaceForResultsGate;

type PreviousRaceInfo = {
  id: number;
  raceDate: string;
  raceName: string;
};

export type PreviousRaceResultsGate =
  | {
      expectedResultCount: number | null;
      previousRace: PreviousRaceInfo | null;
      resultCount: number;
      status: "ready";
    }
  | {
      expectedResultCount: number;
      message: string;
      missingResultCount: number;
      previousRace: PreviousRaceInfo;
      resultCount: number;
      shortMessage: string;
      status: "blocked";
    };

const countValue = (value: number | null): number => (typeof value === "number" ? value : 0);

const loadPreviousRace = async (
  supabase: SupabaseClient,
  race: PickemRaceForResultsGate
): Promise<PreviousRaceRow | null> => {
  const { data, error } = await supabase
    .from("races")
    .select("id,race_name,race_date,season_id,round_number,pick_format,results_status")
    .eq("is_archived", false)
    .eq("season_id", race.season_id)
    .lt("round_number", race.round_number)
    .order("round_number", { ascending: false })
    .limit(1)
    .maybeSingle<PreviousRaceRow>();

  if (error) {
    throw new Error(`Failed to load previous race: ${error.message}`);
  }

  return data ?? null;
};

export const getPreviousRaceResultsGate = async (
  supabase: SupabaseClient,
  race: PickemRaceForResultsGate
): Promise<PreviousRaceResultsGate> => {
  const previousRace = await loadPreviousRace(supabase, race);

  if (!previousRace) {
    return {
      expectedResultCount: null,
      previousRace: null,
      resultCount: 0,
      status: "ready"
    };
  }

  const [resultsResponse, snapshotResponse, activeDriversResponse] = await Promise.all([
    supabase
      .from("results")
      .select("id", { count: "exact", head: true })
      .eq("race_id", previousRace.id),
    supabase
      .from("race_driver_groups")
      .select("driver_id", { count: "exact", head: true })
      .eq("race_id", previousRace.id),
    supabase
      .from("drivers")
      .select("id", { count: "exact", head: true })
      .eq("is_active", true)
      .gte("group_number", 1)
      .lte("group_number", 6)
  ]);

  if (resultsResponse.error) {
    throw new Error(`Failed to count previous race results: ${resultsResponse.error.message}`);
  }
  if (snapshotResponse.error) {
    throw new Error(`Failed to count previous race driver snapshot: ${snapshotResponse.error.message}`);
  }
  if (activeDriversResponse.error) {
    throw new Error(`Failed to count active drivers: ${activeDriversResponse.error.message}`);
  }

  const resultCount = countValue(resultsResponse.count);
  const snapshotCount = countValue(snapshotResponse.count);
  const activeDriverCount = countValue(activeDriversResponse.count);
  const pickFormat = normalizeRacePickFormat(previousRace.pick_format);
  const fallbackExpectedCount =
    pickFormat === "indy_500" ? INDY_500_QUALIFYING_FIELD_SIZE : activeDriverCount;
  const expectedResultCount = Math.max(snapshotCount || fallbackExpectedCount, 1);

  const publicationReady =
    previousRace.results_status === "published" ||
    (previousRace.results_status == null && resultCount >= expectedResultCount);

  if (publicationReady) {
    return {
      expectedResultCount,
      previousRace: {
        id: previousRace.id,
        raceDate: previousRace.race_date,
        raceName: previousRace.race_name
      },
      resultCount,
      status: "ready"
    };
  }

  const countText = `${resultCount}/${expectedResultCount} result rows saved`;

  return {
    expectedResultCount,
    message: `The ${race.race_name} Pick'em form will open after ${previousRace.race_name} results are uploaded and driver groups refresh (${countText}).`,
    missingResultCount: expectedResultCount - resultCount,
    previousRace: {
      id: previousRace.id,
      raceDate: previousRace.race_date,
      raceName: previousRace.race_name
    },
    resultCount,
    shortMessage: `Waiting on ${previousRace.race_name} results (${countText}).`,
    status: "blocked"
  };
};
