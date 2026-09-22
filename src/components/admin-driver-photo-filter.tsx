"use client";

import { useState, type ReactNode } from "react";
import { bulkUpdateDriverRosterAction } from "@/app/admin/driver-bulk-actions";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { actionControlClassName, fieldControlClassName } from "@/components/ui-primitives";

type DriverPhotoEntry = { driverName: string; isActive: boolean; id: number; missingPhoto: boolean; content: ReactNode };

export function AdminDriverPhotoFilter({ entries }: { entries: DriverPhotoEntry[] }) {
  const [missingOnly, setMissingOnly] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [operation, setOperation] = useState("activate");
  const visible = entries.filter(entry => !missingOnly || entry.missingPhoto);
  const selectedRows = entries.filter(entry => selected.has(entry.id));
  const hiddenCount = selectedRows.filter(entry => missingOnly && !entry.missingPhoto).length;
  const toggle = (id: number) => setSelected(previous => {
    const next = new Set(previous);
    if (next.has(id)) next.delete(id); else if (next.size < 100) next.add(id);
    return next;
  });
  const missingCount = entries.filter((entry) => entry.missingPhoto).length;
  return (
    <div>
      <form action={bulkUpdateDriverRosterAction} className="mb-4 grid gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
        <h3 className="text-sm font-semibold">Update selected drivers</h3>
        <p className="text-xs text-slate-600">Change up to 100 drivers together. Current groups refresh; saved race fields, picks and results remain intact.</p>
        <input type="hidden" name="selected_drivers" value={JSON.stringify(selectedRows.map(entry => ({id:entry.id,expected_is_active:entry.isActive})))} />
        <div className="flex flex-wrap items-end gap-2">
          <label className="min-w-0 flex-1"><span className="mb-1 block text-xs font-semibold">Roster action</span><select name="operation" className={fieldControlClassName()} value={operation} onChange={event=>setOperation(event.target.value)}><option value="activate">Mark active</option><option value="deactivate">Mark inactive</option></select></label>
          <ConfirmSubmitButton className={actionControlClassName("primary")} disabled={!selectedRows.length} confirmMessage={`Mark ${selectedRows.length} selected drivers ${operation === "activate" ? "active" : "inactive"}? Current groups will refresh. Saved race fields are preserved.`} pendingLabel="Updating roster...">Apply to selected</ConfirmSubmitButton>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <button className="font-semibold text-cyan-800 underline" type="button" onClick={() => setSelected(new Set(visible.slice(0,100).map(entry => entry.id)))}>Select shown{visible.length > 100 ? " (first 100)" : ""}</button>
          <button className="font-semibold text-cyan-800 underline" type="button" onClick={() => setSelected(new Set())}>Clear selection</button>
          <p aria-live="polite">{selectedRows.length} selected{hiddenCount ? ` · ${hiddenCount} hidden by photo filter` : ""}</p>
        </div>
      </form>
      <fieldset className="mb-3 flex flex-wrap gap-2">
        <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-600">Driver photos</legend>
        {[{ label: `All drivers (${entries.length})`, value: false }, { label: `Missing photos (${missingCount})`, value: true }].map((option) => (
          <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700" key={String(option.value)}>
            <input checked={missingOnly === option.value} name="driver-photo-filter" onChange={() => setMissingOnly(option.value)} type="radio" />
            {option.label}
          </label>
        ))}
      </fieldset>
      <p aria-live="polite" className="mb-3 text-xs text-slate-500">
        {missingOnly && missingCount === 0 ? "Every driver has a photo." : `Showing ${missingOnly ? missingCount : entries.length} of ${entries.length} drivers.`}
      </p>
      <div className="grid gap-3">
        {entries.map((entry) => <div hidden={missingOnly && !entry.missingPhoto} key={entry.id}>
          <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-2">
            <label className="flex min-h-11 w-8 items-start justify-center pt-4"><input type="checkbox" checked={selected.has(entry.id)} disabled={!selected.has(entry.id) && selected.size >= 100} onChange={() => toggle(entry.id)} aria-label={`Select ${entry.driverName}`} /></label>
            {entry.content}
          </div>
        </div>)}
      </div>
    </div>
  );
}
