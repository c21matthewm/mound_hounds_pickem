import { redirect } from "next/navigation";
import { AuthFormPanel } from "@/components/auth-flow-shell";
import { AuthenticatedPageShell } from "@/components/authenticated-page-shell";
import { SeasonRegistrationForm } from "@/components/season-registration-form";
import { CompactNotice } from "@/components/ui-primitives";
import { isProfileComplete, type ProfileRow } from "@/lib/profile";
import { leagueAdminEmail } from "@/lib/league-contact";
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
  const message = queryStringParam(params.message);
  const requestedNext = sanitizeNextPath(queryStringParam(params.next) ?? "/dashboard");
  const next = requestedNext === "/season-registration" ? "/dashboard" : requestedNext;
  const supabase = await createServerSupabaseClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id,full_name,team_name,role,is_active")
    .eq("id", user.id)
    .maybeSingle<ProfileRow>();

  if (profileError) {
    throw new Error(`Failed loading your profile: ${profileError.message}`);
  }

  if (!profile || !isProfileComplete(profile)) {
    redirect("/onboarding");
  }

  const activeSeason = await loadActiveLeagueSeason(supabase);
  if (!activeSeason) {
    redirect("/dashboard?message=No%20league%20season%20is%20currently%20open%20for%20registration.");
  }

  const participation = await loadSeasonParticipation(supabase, activeSeason.id, user.id);
  if (participation?.status === "registered") {
    redirect(next);
  }
  const adminEmail = leagueAdminEmail();

  return (
    <AuthenticatedPageShell
      description={
        <>
          Your account and team stay with you each year. Confirm whether{" "}
          <span className="font-semibold text-slate-800">{profile.team_name}</span> is joining the{" "}
          {activeSeason.seasonYear} league field.
        </>
      }
      eyebrow={activeSeason.displayName}
      maxWidth="max-w-xl"
      title="Season registration"
    >

      {error ? (
        <CompactNotice className="mt-5" tone="danger">
          {error}
        </CompactNotice>
      ) : null}

      {message ? (
        <CompactNotice className="mt-5" tone="success">
          {message}
        </CompactNotice>
      ) : null}

      {!profile.is_active ? (
        <CompactNotice className="mt-6 p-4" tone="warning">
          <h2 className="font-semibold text-slate-900">Account participation is unavailable</h2>
          <p className="mt-1 text-sm text-slate-600">
            Contact the league administrator if you believe this is incorrect.
          </p>
        </CompactNotice>
      ) : (
        <AuthFormPanel>
          {participation?.status === "declined" ? (
            <p className="mb-4 text-sm text-slate-600">
              You previously skipped this season. You can still join before submitting picks.
            </p>
          ) : null}
          <SeasonRegistrationForm
            adminEmail={adminEmail}
            canJoin={Boolean(activeSeason.registrationCodeConfiguredAt)}
            canSkip={!participation}
            next={next}
            seasonYear={activeSeason.seasonYear}
          />
        </AuthFormPanel>
      )}
    </AuthenticatedPageShell>
  );
}
