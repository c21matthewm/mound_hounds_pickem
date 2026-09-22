import { importIndy500QualifyingOrderAction } from "@/app/admin/result-actions";
import type { RaceRow } from "@/app/admin/admin-types";
import { SubmitButton } from "@/components/submit-button";
export function AdminIndyQualifying({ race }: { race: RaceRow }) {
  const selectedResultRace = race;
  const activeIndy500Races = [race];
  return (<>
        {activeIndy500Races.length > 0 ? (
        <details open className="mt-5 rounded-md border border-cyan-200 bg-cyan-50">
          <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-slate-900">
            Indianapolis 500 qualifying order
          </summary>
          <form
            action={importIndy500QualifyingOrderAction}
            className="border-t border-cyan-200 p-4"
            data-testid="admin-indy-qualifying-import-form"
          >
            <input name="tab" type="hidden" value="race-week" />
            <input
              name="result_race_id"
              type="hidden"
              value={String(selectedResultRace?.id ?? "")}
            />
            <input
              name="race_id"
              type="hidden"
              value={String(activeIndy500Races[0]?.id ?? "")}
            />
            <p className="text-xs text-slate-600">
              For Indy 500 races only: paste the 33-car qualifying order to create 8 pick groups.
            </p>
            <div className="mt-3 grid gap-3 md:grid-cols-4">
              <div
                className="rounded-md border border-cyan-200 bg-white px-3 py-2 md:col-span-1"
                data-testid="admin-indy-qualifying-race"
              >
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Indy 500 race
                </p>
                <p className="mt-1 text-sm font-semibold text-slate-900">
                  {activeIndy500Races[0]
                    ? `R${activeIndy500Races[0].round_number} · ${activeIndy500Races[0].race_name}`
                    : "Select an Indy 500 race above"}
                </p>
              </div>
              <label className="block md:col-span-3">
                <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">
                  Qualifying order paste
                </span>
                <textarea
                  required
                  className="h-32 w-full rounded-md ui-control-border border border-slate-300 px-3 py-2 font-mono text-xs"
                  data-testid="admin-indy-qualifying-paste"
                  name="qualifying_order_paste"
                  placeholder={"1\t10\tAlex Palou\n2\t5\tPato O'Ward\n3\t2\tJosef Newgarden"}
                />
              </label>
            </div>
            <SubmitButton
              className="mt-3 rounded-md ui-action-primary bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700"
              data-testid="admin-indy-qualifying-submit"
              disabled={activeIndy500Races.length === 0}
              pendingLabel="Importing..."
            >
              Import qualifying order
            </SubmitButton>
          </form>
        </details>
        ) : null}

  </>);
}
