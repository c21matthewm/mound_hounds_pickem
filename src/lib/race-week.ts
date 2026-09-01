import "server-only";

import type { AppSupabaseClient } from "@/lib/supabase/types";
import type { LeagueSeason } from "@/lib/seasons";
import type { SeasonParticipation } from "@/lib/season-participation";
import { isRegisteredForSeason } from "@/lib/season-participation";
import { getPreviousRaceResultsGate } from "@/lib/pickem-results-gate";
import { nextPickWindow, pickWindowOpensAt } from "@/lib/pick-windows";
import {
  pickLockAtForRace,
  type RacePickFormat
} from "@/lib/race-format";

export type RaceWeekRace = {
  field_frozen_at: string | null;
  id: number;
  pick_format: RacePickFormat;
  pick_window_key: string;
  qualifying_start_at: string;
  race_date: string;
  race_name: string;
  results_status: "draft" | "published";
  round_number: number;
  season_id: number;
};

export type RaceWeekPick = {
  id: number;
  race_id: number;
  updated_at: string;
};

export type RaceWeekStatus =
  | "form_open"
  | "form_pending"
  | "locked"
  | "no_race"
  | "no_season"
  | "picks_saved"
  | "registration_required"
  | "waiting_results";

export type RaceWeekAction = {
  body: string;
  href: string;
  label: string;
  statusLabel: string;
  status: RaceWeekStatus;
  title: string;
};

export type RaceWeekAdminReadiness = {
  fieldDriverCount: number;
  frozenRaceCount: number;
  pickCount: number;
  registeredTeamCount: number;
};

export type RaceWeekState = {
  action: RaceWeekAction;
  adminReadiness: RaceWeekAdminReadiness | null;
  currentRace: RaceWeekRace | null;
  isDoubleheader: boolean;
  pickByRaceId: Map<number, RaceWeekPick>;
  pickLockAt: string | null;
  pickOpenAt: string | null;
  previousResultsBlocked: boolean;
  races: RaceWeekRace[];
  savedRaceCount: number;
  windowComplete: boolean;
};

type LoadRaceWeekStateInput = {
  activeSeason: LeagueSeason | null;
  isAdmin: boolean;
  participation: SeasonParticipation | null;
  supabase: AppSupabaseClient;
  userId: string;
  now?: Date;
};

const RACE_FIELDS =
  "id,race_name,pick_format,pick_window_key,qualifying_start_at,race_date,results_status,season_id,round_number,field_frozen_at";

const PICK_FIELDS = "id,race_id,updated_at";

const actionForState = ({
  activeSeason,
  currentRace,
  isAdmin,
  isDoubleheader,
  picksNotOpen,
  picksLocked,
  previousResultsMessage,
  registered,
  seasonRaceCount,
  savedRaceCount,
  windowComplete,
  windowLength
}: {
  activeSeason: LeagueSeason | null;
  currentRace: RaceWeekRace | null;
  isAdmin: boolean;
  isDoubleheader: boolean;
  picksNotOpen: boolean;
  picksLocked: boolean;
  previousResultsMessage: string | null;
  registered: boolean;
  seasonRaceCount: number;
  savedRaceCount: number;
  windowComplete: boolean;
  windowLength: number;
}): RaceWeekAction => {
  if (!activeSeason) {
    return {
      body: "No league season is currently active.",
      href: "/leaderboard",
      label: "View league history",
      status: "no_season",
      statusLabel: "Waiting",
      title: "Season setup pending"
    };
  }

  if (!registered) {
    return {
      body: `Confirm your team for the ${activeSeason.seasonYear} season before making picks.`,
      href: "/season-registration",
      label: "Register for season",
      status: "registration_required",
      statusLabel: "Registration Needed",
      title: "Join this season"
    };
  }

  if (!currentRace) {
    if (seasonRaceCount === 0) {
      return {
        body: `Registration is open. The league administrator will post the first ${activeSeason.seasonYear} race when the schedule is ready.`,
        href: "/leaderboard?tab=hall",
        label: "View league history",
        status: "no_race",
        statusLabel: "Schedule Pending",
        title: "First race coming soon"
      };
    }

    return {
      body: `No upcoming race is scheduled for the ${activeSeason.seasonYear} season.`,
      href: "/leaderboard",
      label: "View standings",
      status: "no_race",
      statusLabel: "Season Complete",
      title: "No upcoming race"
    };
  }

  if (picksNotOpen) {
    return {
      body: "Your season registration is complete. The opening-round form becomes available six days before qualifying.",
      href: "/picks",
      label: "View race",
      status: "form_pending",
      statusLabel: "Scheduled",
      title: "Picks open soon"
    };
  }

  if (previousResultsMessage) {
    return {
      body: `${previousResultsMessage} Driver standings and pick groups will refresh before the form opens.`,
      href: isAdmin ? "/admin?tab=results" : "/leaderboard",
      label: isAdmin ? "Publish results" : "View standings",
      status: "waiting_results",
      statusLabel: "Results Needed",
      title: "Waiting on results"
    };
  }

  if (picksLocked) {
    return {
      body: windowComplete
        ? `${isDoubleheader ? "Both race picks are" : "Your picks are"} saved and locked.`
        : "The pick deadline has passed. Results will appear on the leaderboard after publication.",
      href: windowComplete
        ? `/leaderboard?tab=picks&race_id=${currentRace.id}`
        : "/leaderboard",
      label: windowComplete ? "View locked picks" : "View standings",
      status: "locked",
      statusLabel: "Locked",
      title: windowComplete ? "Picks saved and locked" : "Picks are locked"
    };
  }

  if (windowComplete) {
    return {
      body: `No action needed. ${isDoubleheader ? "Both race picks are" : "Your picks are"} already in.`,
      href: `/picks?race_id=${currentRace.id}`,
      label: "Review picks",
      status: "picks_saved",
      statusLabel: "Picks Saved",
      title: "Picks are in"
    };
  }

  return {
    body: isDoubleheader
      ? `${savedRaceCount}/${windowLength} races saved. Complete both before the shared deadline.`
      : `${currentRace.race_name} is open. Submit one driver from every group before lock.`,
    href: `/picks?race_id=${currentRace.id}`,
    label: "Make picks",
    status: "form_open",
    statusLabel: isDoubleheader ? `${savedRaceCount}/${windowLength} Saved` : "Form Open",
    title: isDoubleheader && savedRaceCount > 0 ? "Complete your picks" : "Make your picks"
  };
};

