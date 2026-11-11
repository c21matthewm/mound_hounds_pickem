import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthenticatedPageShell } from "@/components/authenticated-page-shell";
import { INSTALL_GUIDE_DESCRIPTION, InstallGuide } from "@/components/install-guide";
import { ActionLink } from "@/components/ui-primitives";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Install the app | Mound Hounds Pick'em" };

export default async function LeagueInstallPage() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login?next=%2Fmore%2Finstall");
  }

  return (
    <AuthenticatedPageShell
      description={INSTALL_GUIDE_DESCRIPTION}
      eyebrow="More"
      maxWidth="max-w-3xl"
      title="Install the app"
    >
      <InstallGuide />
      <ActionLink className="mt-5 w-fit" href="/more" variant="secondary">
        Back to league menu
      </ActionLink>
    </AuthenticatedPageShell>
  );
}
