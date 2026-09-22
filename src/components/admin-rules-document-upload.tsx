"use client";

import { useActionState, useId, useState } from "react";
import { uploadSeasonRulesDocumentAction } from "@/app/admin/rules-document-actions";
import { rulesPdfMetadataError, type RulesUploadState } from "@/lib/season-rules";

const initialState: RulesUploadState = { status: "idle", message: "" };

export function AdminRulesDocumentUpload({ seasonId, seasonYear, currentUrl }: {
  seasonId: number; seasonYear: number; currentUrl: string | null;
}) {
  const id = useId();
  const [state, action, pending] = useActionState(uploadSeasonRulesDocumentAction, initialState);
  const [fileError, setFileError] = useState<string | null>(null);
  const [hasFile, setHasFile] = useState(false);
  return <form action={action} className="w-full min-w-0 space-y-2 rounded-md border border-slate-200 bg-slate-50 p-3"
    onSubmit={event => { if (fileError || !hasFile || pending) event.preventDefault(); }}>
    <input name="season_id" type="hidden" value={seasonId} />
    <input name="expected_rules_document_url" type="hidden" value={currentUrl ?? ""} />
    <label htmlFor={id} className="block text-sm font-semibold text-slate-800">Upload {seasonYear} rules PDF</label>
    <p id={`${id}-help`} className="text-xs text-slate-600">PDF, up to 5 MB. Uploading publishes the document to participants. Previous PDFs remain available to existing links.</p>
    <input id={id} name="rules_pdf" type="file" accept=".pdf,application/pdf" required disabled={pending}
      aria-describedby={`${id}-help${fileError ? ` ${id}-error` : ""}`} aria-invalid={!!fileError}
      className="block w-full min-w-0 max-w-full text-xs text-slate-700 file:mr-2 file:rounded file:border file:border-slate-300 file:bg-white file:px-3 file:py-2"
      onChange={event => {
        const file = event.target.files?.[0];
        setHasFile(!!file); setFileError(file ? rulesPdfMetadataError(file) : null);
      }} />
    {fileError ? <p id={`${id}-error`} role="alert" className="text-sm text-red-800">{fileError}</p> : null}
    <button disabled={pending || !hasFile || !!fileError} type="submit" className="rounded-md bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-700 disabled:opacity-50">
      {pending ? "Uploading and saving…" : "Upload and publish PDF"}
    </button>
    {state.status !== "idle" ? <p role={state.status === "error" ? "alert" : "status"} className={`break-words text-sm ${state.status === "error" ? "text-red-800" : "text-emerald-800"}`}>{state.message}</p> : null}
  </form>;
}
