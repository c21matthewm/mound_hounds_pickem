"use client";

import { useActionState, useState } from "react";
import { bulkUpdateParticipantsAction } from "@/app/admin/participant-bulk-actions";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { FormField, actionControlClassName, fieldControlClassName } from "@/components/ui-primitives";
import { initialParticipantBulkState, type ParticipantBulkExpected, type ParticipantBulkOperation } from "@/lib/admin-participant-bulk";

export function AdminParticipantBulkControls({ participants, selectedSeason, onComplete, onClear }: {
  participants: ParticipantBulkExpected[];
  selectedSeason: { id: number; seasonYear: number } | null;
  onComplete: () => void;
  onClear: () => void;
}) {
  const [operation, setOperation] = useState<ParticipantBulkOperation>("enable");
  const [state, formAction, pending] = useActionState(async (previous: typeof initialParticipantBulkState, form: FormData) => {
    const result = await bulkUpdateParticipantsAction(previous, form);
    if (result.ok) onComplete();
    return result;
  }, initialParticipantBulkState);
  const enrollment = operation === "register" || operation === "decline";
  const labels = { enable: "Enable participation", disable: "Disable participation", register: `Register for ${selectedSeason?.seasonYear ?? "selected season"}`, decline: `Mark declined for ${selectedSeason?.seasonYear ?? "selected season"}` };
  return <form action={formAction} className="mt-4 rounded-md border border-slate-200 p-3">
    <input name="participants" type="hidden" value={JSON.stringify(participants)} />
    <input name="participant_season_id" type="hidden" value={selectedSeason?.id ?? ""} />
    <input name="confirm_bulk_update" type="hidden" value="yes" />
    <fieldset disabled={pending} className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
      <legend className="mb-2 text-sm font-semibold text-slate-800">Selected accounts ({participants.length}/100)</legend>
      <FormField label="Action for selected accounts">
        <select aria-label="Action for selected accounts" name="operation" value={operation} onChange={event => setOperation(event.target.value as ParticipantBulkOperation)} className={fieldControlClassName()}>
          <option value="enable">Enable participation</option>
          <option value="disable">Disable participation</option>
          <option value="register" disabled={!selectedSeason}>{labels.register}</option>
          <option value="decline" disabled={!selectedSeason}>{labels.decline}</option>
        </select>
      </FormField>
      <ConfirmSubmitButton className={actionControlClassName("primary", "self-end")} disabled={participants.length === 0 || (enrollment && !selectedSeason)} pendingLabel="Applying..."
        confirmMessage={`${labels[operation]} for ${participants.length} selected account${participants.length === 1 ? "" : "s"}? ${enrollment ? "Only the selected season will be changed." : "Account eligibility applies across seasons. Admin roles are unchanged."} Accounts with submitted picks cannot be disabled or marked declined here. If any account fails validation, none of the changes will be saved.`}>
        Apply to selected
      </ConfirmSubmitButton>
      <button className={actionControlClassName("secondary", "self-end")} type="button" onClick={onClear} disabled={participants.length === 0}>Clear selection</button>
    </fieldset>
    <p className="mt-2 text-xs text-slate-600">Select one account for an individual season decision, or up to 100 for a bulk update. Removal with submitted picks requires individual review below.</p>
    {state.message ? <p role={state.ok ? "status" : "alert"} className={`mt-3 rounded-md border p-3 text-sm ${state.ok ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-amber-200 bg-amber-50 text-amber-900"}`}>{state.message}</p> : null}
  </form>;
}
