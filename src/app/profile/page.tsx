import { redirect } from "next/navigation";
import { AuthenticatedPageShell } from "@/components/authenticated-page-shell";
import { MobileBottomNav } from "@/components/mobile-bottom-nav";
import { SignOutButton } from "@/components/sign-out-button";
import {
  ActionLink,
  DetailGrid,
  SectionHeader,
  StatusChip
} from "@/components/ui-primitives";
import { isProfileComplete, type ProfileRow } from "@/lib/profile";
import { loadActiveLeagueSeason } from "@/lib/seasons";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export default async function ProfilePage() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id,full_name,team_name,phone_number,phone_carrier,role,is_active")
    .eq("id", user.id)
    .maybeSingle<ProfileRow>();

  if (profileError) {
    throw new Error(`Failed loading your profile: ${profileError.message}`);
  }

  const profileComplete = isProfileComplete(profile);
  const activeSeason = await loadActiveLeagueSeason(supabase);

  return (
    <AuthenticatedPageShell
      actions={
        <ActionLink
          href={profileComplete ? "/dashboard" : "/onboarding"}
          variant="secondary"
        >
          {profileComplete ? "Dashboard" : "Complete profile"}
        </ActionLink>
      }
      description="Your league identity and account access."
      eyebrow="Account"
      maxWidth="max-w-3xl"
      title="Profile"
    >
      <section className="mt-6">
        <SectionHeader
          action={
            activeSeason ? (
              <StatusChip tone="success">{activeSeason.seasonYear} Season</StatusChip>
            ) : (
              <StatusChip>No Active Season</StatusChip>
            )
          }
          title="Account details"
        />
        <DetailGrid
          className="mt-3"
          items={[
            {
              label: "Name",
              value: profile?.full_name?.trim() || "Not completed"
            },
            {
              label: "Team",
              value: profile?.team_name?.trim() || "Not completed"
            },
            {
              label: "Email",
              value: user.email ?? "-",
              valueClassName: "break-all"
            }
          ]}
        />
        <div className="mt-5 flex justify-center">
          <SignOutButton />
        </div>
      </section>

      {profileComplete ? <MobileBottomNav /> : null}
    </AuthenticatedPageShell>
  );
}
