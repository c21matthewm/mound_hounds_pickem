import Link from "next/link";
import { redirect } from "next/navigation";
import { SignOutButton } from "@/components/sign-out-button";
import { isProfileComplete, type ProfileRow } from "@/lib/profile";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const RULES_PDF_PATH = "/docs/2026-mound-hounds-rules-and-regulations.pdf";

export default async function RulesPage() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("id,full_name,team_name,phone_number,phone_carrier,role")
    .eq("id", user.id)
    .maybeSingle<ProfileRow>();

  if (!profile || !isProfileComplete(profile)) {
    redirect("/onboarding");
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-[1200px] flex-col px-6 py-10">
      <header className="relative flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="inline-flex rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-blue-700">
            League Docs
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight">Rules & Regulations</h1>
          <p className="mt-2 text-sm text-slate-600">
            Official Mound Hounds Pick&apos;em league rules for this season.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Link
            className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
            href="/dashboard"
          >
            Dashboard
          </Link>
          <Link
            className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
            href="/picks"
          >
            Pick&apos;em Form
          </Link>
          <Link
            className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
            href="/leaderboard"
          >
            Leaderboard
          </Link>
          <SignOutButton />
        </div>
      </header>

      <section className="mt-6 rounded-lg border border-slate-200 bg-white p-6">
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

        <div className="mt-4 h-[70vh] overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
          <iframe
            className="h-full w-full"
            src={`${RULES_PDF_PATH}#view=FitH`}
            title="Mound Hounds Pick'em Rules and Regulations"
          />
        </div>
      </section>
    </main>
  );
}
