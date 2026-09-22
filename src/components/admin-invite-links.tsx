"use client";
import { useState } from "react";
import { buildSeasonInviteLink } from "@/lib/season-invite-links";
import { actionControlClassName, fieldControlClassName } from "@/components/ui-primitives";
export function AdminInviteLinks({siteOrigin}: {siteOrigin: string}) {
  const [code, setCode] = useState("");
  const [destination, setDestination] = useState<"signup" | "season-registration">("signup");
  const [status, setStatus] = useState("");
  const [fallbackLink, setFallbackLink] = useState("");
  const link = buildSeasonInviteLink(siteOrigin, destination, code);
  return <section className="mt-5 rounded-lg border border-slate-200 bg-white p-4 sm:p-6">
    <h3 className="font-semibold text-slate-900">Share registration</h3>
    <p className="mt-1 text-sm text-slate-600">Enter the current private invite code to create a prefilled link. Saved codes cannot be retrieved; set a new code above if needed. Share links only with league members.</p>
    <div className="mt-4 grid gap-3 sm:grid-cols-2">
      <label><span className="mb-1 block text-sm font-semibold">Current invite code</span><input type="password" autoComplete="off" autoCapitalize="none" className={fieldControlClassName()} minLength={8} maxLength={64} value={code} onChange={event => {setCode(event.target.value); setStatus(""); setFallbackLink("");}} /></label>
      <label><span className="mb-1 block text-sm font-semibold">Link for</span><select className={fieldControlClassName()} value={destination} onChange={event => {setDestination(event.target.value as typeof destination); setStatus(""); setFallbackLink("");}}><option value="signup">New members creating an account</option><option value="season-registration">Existing members joining the season</option></select></label>
    </div>
    <button type="button" className={actionControlClassName("secondary", "mt-3")} disabled={!link} onClick={async () => {
      if (!link) return;
      try {await navigator.clipboard.writeText(link); setStatus("Registration link copied."); setFallbackLink("");}
      catch {setFallbackLink(link); setStatus("Select and copy the link below.");}
    }}>Copy registration link</button>
    <p role="status" className="mt-2 text-sm text-slate-600">{status}</p>
    {fallbackLink ? <label className="mt-2 block"><span className="text-sm font-semibold">Private registration link</span><input readOnly className={fieldControlClassName()} value={fallbackLink} onFocus={event => event.currentTarget.select()} /></label> : null}
  </section>;
}
