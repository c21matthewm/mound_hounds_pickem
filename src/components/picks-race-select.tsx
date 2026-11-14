import { LeaderboardViewSelect } from "@/components/leaderboard-view-select";
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
    <LeaderboardViewSelect
      className="w-full rounded-md ui-control-border border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
      id="leaderboard-race-select"
      name="race_id"
      tab="picks"
      value={selectedRaceId === null ? "" : String(selectedRaceId)}
    >
      {races.map((race) => (
        <option key={race.raceId} value={race.raceId}>
          {raceOptionLabel(race)}
        </option>
      ))}
    </LeaderboardViewSelect>
  );
}
