import { AuthenticatedPageShell } from "@/components/authenticated-page-shell";
import { MobileBottomNav } from "@/components/mobile-bottom-nav";
import { SignOutButton } from "@/components/sign-out-button";
import {
  ActionLink,
  ContentPanel,
  SectionHeader
} from "@/components/ui-primitives";
import { requireAppUser } from "@/lib/authenticated-user";

export default async function ContactAdminPage() {
  await requireAppUser({ requireSeasonDecision: true });
  const adminEmail = process.env.LEAGUE_ADMIN_EMAIL ?? "indymoundhounds@gmail.com";

  return (
    <AuthenticatedPageShell
      actions={
        <>
          <ActionLink href="/dashboard" variant="secondary">
            Dashboard
          </ActionLink>
          <SignOutButton className="static" />
        </>
      }
      description="For league questions or issues, contact the league admin directly by email."
      eyebrow="Support"
      maxWidth="max-w-3xl"
      title="Contact League Admin"
    >
      <ContentPanel className="mt-6">
        <SectionHeader title="League admin email" />
        <p className="mt-3 break-all text-lg font-semibold text-slate-900 sm:text-xl">
          <a
            className="underline decoration-cyan-400 underline-offset-4 hover:text-cyan-800"
            href={`mailto:${adminEmail}`}
          >
            {adminEmail}
          </a>
        </p>
        <p className="mt-3 text-sm text-slate-600">
          Include your team name and as much detail as possible so the issue can be handled quickly.
        </p>
      </ContentPanel>
      <MobileBottomNav />
    </AuthenticatedPageShell>
  );
}
