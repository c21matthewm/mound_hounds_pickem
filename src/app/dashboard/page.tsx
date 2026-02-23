import { redirect } from "next/navigation";
import Link from "next/link";
import { signOutAction } from "@/app/actions/auth";
import { MobileBottomNav } from "@/components/mobile-bottom-nav";
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
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col px-6 py-16 pb-24 md:pb-16">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="inline-flex rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-blue-700">
            Team Hub
          </p>
          <h1 className="text-3xl font-semibold tracking-tight">Dashboard</h1>
          <p className="mt-2 text-sm text-slate-600">
            Signed in as <span className="font-semibold">{profile.team_name}</span>.
          </p>
        </div>
        <form action={signOutAction}>
          <button
            className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
            type="submit"
          >
            Sign out
          </button>
        </form>
      </header>

      {message ? (
        <p className="mt-6 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {message}
        </p>
      ) : null}

      <section className="mt-6 rounded-lg border border-slate-200 bg-white p-4 sm:p-5">
        <h2 className="text-lg font-semibold text-slate-900">Profile Snapshot</h2>
        <dl className="mt-3 grid grid-cols-1 gap-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
          <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
            <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Full Name
            </dt>
            <dd className="mt-0.5 font-medium text-slate-900">{profile.full_name}</dd>
          </div>
          <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
            <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Team Name
            </dt>
            <dd className="mt-0.5 font-medium text-slate-900">{profile.team_name}</dd>
          </div>
          <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
            <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Email</dt>
            <dd className="mt-0.5 break-all font-medium text-slate-900">{user.email ?? "-"}</dd>
          </div>
          <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
            <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Phone Number
            </dt>
            <dd className="mt-0.5 font-medium text-slate-900">{profile.phone_number ?? "-"}</dd>
          </div>
          <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
            <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Phone Carrier
            </dt>
            <dd className="mt-0.5 font-medium text-slate-900">{profile.phone_carrier ?? "-"}</dd>
          </div>
          <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
            <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Role</dt>
            <dd className="mt-0.5 font-medium capitalize text-slate-900">{profile.role}</dd>
          </div>
        </dl>
      </section>

      <section className="mt-6 rounded-lg border border-dashed border-slate-300 bg-slate-50 p-5">
        <h2 className="text-lg font-semibold text-slate-900">Quick Actions</h2>
        <p className="mt-1 text-sm text-slate-600">Everything you need for race week in one place.</p>

        <div className="mt-4 space-y-3">
          <section className="rounded-md border border-slate-200 bg-white p-3">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-700">League Ops</h3>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <Link
                className="inline-flex justify-center rounded-md bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-700"
                href="/picks"
              >
                Pick&apos;em Form
              </Link>
              <Link
                className="inline-flex justify-center rounded-md bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-700"
                href="/leaderboard"
              >
                Leaderboard
              </Link>
            </div>
          </section>

          <section className="rounded-md border border-slate-200 bg-white p-3">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-700">
              Rules and Support
            </h3>
            <div className="mt-2 grid gap-2 sm:grid-cols-3">
              <Link
                className="inline-flex justify-center rounded-md bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-700"
                href="/rules"
              >
                Rules and Regulations
              </Link>
              <Link
                className="inline-flex justify-center rounded-md bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-700"
                href="/feedback"
              >
                Report Bug / Suggest Improvement
              </Link>
              <Link
                className="inline-flex justify-center rounded-md bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-700"
                href="/contact-admin"
              >
                Contact League Admin
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
