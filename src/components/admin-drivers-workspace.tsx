import {
  createDriverAction,
  deleteDriverAction,
  importChampionshipStandingsAction,
  updateDriverAction
} from "@/app/admin/driver-actions";
import type {
  DriverRow,
  LeagueSeasonRow
} from "@/app/admin/admin-types";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { SubmitButton } from "@/components/submit-button";
import {
  AdminWorkspaceHeader,
  Disclosure,
  EmptyState,
  FormField,
  StatusChip,
  actionControlClassName,
  fieldControlClassName
} from "@/components/ui-primitives";

type AdminDriversWorkspaceProps = {
  activeSeason: LeagueSeasonRow | null;
  drivers: DriverRow[];
  seasons: LeagueSeasonRow[];
};

export function AdminDriversWorkspace({
  activeSeason,
  drivers,
  seasons
}: AdminDriversWorkspaceProps) {
  return (
        <section className="mt-6 rounded-lg ui-panel border border-slate-200 bg-white p-4 sm:p-6">
        <AdminWorkspaceHeader
          description="Opening order comes from the prior final standings. Published results update current points and groups."
          title="Drivers"
        />

        <Disclosure
          className="mt-5 bg-slate-50"
          description="Import the prior championship order before the first published race."
          summary="Preseason seed tools"
        >
          <form
            action={importChampionshipStandingsAction}
            data-testid="admin-standings-import-form"
          >
            <input name="tab" type="hidden" value="drivers" />
            <h3 className="text-sm font-semibold text-slate-900">Import Opening Seed</h3>
            <p className="mt-1 text-xs text-slate-600">
              Use before the first published race. The importer maps Rank and Driver, while the new
              season starts every driver at 0 points.
            </p>
            <label className="mt-3 block max-w-xs">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">
                Season being prepared
              </span>
              <select
                required
                className="w-full rounded-md ui-control-border border border-slate-300 px-3 py-2 text-sm"
                defaultValue={
                  seasons.find((season) => season.status === "upcoming")?.id ??
                  activeSeason?.id ??
                  ""
                }
                name="season_id"
              >
                <option value="">Select season</option>
                {seasons
                  .filter((season) => season.status !== "completed")
                  .map((season) => (
                    <option key={`roster-season-${season.id}`} value={season.id}>
                      {season.season_year} ({season.status})
                    </option>
                  ))}
              </select>
            </label>
            <textarea
              required
              className="mt-3 h-36 w-full rounded-md ui-control-border border border-slate-300 px-3 py-2 font-mono text-xs"
              data-testid="admin-standings-import-input"
              name="standings_paste"
              placeholder={"1\tAlex Palou\tHonda\t711\t0\t17\t8\t6\t14\t15\t778"}
            />
            <SubmitButton
              className="mt-3 rounded-md ui-action-primary bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700"
              data-testid="admin-standings-import-submit"
              pendingLabel="Synchronizing..."
            >
              Import opening seed
            </SubmitButton>
          </form>
        </Disclosure>

        <form
          action={createDriverAction}
          className="mt-5 grid gap-3 rounded-md ui-panel-muted border border-slate-200 bg-slate-50 p-4 md:grid-cols-5"
          data-testid="admin-driver-create-form"
        >
          <input name="tab" type="hidden" value="drivers" />
          <FormField className="md:col-span-3" label="Driver name">
            <input
              required
              className={fieldControlClassName()}
              data-testid="admin-driver-create-name"
              maxLength={100}
              name="driver_name"
              type="text"
            />
          </FormField>

          <FormField className="md:col-span-2" label="Driver image">
            <input
              accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
              className={fieldControlClassName("text-xs")}
              data-testid="admin-driver-create-image-file"
              name="image_file"
              type="file"
            />
          </FormField>

          <Disclosure
            className="md:col-span-5"
            description="Use a direct URL only when an image file cannot be uploaded."
            summary="Advanced image option"
          >
            <FormField label="Image URL fallback">
              <input
                className={fieldControlClassName()}
                data-testid="admin-driver-create-image-url"
                name="image_url"
                type="url"
              />
            </FormField>
          </Disclosure>

          <div className="md:col-span-5 flex items-end justify-between gap-3">
            <label className="inline-flex items-center gap-2 text-sm text-slate-700">
              <input defaultChecked name="is_active" type="checkbox" />
              Active
            </label>
            <SubmitButton
              className={actionControlClassName("primary")}
              data-testid="admin-driver-create-submit"
              pendingLabel="Adding..."
            >
              Add driver
            </SubmitButton>
          </div>
        </form>
        <p className="mt-2 text-xs text-slate-600">
          Manually added drivers start at 0 championship points and are auto-ranked to the bottom
          on refresh.
        </p>

        <div className="mt-5 grid gap-3">
          {drivers.length === 0 ? (
            <EmptyState
              description="Add the first driver above or import the preseason opening seed."
              title="No drivers yet"
            />
          ) : (
            drivers.map((driver) => (
              <details key={driver.id} className="rounded-md ui-panel border border-slate-200 bg-white">
                <summary className="cursor-pointer px-3 py-3">
                  <div className="inline-flex w-full flex-wrap items-center justify-between gap-3 align-middle">
                    <div className="flex min-w-0 items-center gap-3">
                    {driver.image_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        alt={driver.driver_name}
                        className="h-10 w-10 rounded-full ui-control-border border border-slate-300 object-cover"
                        src={driver.image_url}
                      />
                    ) : (
                      <div className="flex h-10 w-10 items-center justify-center rounded-full border border-dashed border-slate-400 text-[10px] font-semibold text-slate-500">
                        IMG
                      </div>
                    )}
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-slate-900">{driver.driver_name}</p>
                        <p className="text-xs text-slate-500">
                          Group {driver.group_number} · Rank #{driver.current_standing} · {driver.championship_points} pts
                        </p>
                      </div>
                    </div>
                    <StatusChip tone={driver.is_active ? "success" : "neutral"}>
                      {driver.is_active ? "Active" : "Inactive"}
                    </StatusChip>
                  </div>
                </summary>

                <div className="grid gap-2 border-t border-slate-200 p-3 md:grid-cols-12">
                  <form
                    action={updateDriverAction}
                    className="grid gap-2 md:col-span-11 md:grid-cols-10"
                    data-testid={`admin-driver-edit-form-${driver.id}`}
                  >
                    <input name="driver_id" type="hidden" value={String(driver.id)} />
                    <input name="tab" type="hidden" value="drivers" />

                    <FormField className="md:col-span-3" label="Driver name">
                      <input
                        required
                        className={fieldControlClassName("px-2 py-2")}
                        defaultValue={driver.driver_name}
                        maxLength={100}
                        name="driver_name"
                        type="text"
                      />
                    </FormField>

                    <FormField className="md:col-span-2" label="Replace image">
                      <input
                        accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
                        className={fieldControlClassName("px-2 py-2 text-xs")}
                        name="image_file"
                        type="file"
                      />
                    </FormField>

                    <FormField className="md:col-span-3" label="Image URL fallback">
                      <input
                        className={fieldControlClassName("px-2 py-2")}
                        defaultValue={driver.image_url ?? ""}
                        name="image_url"
                        type="url"
                      />
                    </FormField>

                    <label className="inline-flex min-h-11 items-center gap-2 self-end text-sm text-slate-700 md:col-span-1">
                      <input defaultChecked={driver.is_active} name="is_active" type="checkbox" />
                      Active
                    </label>

                    <SubmitButton
                      className={actionControlClassName("primary", "w-full self-end px-2 py-2 md:col-span-1")}
                      data-testid={`admin-driver-save-${driver.id}`}
                      pendingLabel="Saving..."
                    >
                      Save
                    </SubmitButton>
                  </form>

                  <form action={deleteDriverAction} className="md:col-span-1 flex md:justify-end">
                    <input name="driver_id" type="hidden" value={String(driver.id)} />
                    <input name="tab" type="hidden" value="drivers" />
                    <ConfirmSubmitButton
                      className="rounded-md border border-red-300 px-2 py-2 text-xs font-semibold text-red-700 hover:bg-red-50"
                      confirmMessage={`Delete ${driver.driver_name}? This cannot be undone.`}
                      data-testid={`admin-driver-delete-${driver.id}`}
                      formNoValidate
                      type="submit"
                    >
                      Delete
                    </ConfirmSubmitButton>
                  </form>
                </div>
              </details>
            ))
          )}
        </div>
        </section>
  );
}
