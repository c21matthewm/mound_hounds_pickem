import Link from "next/link";
import { AuthenticatedPageShell } from "@/components/authenticated-page-shell";
import { MobileBottomNav } from "@/components/mobile-bottom-nav";
import { SignOutButton } from "@/components/sign-out-button";
import { requireAppUser } from "@/lib/authenticated-user";

const RULES_PDF_PATH = "/docs/2026-mound-hounds-rules-and-regulations.pdf";

export default async function RulesPage() {
  await requireAppUser({ requireSeasonDecision: true });

  return (
    <AuthenticatedPageShell
      actions={
        <>
          <Link
            className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
            href="/dashboard"
          >
            Dashboard
          </Link>
          <SignOutButton className="static" />
        </>
      }
      description="Official Mound Hounds Pick'em league rules for this season."
      eyebrow="League Docs"
      maxWidth="max-w-[1200px]"
      title="Rules & Regulations"
    >

      <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-slate-700">
            The PDF is shown inline below. If your browser blocks inline PDF display, open it
            directly in a new tab.
          </p>
          <a
            className="rounded-md bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-700"
            href={RULES_PDF_PATH}
            rel="noreferrer"
            target="_blank"
          >
            Open PDF in new tab
          </a>
        </div>

        <div className="mt-4 h-[70vh] overflow-hidden rounded-2xl border border-slate-200 bg-slate-50">
          <iframe
            className="h-full w-full"
            src={`${RULES_PDF_PATH}#view=FitH`}
            title="Mound Hounds Pick'em Rules and Regulations"
          />
        </div>
      </section>
      <MobileBottomNav />
    </AuthenticatedPageShell>
  );
}
