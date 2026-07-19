import { redirect } from "next/navigation";
import Link from "next/link";
import { setSeasonParticipationAction } from "@/app/actions/auth";
import { SignOutButton } from "@/components/sign-out-button";
import { isProfileComplete, type ProfileRow } from "@/lib/profile";
import { queryStringParam, sanitizeNextPath } from "@/lib/query";
import { loadActiveLeagueSeason } from "@/lib/seasons";
import { loadSeasonParticipation } from "@/lib/season-participation";
import { createServerSupabaseClient } from "@/lib/supabase/server";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function SeasonRegistrationPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const error = queryStringParam(params.error);
  const next = sanitizeNextPath(queryStringParam(params.next) ?? "/dashboard");
  const supabase = await createServerSupabaseClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("id,full_name,team_name,phone_number,phone_carrier,role,is_active")
    .eq("id", user.id)
    .maybeSingle<ProfileRow>();

  if (!profile || !isProfileComplete(profile)) {
    redirect("/onboarding");
  }

  const activeSeason = await loadActiveLeagueSeason(supabase);
  if (!activeSeason) {
    redirect("/dashboard?message=No%20league%20season%20is%20currently%20open%20for%20registration.");
  }

  const participation = await loadSeasonParticipation(supabase, activeSeason.id, user.id);

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center px-5 py-12 sm:px-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-cyan-700">
            {activeSeason.displayName}
          </p>
          <h1 className="mt-2 text-3xl font-semibold text-slate-950">Season registration</h1>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            Your account and team stay with you each year. Confirm whether {profile.team_name} is
            joining the {activeSeason.seasonYear} league field.
          </p>
        </div>
        <SignOutButton className="static shrink-0" />
      </header>

      {error ? (
        <p className="mt-5 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      {!profile.is_active ? (
        <section className="mt-6 border-y border-slate-200 py-5">
          <h2 className="font-semibold text-slate-900">Account participation is unavailable</h2>
          <p className="mt-1 text-sm text-slate-600">
            Contact the league administrator if you believe this is incorrect.
          </p>
        </section>
      ) : participation?.status === "registered" ? (
        <section className="mt-6 border-y border-emerald-200 bg-emerald-50 px-4 py-5">
          <p className="text-sm font-semibold text-emerald-900">
            {profile.team_name} is registered for {activeSeason.seasonYear}.
          </p>
          <Link
            className="mt-4 inline-flex rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700"
            href={next}
          >
            Continue
          </Link>
        </section>
      ) : (
        <section className="mt-6 border-y border-slate-200 py-5">
          {participation?.status === "declined" ? (
            <p className="mb-4 text-sm text-slate-600">
              You previously skipped this season. You can still join before submitting picks.
            </p>
          ) : null}
          <form action={setSeasonParticipationAction} className="grid gap-3 sm:grid-cols-2">
            <input name="next" type="hidden" value={next} />
            <button
              className="rounded-md bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-700"
              name="decision"
              type="submit"
              value="register"
            >
              Join {activeSeason.seasonYear} season
            </button>
            {!participation ? (
              <button
                className="rounded-md border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-100"
                name="decision"
                type="submit"
                value="decline"
              >
                Skip this season
              </button>
            ) : null}
          </form>
        </section>
      )}
    </main>
  );
}