export async function loadRaceWeekState({
  activeSeason,
  isAdmin,
  participation,
  supabase,
  userId,
  now = new Date()
}: LoadRaceWeekStateInput): Promise<RaceWeekState> {
  if (!activeSeason) {
    return {
      action: actionForState({
        activeSeason,
        currentRace: null,
        isAdmin,
        isDoubleheader: false,
        picksNotOpen: false,
        picksLocked: false,
        previousResultsMessage: null,
        registered: false,
        seasonRaceCount: 0,
        savedRaceCount: 0,
        windowComplete: false,
        windowLength: 0
      }),
      adminReadiness: null,
      currentRace: null,
      isDoubleheader: false,
      pickByRaceId: new Map(),
      pickLockAt: null,
      pickOpenAt: null,
      previousResultsBlocked: false,
      races: [],
      savedRaceCount: 0,
      windowComplete: false
    };
  }

  const { data: raceRows, error: racesError } = await supabase
    .from("races")
    .select(RACE_FIELDS)
    .eq("season_id", activeSeason.id)
    .eq("is_archived", false)
    .order("round_number", { ascending: true })
    .returns<RaceWeekRace[]>();

  if (racesError) {
    throw new Error(`Failed loading race-week schedule: ${racesError.message}`);
  }

  const races = nextPickWindow(raceRows ?? [], now);
  const pickOpenAt = pickWindowOpensAt(raceRows ?? [], races);
  const picksNotOpen = Boolean(
    pickOpenAt && Date.parse(pickOpenAt) > now.getTime()
  );
  const { data: pickRows, error: picksError } = races.length > 0
    ? await supabase
        .from("picks")
        .select(PICK_FIELDS)
        .eq("user_id", userId)
        .in("race_id", races.map((race) => race.id))
        .returns<RaceWeekPick[]>()
    : { data: [], error: null };

  if (picksError) {
    throw new Error(`Failed loading race-week submissions: ${picksError.message}`);
  }

  const pickByRaceId = new Map((pickRows ?? []).map((pick) => [pick.race_id, pick]));
  const missingRace = races.find((race) => !pickByRaceId.has(race.id)) ?? null;
  const currentRace = missingRace ?? races[0] ?? null;
  const savedRaceCount = races.filter((race) => pickByRaceId.has(race.id)).length;
  const windowComplete = races.length > 0 && savedRaceCount === races.length;
  const isDoubleheader = races.length > 1;
  const pickLockAt = currentRace ? pickLockAtForRace(currentRace) : null;
  const picksLocked = pickLockAt ? Date.parse(pickLockAt) <= now.getTime() : false;
  const previousResultsGate = currentRace
    ? await getPreviousRaceResultsGate(supabase, currentRace)
    : null;
  const previousResultsMessage =
    previousResultsGate?.status === "blocked" ? previousResultsGate.shortMessage : null;
  const registered = isRegisteredForSeason(participation);

  let adminReadiness: RaceWeekAdminReadiness | null = null;
  if (isAdmin && currentRace) {
    const [registrationCount, pickCount, fieldCount] = await Promise.all([
      supabase
        .from("season_participants")
        .select("profile_id", { count: "exact", head: true })
        .eq("season_id", activeSeason.id)
        .eq("status", "registered"),
      supabase
        .from("picks")
        .select("id", { count: "exact", head: true })
        .in("race_id", races.map((race) => race.id)),
      supabase
        .from("race_driver_groups")
        .select("driver_id", { count: "exact", head: true })
        .in("race_id", races.map((race) => race.id))
    ]);
    const readinessError =
      registrationCount.error?.message ?? pickCount.error?.message ?? fieldCount.error?.message;
    if (readinessError) {
      throw new Error(`Failed loading race-week readiness: ${readinessError}`);
    }

    adminReadiness = {
      fieldDriverCount: fieldCount.count ?? 0,
      frozenRaceCount: races.filter((race) => race.field_frozen_at).length,
      pickCount: pickCount.count ?? 0,
      registeredTeamCount: registrationCount.count ?? 0
    };
  }

  return {
    action: actionForState({
      activeSeason,
      currentRace,
      isAdmin,
      isDoubleheader,
      picksNotOpen,
      picksLocked,
      previousResultsMessage,
      registered,
      seasonRaceCount: (raceRows ?? []).length,
      savedRaceCount,
      windowComplete,
      windowLength: races.length
    }),
    adminReadiness,
    currentRace,
    isDoubleheader,
    pickByRaceId,
    pickLockAt,
    pickOpenAt,
    previousResultsBlocked: previousResultsMessage !== null,
    races,
    savedRaceCount,
    windowComplete
  };
}
