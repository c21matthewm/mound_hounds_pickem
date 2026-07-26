import type { SupabaseClient } from "@supabase/supabase-js";
import {
  INDY_500_QUALIFYING_FIELD_SIZE,
  normalizeRacePickFormat,
  type RacePickFormat
} from "@/lib/race-format";

export type PickemRaceForResultsGate = {
  id: number;
  pick_format?: RacePickFormat | string | null;
  pick_window_key: string;
  race_date: string;
  race_name: string;
  round_number: number;
  season_id: number;
  results_status?: "draft" | "published" | null;
};

type PreviousRaceRow = PickemRaceForResultsGate;

export type PreviousRaceInfo = {
  id: number;
  raceDate: string;
  raceName: string;
  roundNumber: number;
};

export type PreviousRaceResultsGate =
  | {
      expectedResultCount: number | null;
      previousRace: PreviousRaceInfo | null;
      previousRaces: PreviousRaceInfo[];
      resultCount: number;
      status: "ready";
    }
  | {
      expectedResultCount: number;
      message: string;
      missingResultCount: number;
      previousRace: PreviousRaceInfo;
      previousRaces: PreviousRaceInfo[];
      resultCount: number;
      shortMessage: string;
      status: "blocked";
    };

const countValue = (value: number | null): number => (typeof value === "number" ? value : 0);

const toPreviousRaceInfo = (race: PreviousRaceRow): PreviousRaceInfo => ({
  id: race.id,
  raceDate: race.race_date,
  raceName: race.race_name,
  roundNumber: race.round_number
});

const loadPreviousPickWindow = async (
  supabase: SupabaseClient,
  race: PickemRaceForResultsGate
): Promise<PreviousRaceRow[]> => {
  const { data: currentWindowRows, error: currentWindowError } = await supabase
    .from("races")
    .select("round_number")
    .eq("is_archived", false)
    .eq("season_id", race.season_id)
    .eq("pick_window_key", race.pick_window_key)
    .order("round_number", { ascending: true })
    .limit(1);

  if (currentWindowError) {
    throw new Error(`Failed to load the current pick window: ${currentWindowError.message}`);
  }

  const firstRound =
    (currentWindowRows?.[0] as { round_number?: number } | undefined)?.round_number ??
    race.round_number;
  const { data: previousAnchor, error: previousAnchorError } = await supabase
    .from("races")
    .select("pick_window_key")
    .eq("is_archived", false)
    .eq("season_id", race.season_id)
    .lt("round_number", firstRound)
    .order("round_number", { ascending: false })
    .limit(1)
    .maybeSingle<{ pick_window_key: string }>();

  if (previousAnchorError) {
    throw new Error(`Failed to load the previous pick window: ${previousAnchorError.message}`);
  }

  if (!previousAnchor) {
    return [];
  }

  const { data, error } = await supabase
    .from("races")
    .select(
      "id,race_name,race_date,season_id,round_number,pick_format,pick_window_key,results_status"
    )
    .eq("is_archived", false)
    .eq("season_id", race.season_id)
    .eq("pick_window_key", previousAnchor.pick_window_key)
    .order("round_number", { ascending: true });

  if (error) {
    throw new Error(`Failed to load previous pick-window races: ${error.message}`);
  }

  return (data ?? []) as PreviousRaceRow[];
};

export const getPreviousRaceResultsGate = async (
  supabase: SupabaseClient,
  race: PickemRaceForResultsGate
): Promise<PreviousRaceResultsGate> => {
  const previousRaces = await loadPreviousPickWindow(supabase, race);

  if (previousRaces.length === 0) {
    return {
      expectedResultCount: null,
      previousRace: null,
      previousRaces: [],
      resultCount: 0,
      status: "ready"
    };
  }

  const previousRaceIds = previousRaces.map((previousRace) => previousRace.id);
  const [resultsResponse, snapshotResponse, activeDriversResponse] = await Promise.all([
    supabase
      .from("results")
      .select("race_id")
      .in("race_id", previousRaceIds),
    supabase
      .from("race_driver_groups")
      .select("race_id")
      .in("race_id", previousRaceIds),
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

  const resultCountByRace = new Map<number, number>();
  const snapshotCountByRace = new Map<number, number>();
  (resultsResponse.data ?? []).forEach((row) => {
    resultCountByRace.set(row.race_id, (resultCountByRace.get(row.race_id) ?? 0) + 1);
  });
  (snapshotResponse.data ?? []).forEach((row) => {
    snapshotCountByRace.set(row.race_id, (snapshotCountByRace.get(row.race_id) ?? 0) + 1);
  });
  const activeDriverCount = countValue(activeDriversResponse.count);
  const raceReadiness = previousRaces.map((previousRace) => {
    const resultCount = resultCountByRace.get(previousRace.id) ?? 0;
    const snapshotCount = snapshotCountByRace.get(previousRace.id) ?? 0;
    const pickFormat = normalizeRacePickFormat(previousRace.pick_format);
    const fallbackExpectedCount =
      pickFormat === "indy_500" ? INDY_500_QUALIFYING_FIELD_SIZE : activeDriverCount;
    const expectedResultCount = Math.max(snapshotCount || fallbackExpectedCount, 1);

    return {
      expectedResultCount,
      ready:
        previousRace.results_status === "published" ||
        (previousRace.results_status == null && resultCount >= expectedResultCount),
      resultCount
    };
  });
  const expectedResultCount = raceReadiness.reduce(
    (total, readiness) => total + readiness.expectedResultCount,
    0
  );
  const resultCount = raceReadiness.reduce(
    (total, readiness) => total + readiness.resultCount,
    0
  );
  const previousRaceInfo = previousRaces.map(toPreviousRaceInfo);
  const previousRace = previousRaceInfo[previousRaceInfo.length - 1];

  if (raceReadiness.every((readiness) => readiness.ready)) {
    return {
      expectedResultCount,
      previousRace,
      previousRaces: previousRaceInfo,
      resultCount,
      status: "ready"
    };
  }

  const countText = `${resultCount}/${expectedResultCount} result rows saved`;
  const unpublishedNames = previousRaces
    .filter((_, index) => !raceReadiness[index].ready)
    .map((previousRace) => previousRace.race_name);
  const previousWindowLabel =
    previousRaces.length > 1 ? "both doubleheader races" : previousRace.raceName;
  const waitingLabel = unpublishedNames.join(" and ");

  return {
    expectedResultCount,
    message: `The ${race.race_name} Pick'em form will open after results for ${previousWindowLabel} are published and driver groups refresh (${countText}).`,
    missingResultCount: Math.max(0, expectedResultCount - resultCount),
    previousRace,
    previousRaces: previousRaceInfo,
    resultCount,
    shortMessage: `Waiting on ${waitingLabel} results (${countText}).`,
    status: "blocked"
  };
};
