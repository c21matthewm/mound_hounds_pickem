import { redirect } from "next/navigation";
import Link from "next/link";
import { MobileBottomNav } from "@/components/mobile-bottom-nav";
import { SignOutButton } from "@/components/sign-out-button";
import { MOUND_HOUND_IMAGE_PATH } from "@/lib/branding";
import { isProfileComplete, type ProfileRow } from "@/lib/profile";
import { queryStringParam } from "@/lib/query";
import { createServerSupabaseClient } from "@/lib/supabase/server";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function DashboardPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const message = queryStringParam(params.message);

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
    .single<ProfileRow>();

  if (!profile || !isProfileComplete(profile)) {
    redirect("/onboarding");
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col px-6 py-10 pb-24 md:pb-16">
      <header className="relative overflow-hidden rounded-3xl border border-slate-200 bg-white p-6 md:p-8">
        <div
          aria-hidden
          className="absolute -right-12 -top-16 h-48 w-48 rounded-full bg-cyan-200/50 blur-3xl"
        />
        <div
          aria-hidden
          className="absolute -bottom-20 left-16 h-56 w-56 rounded-full bg-orange-200/50 blur-3xl"
        />
        <div className="relative flex flex-wrap items-start justify-between gap-5">
          <div className="max-w-2xl">
            <p className="inline-flex rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-blue-700">
              Team Hub
            </p>
            <h1 className="mt-4 text-4xl font-semibold tracking-tight text-slate-950 md:text-5xl">
              Dashboard
            </h1>
            <p className="mt-3 text-sm leading-6 text-slate-600 md:text-base">
              Signed in as <span className="font-semibold text-slate-900">{profile.team_name}</span>.
              Manage race week, standings, rules, and league support from one clean command center.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <SignOutButton />
          </div>
        </div>
      </header>

      {message ? (
        <p className="mt-6 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {message}
        </p>
      ) : null}

      <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Profile Snapshot</h2>
            <p className="mt-1 text-sm text-slate-600">Your active league identity.</p>
          </div>
        </div>
        <dl className="mt-4 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
            <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Full Name
            </dt>
            <dd className="mt-0.5 font-medium text-slate-900">{profile.full_name}</dd>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
            <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Team Name
            </dt>
            <dd className="mt-0.5 font-medium text-slate-900">{profile.team_name}</dd>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
            <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Email</dt>
            <dd className="mt-0.5 break-all font-medium text-slate-900">{user.email ?? "-"}</dd>
          </div>
          {profile.role === "admin" ? (
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
              <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Role
              </dt>
              <dd className="mt-0.5 font-medium capitalize text-slate-900">{profile.role}</dd>
            </div>
          ) : null}
        </dl>
      </section>

      <section className="mt-6 rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Quick Actions</h2>
            <p className="mt-1 text-sm text-slate-600">Everything you need for race week in one place.</p>
          </div>
          <div className="shrink-0 rounded-2xl border border-slate-300 bg-white p-1 shadow-sm">
            <div
              aria-hidden
              className="h-14 w-14 rounded-xl border border-slate-200 bg-slate-200 bg-cover bg-center"
              style={{ backgroundImage: `url('${MOUND_HOUND_IMAGE_PATH}')` }}
            />
          </div>
        </div>

        <div className="mt-4 grid gap-3 lg:grid-cols-[0.9fr_1.1fr]">
          <section className="rounded-2xl border border-slate-200 bg-white p-4">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-700">League Ops</h3>
            <div className="mt-3 grid gap-3">
              <Link
                className="group rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white hover:bg-slate-700"
                href="/picks"
              >
                <span className="flex items-center justify-between gap-3">
                  Pick&apos;em Form
                  <span className="transition group-hover:translate-x-0.5">→</span>
                </span>
                <span className="mt-1 block text-xs font-medium text-blue-100">
                  Make or review your locked race picks.
                </span>
              </Link>
              <Link
                className="group rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white hover:bg-slate-700"
                href="/leaderboard"
              >
                <span className="flex items-center justify-between gap-3">
                  Leaderboard
                  <span className="transition group-hover:translate-x-0.5">→</span>
                </span>
                <span className="mt-1 block text-xs font-medium text-blue-100">
                  Standings, picks by race, and analytics.
                </span>
              </Link>
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-4">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-700">
              Rules and Support
            </h3>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <Link
                className="rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm font-semibold text-slate-900 hover:bg-slate-50"
                href="/rules"
              >
                Rules
              </Link>
              <Link
                className="rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm font-semibold text-slate-900 hover:bg-slate-50"
                href="/feedback"
              >
                Feedback
              </Link>
              <Link
                className="rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm font-semibold text-slate-900 hover:bg-slate-50"
                href="/contact-admin"
              >
                Contact Admin
              </Link>
            </div>
          </section>
        </div>

        {profile.role === "admin" ? (
          <div className="mt-3 border-t border-slate-200 pt-3">
            <Link
              className="inline-flex w-full justify-center rounded-md bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-700"
              href="/admin"
            >
              Open admin dashboard
            </Link>
          </div>
        ) : null}
      </section>

      <MobileBottomNav />
    </main>
  );
}
