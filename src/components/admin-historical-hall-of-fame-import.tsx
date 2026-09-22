"use client";

import Link from "next/link";
import { useActionState, useId, useMemo, useState } from "react";
import { importHistoricalHallOfFameAction } from "@/app/admin/historical-hall-of-fame-actions";
import {
  HISTORICAL_IMPORT_LIMITS,
  parseHistoricalHallOfFameImport,
  type HistoricalImportActionState
} from "@/lib/hall-of-fame-import";

const initialState: HistoricalImportActionState = { status: "idle", message: "" };
const fieldClass = "mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm ui-control-border";

export function AdminHistoricalHallOfFameImport({ archivedYears }: { archivedYears: number[] }) {
  const id = useId();
  const [seasonYear, setSeasonYear] = useState("");
  const [raceCount, setRaceCount] = useState("");
  const [spreadsheet, setSpreadsheet] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [state, action, pending] = useActionState(importHistoricalHallOfFameAction, initialState);
  const preview = useMemo(() => parseHistoricalHallOfFameImport({ seasonYear, raceCount, spreadsheet }), [seasonYear, raceCount, spreadsheet]);
  const year = preview.seasonYear;
  const alreadyArchived = year !== null && (archivedYears.includes(year) || (state.status === "success" && state.seasonYear === year));
  const hasPaste = spreadsheet.trim().length > 0;
  const canImport = hasPaste && preview.errors.length === 0 && !alreadyArchived;
  const change = (setter: (value: string) => void, value: string) => { setter(value); setConfirmed(false); };
  const champion = canImport ? preview.entries[0] : null;

  return (
    <section aria-labelledby={`${id}-title`} className="min-w-0 rounded-xl border border-slate-200 bg-white p-4 ui-panel sm:p-5">
      <h3 id={`${id}-title`} className="text-base font-semibold text-slate-900">Import a historical season</h3>
      <p className="mt-1 text-sm text-slate-600">Add the official final leaderboard from a season run outside the app. Review the preview before saving it to Hall of Fame.</p>
      <form action={action} className="mt-4 space-y-4" onSubmit={(event) => { if (!canImport || !confirmed || pending) event.preventDefault(); }}>
        <fieldset disabled={pending} className="min-w-0 space-y-4 disabled:opacity-70">
          <legend className="sr-only">Historical season details</legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <label htmlFor={`${id}-year`} className="text-sm font-medium text-slate-700">Season year
              <input className={fieldClass} id={`${id}-year`} name="season_year" type="number" min="2000" max="2100" required value={seasonYear} onChange={(event) => change(setSeasonYear, event.target.value)} />
            </label>
            <label htmlFor={`${id}-races`} className="text-sm font-medium text-slate-700">Number of races
              <input className={fieldClass} id={`${id}-races`} name="race_count" type="number" min="1" max={HISTORICAL_IMPORT_LIMITS.races} required value={raceCount} onChange={(event) => change(setRaceCount, event.target.value)} />
            </label>
          </div>
          <div>
            <label htmlFor={`${id}-paste`} className="text-sm font-medium text-slate-700">Final leaderboard</label>
            <p id={`${id}-format`} className="mt-1 text-xs leading-5 text-slate-600">Copy Rank, Team Name, and Total Points columns from Google Sheets or Excel, with or without a header. CSV works too. A movement column after Rank (such as ▲ 0) is supported. Optional race score columns must include every race, in oldest-to-newest order.</p>
            <textarea aria-describedby={`${id}-format ${id}-limits`} className={`${fieldClass} min-h-40 font-mono`} id={`${id}-paste`} name="spreadsheet_paste" maxLength={HISTORICAL_IMPORT_LIMITS.characters} required spellCheck={false} value={spreadsheet} onChange={(event) => change(setSpreadsheet, event.target.value)} placeholder={'Rank\tTeam Name\tTotal Points\n1\tExample Champion\t2500\n2\tExample Runner-up\t2450'} />
            <p id={`${id}-limits`} className="mt-1 text-xs text-slate-500">Up to 500 participants. Final places are preserved. Race columns validate totals; only final places, names, totals, and race count are stored.</p>
          </div>
          {alreadyArchived ? <p role="status" className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 ui-status-warning">{year} is already in Hall of Fame. Existing archives cannot be replaced here. <Link href={`/leaderboard?tab=hall&year=${year}`} className="font-semibold underline">View its final standings</Link>.</p> : null}
          {hasPaste && preview.errors.length > 0 ? (
            <div role="status" aria-live="polite" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800 ui-status-danger">
              <p className="font-semibold">Review these items before importing:</p>
              <ul className="mt-1 list-disc space-y-1 pl-5">{preview.errors.map((error) => <li key={error}>{error}</li>)}</ul>
            </div>
          ) : null}
          {champion ? (
            <div className="min-w-0 space-y-3">
              <p role="status" aria-live="polite" className="rounded-md bg-slate-50 p-3 text-sm text-slate-700 ui-panel-muted"><strong>{seasonYear} preview:</strong> {preview.entries.length} participants · {raceCount} races. Champion: <strong className="break-words">{champion.team_name}</strong> with {champion.total_points.toLocaleString("en-US")} points. {preview.verifiedRaceScores ? "Every race total checks out." : "No race scores supplied; verify the totals against the official sheet."}</p>
              {preview.warnings.length ? <div className="space-y-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 ui-status-warning">{preview.warnings.map((warning) => <p className="break-words" key={warning}>{warning}</p>)}</div> : null}
              <div tabIndex={0} role="region" aria-label="Final standings preview" className="max-h-80 overflow-auto rounded-md border border-slate-200 focus-visible:outline-2 focus-visible:outline-offset-2">
                <table className="w-full table-fixed text-left text-sm">
                  <caption className="sr-only">{seasonYear} final standings to be imported</caption>
                  <thead className="sticky top-0 bg-slate-50 text-slate-700 ui-table-head"><tr><th scope="col" className="w-14 p-2">Rank</th><th scope="col" className="p-2">Team</th><th scope="col" className="w-24 p-2 text-right">Points</th></tr></thead>
                  <tbody>{preview.entries.map((entry) => <tr key={entry.team_name} className="border-t border-slate-200"><td className="p-2 align-top">{entry.final_rank}</td><td className="break-words p-2 align-top [overflow-wrap:anywhere]">{entry.team_name}</td><td className="p-2 text-right align-top tabular-nums">{entry.total_points.toLocaleString("en-US")}</td></tr>)}</tbody>
                </table>
              </div>
            </div>
          ) : null}
          <label className="flex items-start gap-2 text-sm text-slate-700">
            <input className="mt-1" checked={confirmed} disabled={!canImport} name="confirm_historical_import" type="checkbox" value="yes" required onChange={(event) => setConfirmed(event.target.checked)} />
            <span>I reviewed the year, race count, every final place, and the single champion. These are the official final standings to publish.</span>
          </label>
          <button type="submit" disabled={!canImport || !confirmed || pending} className="rounded-md bg-blue-700 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">{pending ? "Importing season…" : "Import season into Hall of Fame"}</button>
        </fieldset>
        {state.status !== "idle" ? <p role={state.status === "error" ? "alert" : "status"} className={`rounded-md border p-3 text-sm ${state.status === "error" ? "border-red-200 bg-red-50 text-red-800 ui-status-danger" : "border-emerald-200 bg-emerald-50 text-emerald-800 ui-status-success"}`}>{state.message}{state.status === "success" ? <> <Link href={`/leaderboard?tab=hall&year=${state.seasonYear}`} className="font-semibold underline">View final standings</Link></> : null}</p> : null}
      </form>
    </section>
  );
}
