import { redirect } from "next/navigation";
import { AuthenticatedPageShell } from "@/components/authenticated-page-shell";
import { SignOutButton } from "@/components/sign-out-button";
import {
  ActionLink,
  ContentPanel,
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
        !profileComplete ? (
          <ActionLink href="/onboarding" variant="secondary">
            Complete profile
          </ActionLink>
        ) : undefined
      }
      description="Your league identity and account access."
      eyebrow="Account"
      maxWidth="max-w-3xl"
      showDesktopNavigation={profileComplete}
      showMobileNavigation={profileComplete}
      title="Profile"
    >
      <ContentPanel className="mt-6">
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
      </ContentPanel>
    </AuthenticatedPageShell>
  );
}
