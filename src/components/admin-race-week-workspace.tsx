import type { ReactNode } from "react";
import Link from "next/link";
import type { RaceRow, WinnerProfileRow, DriverRow, RaceDriverGroupRow } from "@/app/admin/admin-types";
import { formatDateTime, formatDateTimeLocalInput } from "@/app/admin/admin-data";
import { correctPickWindowQualifyingStartAction, setRaceWinnerAction } from "@/app/admin/race-actions";
import { AdminWorkspaceHeader, EmptyState, StatusChip, actionControlClassName, fieldControlClassName } from "@/components/ui-primitives";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { AdminIndyQualifying } from "@/components/admin-indy-qualifying";
import { RacePickDeadline } from "@/components/race-pick-deadline";
import { AdminRaceFieldPreview } from "@/components/admin-race-field-preview";
import { freezeRaceFieldAction } from "@/app/admin/race-week-actions";
import { RACE_WEEK_PHASES, raceFieldFreezeState, type RaceWeekPhase } from "@/lib/admin-race-week";
import { pickLockAtForRace } from "@/lib/race-format";
const labels: Record<RaceWeekPhase, string> = {preparation: "Preparation & deadline", picks: "Picks & reminders", results: "Results & audit", winner: "Winner finalization"};
type Props = {drivers: DriverRow[]; snapshot: RaceDriverGroupRow[]; currentTime: number; race: RaceRow|null; races: RaceRow[]; phase: RaceWeekPhase; children?: ReactNode; participants: WinnerProfileRow[]; teamNameByProfileId: Map<string,string>};
export function AdminRaceWeekWorkspace({drivers, snapshot, currentTime, race, races, phase, children, participants, teamNameByProfileId}: Props) {
  const fieldState = race ? raceFieldFreezeState(race, races, currentTime) : null;
  return <section className="mt-6 min-w-0">
    <AdminWorkspaceHeader title="Race Week" description="Prepare the field, monitor picks, publish results, and confirm the fantasy winner." />
    {!race ? <EmptyState title="No races scheduled" description="Prepare the season and add the race calendar to start weekly operations." action={<Link className={actionControlClassName("primary")} href="/admin?tab=seasons">Open Seasons & League</Link>} /> : <>
      <form action="/admin" method="get" className="mt-4 flex min-w-0 flex-wrap items-end gap-2">
        <input name="tab" type="hidden" value="race-week" />
        <label className="min-w-0 flex-1"><span className="mb-1 block text-sm font-semibold">Race</span><select name="result_race_id" defaultValue={race.id} className={fieldControlClassName()}>{races.map(option => <option value={option.id} key={option.id}>R{option.round_number} · {option.race_name} · {option.results_status === "published" ? "Published" : "Awaiting results"}</option>)}</select></label>
        <button type="submit" className={actionControlClassName("secondary")}>Open race</button>
      </form>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-slate-600"><p>Picks lock {formatDateTime(pickLockAtForRace(race))}</p><RacePickDeadline key={race.id} deadline={pickLockAtForRace(race)} initialTime={currentTime} /><StatusChip tone={race.results_status === "published" ? "success" : "neutral"}>{race.results_status === "published" ? "Results published" : "Results not published"}</StatusChip></div>
      <nav aria-label="Race week stages" className="mt-5"><ol className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">{RACE_WEEK_PHASES.map((stage, index) => <li key={stage}><Link aria-current={phase === stage ? "step" : undefined} className={`flex h-full items-center gap-2 rounded-lg border px-3 py-3 text-sm font-semibold ${phase === stage ? "border-cyan-700 bg-cyan-50 text-cyan-950" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"}`} href={`/admin?tab=race-week&result_race_id=${race.id}&phase=${stage}`}><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-current text-xs">{index+1}</span>{labels[stage]}</Link></li>)}</ol></nav>
      <div className="mt-5 min-w-0 rounded-lg border border-slate-200 bg-white p-4 sm:p-6"><h2 className="text-lg font-semibold">{labels[phase]}</h2>
        {phase === "preparation" ? <>
          <p className="mt-2 text-sm text-slate-600">{race.field_frozen_at ? `Field frozen ${formatDateTime(race.field_frozen_at)}. Picks use this saved field even when the driver standings change.` : "The field freezes when this pick window opens through the pick form or reminder workflow. Confirm the roster and prior results first."}</p>
          <Link className="mt-3 inline-block text-sm font-semibold text-cyan-800 underline" href="/admin?tab=drivers">Review drivers and groups</Link>
          <form action={freezeRaceFieldAction} className="mt-4 grid gap-3 rounded-lg border border-slate-200 p-4">
            <h3 className="font-semibold">Save the pick field</h3>
            <p id="field-freeze-readiness" className="text-sm text-slate-600">{fieldState?.message}</p>
            <input name="race_id" type="hidden" value={race.id} />
            <input name="confirm_field_freeze" type="hidden" value="yes" />
            <ConfirmSubmitButton aria-describedby="field-freeze-readiness" className={actionControlClassName("primary")} disabled={fieldState?.disabled} confirmMessage="Freeze the current field for every race sharing this pick window? Picks will use these saved groups even after the driver standings change." pendingLabel="Freezing field...">Freeze field now</ConfirmSubmitButton>
          </form>
          <AdminRaceFieldPreview race={race} drivers={drivers} snapshot={snapshot} />
          {race.pick_format === "indy_500" ? <AdminIndyQualifying race={race} /> : <form action={correctPickWindowQualifyingStartAction} className="mt-5 grid gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4">
            <h3 className="font-semibold">Official qualifying time correction</h3><p className="text-sm text-slate-600">For an official schedule change, update the qualifying deadline for every race sharing this pick window. Sent reminders remain recorded.</p>
            <input name="race_id" type="hidden" value={race.id} /><input name="tab" type="hidden" value="race-week" />
            <label><span className="mb-1 block text-sm font-semibold">Corrected qualifying start</span><input required name="qualifying_start_at" type="datetime-local" className={fieldControlClassName()} defaultValue={formatDateTimeLocalInput(race.qualifying_start_at)} /></label>
            <label className="flex items-start gap-2 text-sm"><input required type="checkbox" name="confirm_schedule_correction" className="mt-1" />I confirm the official qualifying time changed.</label>
            <ConfirmSubmitButton className={actionControlClassName("secondary")} confirmMessage="Update the official qualifying deadline for this pick window?" pendingLabel="Updating...">Update deadline</ConfirmSubmitButton>
          </form>}
        </> : phase === "winner" ? <>
          <p className="mt-2 break-words text-sm text-slate-700">{race.winner_profile_id ? `Fantasy winner: ${teamNameByProfileId.get(race.winner_profile_id) ?? "Saved winner"}${race.winner_is_manual_override ? " (manual override)" : ""}.` : race.results_status === "published" ? "No fantasy winner has been saved yet." : "Publish the full race results and official winning speed before finalizing the winner."}</p>
          <p className="mt-2 text-sm text-slate-600">Publishing results already calculates the winner immediately. Use these controls to retry a failed calculation or apply a league decision.</p>
          <form action={setRaceWinnerAction} className="mt-4"><input name="tab" type="hidden" value="race-week" /><input name="race_id" type="hidden" value={race.id} /><input name="winner_profile_id" type="hidden" value="" /><ConfirmSubmitButton className={actionControlClassName("primary")} disabled={race.results_status !== "published"} confirmMessage={race.winner_is_manual_override ? "Replace the manual winner with the calculated winner?" : "Recalculate and save this race's fantasy winner?"} pendingLabel="Calculating...">Calculate winner now</ConfirmSubmitButton></form>
          <details className="mt-5 rounded-lg border border-slate-200"><summary className="cursor-pointer p-3 text-sm font-semibold">Manual winner override</summary><form action={setRaceWinnerAction} className="grid gap-3 border-t border-slate-200 p-3"><input name="tab" type="hidden" value="race-week" /><input name="race_id" type="hidden" value={race.id} /><label><span className="mb-1 block text-sm font-semibold">Registered participant</span><select required name="winner_profile_id" defaultValue={race.winner_profile_id ?? ""} className={fieldControlClassName()}><option value="">Choose a winner</option>{participants.map(p => <option key={p.id} value={p.id}>{p.team_name}</option>)}</select></label><ConfirmSubmitButton className={actionControlClassName("secondary")} disabled={race.results_status !== "published"} confirmMessage="Override the calculated fantasy winner with the selected participant?" pendingLabel="Saving...">Save manual winner</ConfirmSubmitButton></form></details>
        </> : children}
      </div>
    </>}
  </section>;
}
