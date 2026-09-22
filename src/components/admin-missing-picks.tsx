"use client";
import { useState } from "react";
import { actionControlClassName } from "@/components/ui-primitives";
export function AdminMissingPicks({participants, total, emailWarning}: {participants: Array<{id: string; teamName: string; email: string|null}>; total: number; emailWarning: string|null}) {
  const [message, setMessage] = useState("");
  const [showCopy, setShowCopy] = useState(false);
  const emails = Array.from(new Set(participants.flatMap(row => row.email ? [row.email] : []))).join("; ");
  const submitted = Math.max(0, total - participants.length);
  return <section className="mt-4 rounded-lg border border-slate-200 bg-white p-4">
    <h3 className="font-semibold">Pick submissions</h3>
    <p className="mt-1 text-sm text-slate-600">{submitted} of {total} registered teams have submitted every form for this pick window.</p>
    {total > 0 ? <progress className="mt-3 h-3 w-full accent-cyan-700" aria-label="Teams with all picks submitted" value={submitted} max={total} /> : <p className="mt-2 text-sm text-slate-600">No eligible teams are registered for this season yet.</p>}
    {emailWarning ? <p className="mt-2 text-sm text-amber-800">{emailWarning}</p> : null}
    {participants.length ? <>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-semibold">Missing at least one form ({participants.length})</p><button type="button" className={actionControlClassName("secondary")} disabled={!emails} onClick={async () => {try {await navigator.clipboard.writeText(emails); setMessage("Missing participant emails copied. Use Bcc for a group email.");} catch {setShowCopy(true); setMessage("Select and copy the addresses below. Use Bcc for a group email.");}}}>Copy missing emails</button></div>
      <ul className="mt-2 max-h-80 overflow-y-auto divide-y divide-slate-100">{participants.map(row => <li className="py-2 text-sm" key={row.id}><p className="break-words font-semibold">{row.teamName}</p><p className="break-all text-slate-600">{row.email ?? "Email unavailable"}</p></li>)}</ul>
    </> : total > 0 ? <p className="mt-3 text-sm font-semibold text-emerald-800">Everyone has submitted their picks.</p> : null}
    <p role="status" className="mt-2 text-sm text-slate-600">{message}</p>
    {showCopy ? <textarea aria-label="Missing participant emails" readOnly className="mt-2 w-full rounded border p-2 text-sm" value={emails} onFocus={event => event.currentTarget.select()} /> : null}
  </section>;
}
