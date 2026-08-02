import { ActionLink } from "@/components/ui-primitives";

export default function NotFoundPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center px-5 py-12 sm:px-6">
      <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-wide text-cyan-700">Page Not Found</p>
        <h1 className="mt-2 text-2xl font-semibold text-slate-950">This page is unavailable</h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          The address may be outdated, or the page may have moved as the league season changed.
        </p>
        <div className="mt-5 flex flex-wrap gap-2">
          <ActionLink href="/dashboard">Dashboard</ActionLink>
          <ActionLink href="/login" variant="secondary">
            Sign in
          </ActionLink>
        </div>
      </section>
    </main>
  );
}
