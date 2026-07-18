"use client";

import { raceOptionLabel } from "@/lib/race-label";

type RaceOption = {
  raceId: number;
  raceName: string;
  roundNumber: number;
};

type Props = {
  races: RaceOption[];
  selectedRaceId: number | null;
};

export function PicksRaceSelect({ races, selectedRaceId }: Props) {
  return (
    <form action="/leaderboard" method="get">
      <input name="tab" type="hidden" value="picks" />
      <select
        className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
        defaultValue={selectedRaceId ? String(selectedRaceId) : ""}
        name="race_id"
        onChange={(event) => event.currentTarget.form?.requestSubmit()}
      >
        {races.map((race) => (
          <option key={race.raceId} value={race.raceId}>
            {raceOptionLabel(race)}
          </option>
        ))}
      </select>
    </form>
  );
}
