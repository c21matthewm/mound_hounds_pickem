import type { DriverRow, RaceDriverGroupRow, RaceRow } from "@/app/admin/admin-types";
import { groupNumbersForPickFormat } from "@/lib/race-format";

type Props = { race: RaceRow; drivers: DriverRow[]; snapshot: RaceDriverGroupRow[] };

export function AdminRaceFieldPreview({ race, drivers, snapshot }: Props) {
  const frozen = Boolean(race.field_frozen_at);
  const driverById = new Map(drivers.map(driver => [driver.id, driver]));
  const rows = frozen
    ? snapshot.filter(row => row.race_id === race.id)
    : race.pick_format === "indy_500" ? [] : drivers.filter(driver => driver.is_active).map(driver => ({
      driver_id: driver.id, group_number: driver.group_number, qualifying_position: null
    }));

  if (!rows.length) return <p className="mt-3 text-sm text-slate-600">{frozen
    ? "No saved field rows were found. Review this race before publishing results."
    : race.pick_format === "indy_500" ? "Import the full Indianapolis 500 qualifying order to prepare its eight pick groups."
      : "No active drivers are available. Configure the roster before freezing the field."}</p>;

  return <details className="mt-4 rounded-lg border border-slate-200">
    <summary className="cursor-pointer p-3 text-sm font-semibold">{frozen ? "View saved pick field" : "Preview current pick field"} · {rows.length} drivers</summary>
    <div className="border-t border-slate-200 p-3">
      <p className="mb-3 text-xs text-slate-600">{frozen ? "These saved group assignments are used for this race, including drivers who have since left the active roster." : "This is the current roster. The field is saved only when this window freezes."}</p>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {groupNumbersForPickFormat(race.pick_format).map(group => <section key={group} className="min-w-0 rounded-md bg-slate-50 p-3">
          <h4 className="text-sm font-semibold">Group {group}</h4>
          <ul className="mt-2 space-y-1 text-sm text-slate-700">{rows.filter(row => row.group_number === group)
            .sort((a,b) => (a.qualifying_position ?? 999) - (b.qualifying_position ?? 999) || (driverById.get(a.driver_id)?.driver_name ?? "").localeCompare(driverById.get(b.driver_id)?.driver_name ?? ""))
            .map(row => <li className="break-words" key={row.driver_id}>{row.qualifying_position ? `${row.qualifying_position}. ` : ""}{driverById.get(row.driver_id)?.driver_name ?? `Driver ${row.driver_id} (name unavailable)`}</li>)}
            {!rows.some(row => row.group_number === group) ? <li className="text-amber-800">No drivers in this group</li> : null}
          </ul>
        </section>)}
      </div>
    </div>
  </details>;
}
