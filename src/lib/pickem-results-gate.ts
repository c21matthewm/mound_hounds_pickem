import type { AppSupabaseClient } from "@/lib/supabase/types";
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
};

export type PickemSeasonRaceForResultsGate = PickemRaceForResultsGate & {
  is_archived?: boolean;
  results_status: "draft" | "published";
};

export type PreviousRaceInfo = {
  id: number;
  raceDate: string;
  raceName: string;
  roundNumber: number;
};

export type PreviousRaceResultsDiagnostics = {
  expectedResultCount: number;
  missingResultCount: number;
  resultCount: number;
};

export type PreviousRaceResultsGate = {
  diagnostics: PreviousRaceResultsDiagnostics | null;
  previousRaces: PreviousRaceInfo[];
} & (
  | {
      previousRace: PreviousRaceInfo | null;
      status: "ready";
    }
  | {
      message: string;
      previousRace: PreviousRaceInfo;
      shortMessage: string;
      status: "blocked";
    }
);

type ResultsGateOptions = {
  // Pass the complete season query, never a future-only or current-window subset.
  seasonRaces?: readonly PickemSeasonRaceForResultsGate[];
  // Only administrative callers can read unpublished result rows under RLS.
  includeDiagnostics?: boolean;
};

// The schema permits unique rounds 1–99 within a season. Read one extra row to
// detect an unexpected oversized schedule instead of silently truncating it.
const MAX_SEASON_RACES = 99;

const toPreviousRaceInfo = (race: PickemRaceForResultsGate): PreviousRaceInfo => ({
  id: race.id,
  raceDate: race.race_date,
  raceName: race.race_name,
  roundNumber: race.round_number
});

/** Resolve the previous shared window from a complete season schedule. */
export const previousPickWindowRaces = (
  seasonRaces: readonly PickemSeasonRaceForResultsGate[],
  race: PickemRaceForResultsGate
): PickemSeasonRaceForResultsGate[] => {
  const races = seasonRaces
    .filter((candidate) => candidate.season_id === race.season_id && !candidate.is_archived)
    .sort((left, right) => left.round_number - right.round_number);
  const currentRace = races.find((candidate) => candidate.id === race.id);
  const uniqueIds = new Set(races.map((candidate) => candidate.id));
  const uniqueRounds = new Set(races.map((candidate) => candidate.round_number));

  if (
    !currentRace ||
    currentRace.round_number !== race.round_number ||
    currentRace.pick_window_key !== race.pick_window_key ||
    races.length > MAX_SEASON_RACES ||
    uniqueIds.size !== races.length ||
    uniqueRounds.size !== races.length ||
    races.some((candidate) =>
      !Number.isInteger(candidate.round_number) ||
      candidate.round_number < 1 ||
      candidate.round_number > MAX_SEASON_RACES ||
      !candidate.pick_window_key
    )
  ) {
    throw new Error("Cannot check previous results without a valid complete season schedule.");
  }

  const firstWindowRace = races.find(
    (candidate) => candidate.pick_window_key === race.pick_window_key
  )!;
  const previousAnchor = races
    .filter((candidate) => candidate.round_number < firstWindowRace.round_number)
    .at(-1);

  return previousAnchor
    ? races.filter((candidate) => candidate.pick_window_key === previousAnchor.pick_window_key)
    : [];
};

const loadSeasonRaces = async (
  supabase: AppSupabaseClient,
  race: PickemRaceForResultsGate
): Promise<PickemSeasonRaceForResultsGate[]> => {
  const { data, error } = await supabase
    .from("races")
    .select(
      "id,race_name,race_date,season_id,round_number,pick_format,pick_window_key,results_status"
    )
    .eq("is_archived", false)
    .eq("season_id", race.season_id)
    .order("round_number", { ascending: true })
    .limit(MAX_SEASON_RACES + 1)
    .returns<PickemSeasonRaceForResultsGate[]>();

  if (error) {
    throw new Error(`Failed to load the season schedule for previous results: ${error.message}`);
  }

  return data ?? [];
};

const loadResultDiagnostics = async (
  supabase: AppSupabaseClient,
  previousRaces: readonly PickemSeasonRaceForResultsGate[]
): Promise<PreviousRaceResultsDiagnostics> => {
  const previousRaceIds = previousRaces.map((race) => race.id);
  const [resultsResponse, snapshotResponse, activeDriversResponse] = await Promise.all([
    supabase.from("results").select("race_id").in("race_id", previousRaceIds),
    supabase.from("race_driver_groups").select("race_id").in("race_id", previousRaceIds),
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

  const snapshotCountByRace = new Map<number, number>();
  (snapshotResponse.data ?? []).forEach((row) => {
    snapshotCountByRace.set(row.race_id, (snapshotCountByRace.get(row.race_id) ?? 0) + 1);
  });
  const expectedResultCount = previousRaces.reduce((total, previousRace) => {
    const snapshotCount = snapshotCountByRace.get(previousRace.id) ?? 0;
    const fallbackCount = normalizeRacePickFormat(previousRace.pick_format) === "indy_500"
      ? INDY_500_QUALIFYING_FIELD_SIZE
      : (activeDriversResponse.count ?? 0);
    return total + Math.max(snapshotCount || fallbackCount, 1);
  }, 0);
  const resultCount = resultsResponse.data?.length ?? 0;

  return {
    expectedResultCount,
    missingResultCount: Math.max(0, expectedResultCount - resultCount),
    resultCount
  };
};

export const getPreviousRaceResultsGate = async (
  supabase: AppSupabaseClient,
  race: PickemRaceForResultsGate,
  { seasonRaces, includeDiagnostics = false }: ResultsGateOptions = {}
): Promise<PreviousRaceResultsGate> => {
  const previousRaces = previousPickWindowRaces(
    seasonRaces ?? await loadSeasonRaces(supabase, race),
    race
  );
  const previousRaceInfo = previousRaces.map(toPreviousRaceInfo);
  const previousRace = previousRaceInfo.at(-1) ?? null;
  const unpublishedRaces = previousRaces.filter(
    (candidate) => candidate.results_status !== "published"
  );

  // Publication is also the database pick-deadline trigger's readiness rule.
  // Counts are diagnostics, not a substitute for an administrator publishing.
  if (!previousRace || unpublishedRaces.length === 0) {
    return {
      diagnostics: null,
      previousRace,
      previousRaces: previousRaceInfo,
      status: "ready"
    };
  }

  const diagnostics = includeDiagnostics
    ? await loadResultDiagnostics(supabase, previousRaces)
    : null;
  const countText = diagnostics
    ? ` (${diagnostics.resultCount}/${diagnostics.expectedResultCount} result rows saved)`
    : "";
  const waitingLabel = unpublishedRaces.map((candidate) => candidate.race_name).join(" and ");
  const previousWindowLabel = previousRaces.length > 1
    ? "both doubleheader races"
    : previousRace.raceName;

  return {
    diagnostics,
    message: `Picks for ${race.race_name} are unavailable until results for ${previousWindowLabel} are published and driver groups refresh${countText}.`,
    previousRace,
    previousRaces: previousRaceInfo,
    shortMessage: `Waiting for ${waitingLabel} results to be published${countText}.`,
    status: "blocked"
  };
};
