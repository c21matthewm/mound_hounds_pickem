import { redirect } from "next/navigation";
import { isProfileComplete, type ProfileRow } from "@/lib/profile";
import { loadActiveLeagueSeason } from "@/lib/seasons";
import {
  isRegisteredForSeason,
  loadSeasonParticipation
} from "@/lib/season-participation";
import { createServerSupabaseClient } from "@/lib/supabase/server";

type AppUserOptions = {
  requireRegistration?: boolean;
  requireSeasonDecision?: boolean;
};

export async function requireAppUser(options: AppUserOptions = {}) {
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
  const participation = activeSeason
    ? await loadSeasonParticipation(supabase, activeSeason.id, user.id)
    : null;

  if (activeSeason && profile.is_active && options.requireSeasonDecision && !participation) {
    redirect("/season-registration");
  }

  if (options.requireRegistration && !isRegisteredForSeason(participation)) {
    if (activeSeason && profile.is_active && !participation) {
      redirect("/season-registration");
    }

    redirect(
      "/dashboard?message=Register%20for%20the%20active%20season%20before%20making%20picks."
    );
  }

  return { activeSeason, participation, profile, supabase, user };
}
