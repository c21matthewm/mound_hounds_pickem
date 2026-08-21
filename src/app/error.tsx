"use client";

import { useEffect, useState } from "react";
import { ActionButton, ActionLink } from "@/components/ui-primitives";

export default function AppError({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const [reference, setReference] = useState<string | null>(null);

  useEffect(() => {
    console.error(
      "[app-error] Unhandled route error",
      process.env.NODE_ENV === "development"
        ? { digest: error.digest, message: error.message }
        : { digest: error.digest }
    );

    const controller = new AbortController();
    void fetch("/api/errors", {
      body: JSON.stringify({
        digest: error.digest ?? null,
        message: error.message,
        route: window.location.pathname
      }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
      signal: controller.signal
    })
      .then(async (response) => {
        if (!response.ok) return null;
        return response.json() as Promise<{ reference?: string }>;
      })
      .then((body) =>
        setReference(typeof body?.reference === "string" ? body.reference : null)
      )
      .catch(() => undefined);

    return () => controller.abort();
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
        {reference ? (
          <p className="mt-2 text-xs font-semibold text-slate-600">Reference: {reference}</p>
        ) : null}
        <div className="mt-5 flex flex-wrap gap-2">
          <ActionButton onClick={reset}>Try again</ActionButton>
          <ActionLink href="/dashboard" variant="secondary">
            Dashboard
          </ActionLink>
        </div>
      </section>
    </main>
  );
}
