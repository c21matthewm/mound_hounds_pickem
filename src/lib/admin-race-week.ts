import type { RaceRow } from "@/app/admin/admin-types";
import { pickWindowOpensAt, racesInPickWindow } from "@/lib/pick-windows";
import { previousPickWindowRaces } from "@/lib/pickem-results-gate";
import { pickLockAtForRace } from "@/lib/race-format";
export const RACE_WEEK_PHASES = ["preparation", "picks", "results", "winner"] as const;
export type RaceWeekPhase = typeof RACE_WEEK_PHASES[number];
export function selectRaceWeekPhase(input: string | undefined, race: RaceRow | null, now: number): RaceWeekPhase {
  // A bookmarked stage can outlive its season's schedule. Keep the empty-state
  // path usable before accepting a requested stage that needs a selected race.
  if (!race) return "preparation";
  if (RACE_WEEK_PHASES.some(phase => phase === input)) return input as RaceWeekPhase;
  if (race.results_status === "published") return "winner";
  if (Date.parse(pickLockAtForRace(race)) <= now) return "results";
  return race.field_frozen_at ? "picks" : "preparation";
}
export function missingPickParticipants<T extends { id: string }>(participants: T[], raceIds: number[], picks: Array<{user_id: string; race_id: number}>): T[] {
  if (!raceIds.length) return [];
  const picked = new Map<string, Set<number>>();
  for (const pick of picks) {
    const saved = picked.get(pick.user_id) ?? new Set<number>();
    saved.add(pick.race_id); picked.set(pick.user_id, saved);
  }
  return participants.filter(participant => raceIds.some(id => !picked.get(participant.id)?.has(id)));
}

/** A display hint only: the database rechecks readiness atomically on submit. */
export function raceFieldFreezeState(race: RaceRow, seasonRaces: RaceRow[], now: number): {disabled: boolean; message: string} {
  const window = racesInPickWindow(seasonRaces, race);
  if (!window.length || race.is_archived) return {disabled: true, message: "Select a race in the active calendar."};
  if (window.every(item => Boolean(item.field_frozen_at))) return {disabled: true, message: "The field is saved for every race in this pick window."};
  if (window.some(item => !Number.isFinite(Date.parse(pickLockAtForRace(item))) || Date.parse(pickLockAtForRace(item)) <= now)) return {disabled: true, message: "This pick window has closed. The saved field cannot be changed here."};
  const opensAt = pickWindowOpensAt(seasonRaces, window);
  if (opensAt && Date.parse(opensAt) > now) return {disabled: true, message: "Opening-round fields can freeze starting six days before qualifying."};
  try {
    if (previousPickWindowRaces(seasonRaces, race).some(item => item.results_status !== "published")) return {disabled: true, message: "Publish every race in the previous pick window before freezing this field."};
  } catch {
    return {disabled: true, message: "The season calendar could not be verified. Refresh before freezing the field."};
  }
  return {disabled: false, message: window.length > 1 ? "Save the current driver groups for both doubleheader races together. Review the roster before continuing." : "Save the current driver groups for this race. Review the roster before continuing."};
}
