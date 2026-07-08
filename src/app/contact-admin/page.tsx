import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthenticatedPageShell } from "@/components/authenticated-page-shell";
import { MobileBottomNav } from "@/components/mobile-bottom-nav";
import { SignOutButton } from "@/components/sign-out-button";
import { isProfileComplete, type ProfileRow } from "@/lib/profile";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export default async function ContactAdminPage() {
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
    <AuthenticatedPageShell
      actions={
        <>
          <Link
            className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
            href="/dashboard"
          >
            Dashboard
          </Link>
          <SignOutButton className="static" />
        </>
      }
      description="For league questions or issues, contact the league admin directly by email."
      eyebrow="Support"
      maxWidth="max-w-3xl"
      title="Contact League Admin"
    >

      <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-6">
        <p className="text-sm text-slate-700">League admin email</p>
        <p className="mt-2 text-xl font-semibold text-slate-900">
          <a
            className="underline decoration-cyan-400 underline-offset-4 hover:text-cyan-800"
            href="mailto:indymoundhounds@gmail.com"
          >
            indymoundhounds@gmail.com
          </a>
        </p>
        <p className="mt-3 text-sm text-slate-600">
          Include your team name and as much detail as possible so the issue can be handled quickly.
        </p>
      </section>
      <MobileBottomNav />
    </AuthenticatedPageShell>
  );
}
