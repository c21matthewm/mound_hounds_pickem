import { redirect } from "next/navigation";
import Link from "next/link";
import { signOutAction } from "@/app/actions/auth";
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
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col px-6 py-16">
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

      <section className="mt-6 rounded-lg border border-slate-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-slate-900">Profile Snapshot</h2>
        <dl className="mt-4 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-slate-500">Full Name</dt>
            <dd className="font-medium text-slate-900">{profile.full_name}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Team Name</dt>
            <dd className="font-medium text-slate-900">{profile.team_name}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Phone Number</dt>
            <dd className="font-medium text-slate-900">{profile.phone_number}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Phone Carrier</dt>
            <dd className="font-medium text-slate-900">{profile.phone_carrier}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Role</dt>
            <dd className="font-medium capitalize text-slate-900">{profile.role}</dd>
          </div>
        </dl>
      </section>

      <section className="mt-6 rounded-lg border border-dashed border-slate-300 bg-slate-50 p-6">
        <h2 className="text-lg font-semibold text-slate-900">Next</h2>
        <p className="mt-2 text-sm text-slate-600">Use the Pick&apos;em Form to submit your race lineup.</p>
        <p className="mt-1 text-sm text-slate-600">
          We love to continually improve and value your feedback.
        </p>
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          <Link
            className="inline-flex justify-center rounded-md bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-700"
            href="/picks"
          >
            Open Pick&apos;em Form
          </Link>
          <Link
            className="inline-flex justify-center rounded-md bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-700"
            href="/leaderboard"
          >
            Open leaderboard
          </Link>
          <Link
            className="inline-flex justify-center rounded-md bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-700"
            href="/feedback"
          >
            Report bug / suggest improvement
          </Link>
          {profile.role === "admin" ? (
            <Link
              className="inline-flex justify-center rounded-md bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-700 sm:col-span-2"
              href="/admin"
            >
              Open admin dashboard
            </Link>
          ) : null}
        </div>
      </section>
    </main>
  );
}
