"use client";

import { useEffect } from "react";

export default function AppError({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[app-error] Unhandled route error", {
      digest: error.digest,
      message: error.message
    });
  }, [error]);

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center px-6 py-16">
      <section className="rounded-lg border border-red-200 bg-white p-6 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-wide text-red-700">App Error</p>
        <h1 className="mt-2 text-2xl font-semibold text-slate-950">This page could not load</h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          Try the request again. If it continues, contact the league admin and include what you were
          doing when the error appeared.
        </p>
        <button
          className="mt-5 rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700"
          onClick={reset}
          type="button"
        >
          Try again
        </button>
      </section>
    </main>
  );
}
