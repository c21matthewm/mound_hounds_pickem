import Link from "next/link";
import { AuthenticatedPageShell } from "@/components/authenticated-page-shell";
import { StatusChip } from "@/components/ui-primitives";
import { requireAppUser } from "@/lib/authenticated-user";

const destinations = [
  {
    description: "Official season rules and regulations.",
    href: "/rules",
    label: "Rules"
  },
  {
    description: "Report a bug or suggest an improvement.",
    href: "/feedback",
    label: "Feedback"
  },
  {
    description: "Email the league administrator for direct help.",
    href: "/contact-admin",
    label: "Contact Admin"
  }
];

export default async function MorePage() {
  const { profile } = await requireAppUser({
    requireSeasonDecision: true
  });

  return (
    <AuthenticatedPageShell
      description="League information and support."
      eyebrow="More"
      maxWidth="max-w-3xl"
      title="League Menu"
    >
      <nav aria-label="League menu" className="mt-6 grid gap-2.5 sm:grid-cols-2 sm:gap-3">
        {destinations.map((destination) => (
          <Link
            className="ui-panel flex min-h-24 items-center justify-between gap-4 rounded-lg border border-slate-200 bg-white p-3.5 shadow-sm hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-md sm:min-h-28 sm:p-4"
            href={destination.href}
            key={destination.href}
          >
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-slate-950">
                {destination.label}
              </span>
              <span className="mt-0.5 block text-sm text-slate-600">
                {destination.description}
              </span>
            </span>
            <span aria-hidden className="shrink-0 text-lg text-slate-400">
              →
            </span>
          </Link>
        ))}
        {profile.role === "admin" ? (
          <Link
            className="ui-panel flex min-h-24 items-center justify-between gap-4 rounded-lg border border-slate-200 bg-white p-3.5 shadow-sm hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-md sm:min-h-28 sm:p-4"
            href="/admin"
          >
            <span className="min-w-0">
              <span className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold text-slate-950">Admin Dashboard</span>
                <StatusChip tone="info">Admin</StatusChip>
              </span>
              <span className="mt-0.5 block text-sm text-slate-600">
                Manage drivers, participants, races, results, and system health.
              </span>
            </span>
            <span aria-hidden className="shrink-0 text-lg text-slate-400">
              →
            </span>
          </Link>
        ) : null}
      </nav>
    </AuthenticatedPageShell>
  );
}
