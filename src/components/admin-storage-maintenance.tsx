"use client";

import { useActionState } from "react";
import { auditStorageImagesAction, type StorageMediaAuditState } from "@/app/admin/storage-maintenance-actions";
import { actionControlClassName } from "@/components/ui-primitives";

const INITIAL_STATE: StorageMediaAuditState = { audit: null, error: null };
const formatBytes = (bytes: number) => bytes >= 1024 * 1024
  ? `${(bytes / (1024 * 1024)).toFixed(2)} MB`
  : `${(bytes / 1024).toFixed(1)} KB`;

export function AdminStorageMaintenance() {
  const [state, formAction, pending] = useActionState(auditStorageImagesAction, INITIAL_STATE);
  return (
    <section aria-labelledby="storage-maintenance-title" className="mt-6 rounded-lg border border-slate-200 bg-slate-50 p-4">
      <h3 className="text-base font-semibold text-slate-900" id="storage-maintenance-title">Storage media maintenance</h3>
      <p className="mt-1 text-sm text-slate-600">
        Review driver headshots and race banners against the current league and saved recovery points.
        This audit identifies files to review and does not delete images.
      </p>
      <form action={formAction} className="mt-3">
        <button className={actionControlClassName("secondary", "disabled:opacity-50")} disabled={pending} type="submit">
          {pending ? "Auditing media…" : state.audit ? "Run audit again" : "Audit storage images"}
        </button>
      </form>
      <div aria-busy={pending} aria-live="polite" className="mt-3 text-sm">
        {pending ? <p className="text-slate-600">Checking stored files and recovery references…</p> : null}
        {state.error && !pending ? <p className="rounded-md border border-red-200 bg-red-50 p-3 text-red-800" role="alert">{state.error}</p> : null}
        {state.audit && !pending ? (
          <div className="space-y-4">
            <p className="text-slate-600">
              Audit complete. Checked {state.audit.restorePointCount} saved recovery {state.audit.restorePointCount === 1 ? "point" : "points"}.
              Files used only by recovery points are kept in the referenced counts.
            </p>
            <div className="grid min-w-0 gap-3 lg:grid-cols-2">
              {state.audit.buckets.map((bucket) => (
                <div className="min-w-0 rounded-md border border-slate-200 bg-white p-3" key={bucket.bucket}>
                  <h4 className="font-semibold text-slate-900">{bucket.bucket === "driver-headshots" ? "Driver headshots" : "Race banners"}</h4>
                  <dl className="mt-2 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                    {[ ["Stored files", bucket.storedCount], ["In current use", bucket.currentReferenceCount], ["Recovery only", bucket.recoveryOnlyCount], ["Unreferenced", bucket.unreferencedCount] ].map(([label, value]) => (
                      <div key={label}><dt className="text-slate-500">{label}</dt><dd className="mt-1 text-base font-semibold tabular-nums text-slate-900">{value}</dd></div>
                    ))}
                  </dl>
                  {bucket.missingReferenceCount > 0 ? <p className="mt-3 text-amber-800">{bucket.missingReferenceCount} referenced {bucket.missingReferenceCount === 1 ? "image is" : "images are"} missing from storage. Check current images and recovery needs before making changes.</p> : null}
                  {bucket.unreferencedCount > 0 ? (
                    <>
                      <p className="mt-3 text-slate-600">Unreferenced file size: {formatBytes(bucket.unreferencedBytes)}{bucket.unknownSizeCount > 0 ? `; size unavailable for ${bucket.unknownSizeCount} ${bucket.unknownSizeCount === 1 ? "file" : "files"}` : ""}.</p>
                      <details className="mt-2">
                        <summary className="cursor-pointer py-2 font-semibold text-slate-700">Review file paths</summary>
                        {bucket.candidates.length < bucket.unreferencedCount ? <p className="mb-2 text-xs text-slate-500">Showing the first {bucket.candidates.length} of {bucket.unreferencedCount} files.</p> : null}
                        <ul className="max-h-64 space-y-2 overflow-y-auto rounded-md bg-slate-50 p-2 text-xs">
                          {bucket.candidates.map((file) => <li className="break-all font-mono" key={file.path}>{file.path} <span className="font-sans text-slate-500">({file.bytes === null ? "size unavailable" : formatBytes(file.bytes)})</span></li>)}
                        </ul>
                      </details>
                    </>
                  ) : <p className="mt-3 text-slate-600">No unreferenced files found.</p>}
                </div>
              ))}
            </div>
            <p className="text-xs text-slate-500">An unreferenced file may still be needed by an upload in progress or a downloaded backup. Review those uses before arranging a separate cleanup.</p>
          </div>
        ) : null}
      </div>
    </section>
  );
}
