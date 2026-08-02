import Link from "next/link";
import { queryStringParam } from "@/lib/query";
import { signUpAction } from "@/app/actions/auth";
import { AuthFlowShell, AuthFormPanel } from "@/components/auth-flow-shell";
import { loadActiveLeagueSeason } from "@/lib/seasons";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/service-role";
import { SubmitButton } from "@/components/submit-button";
import {
  CompactNotice,
  FormField,
  actionControlClassName,
  fieldControlClassName
} from "@/components/ui-primitives";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function SignupPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const error = queryStringParam(params.error);
  const message = queryStringParam(params.message);
  const activeSeason = await loadActiveLeagueSeason(createServiceRoleSupabaseClient());
  const registrationOpen = Boolean(activeSeason?.registrationCodeConfiguredAt);

  return (
    <AuthFlowShell
      description={
        registrationOpen && activeSeason
          ? `Create your permanent account and join the ${activeSeason.seasonYear} league season.`
          : activeSeason
            ? "Registration will open when the league administrator finishes the season setup."
            : "Account registration will open when the next league season is active."
      }
      footer={
        <>
          Already have an account?{" "}
          <Link className="font-semibold text-slate-900 underline" href="/login">
            Sign in
          </Link>
        </>
      }
      title="Create account"
    >

      {error ? (
        <CompactNotice className="mt-4" tone="danger">
          {error}
        </CompactNotice>
      ) : null}

      {message ? (
        <CompactNotice className="mt-4" tone="success">
          {message}
        </CompactNotice>
      ) : null}

      <AuthFormPanel>
        <form action={signUpAction} className="space-y-4">
        <FormField label="Full name">
          <input
            required
            className={fieldControlClassName()}
            name="full_name"
            maxLength={100}
            autoComplete="name"
            type="text"
          />
        </FormField>

        <FormField label="Team name">
          <input
            required
            className={fieldControlClassName()}
            name="team_name"
            maxLength={100}
            type="text"
          />
        </FormField>

        <FormField
          description="Get this private league code from the league administrator."
          label="Season invite code"
        >
          <input
            required
            autoCapitalize="none"
            autoComplete="off"
            className={fieldControlClassName()}
            disabled={!registrationOpen}
            maxLength={64}
            minLength={8}
            name="invite_code"
            type="text"
          />
        </FormField>

        <FormField label="Email">
          <input
            required
            className={fieldControlClassName()}
            name="email"
            autoComplete="email"
            type="email"
          />
        </FormField>

        <FormField label="Password">
          <input
            required
            className={fieldControlClassName()}
            minLength={10}
            name="password"
            autoComplete="new-password"
            type="password"
          />
        </FormField>

        <FormField label="Confirm password">
          <input
            required
            className={fieldControlClassName()}
            minLength={10}
            name="confirm_password"
            autoComplete="new-password"
            type="password"
          />
        </FormField>

        <SubmitButton
          className={actionControlClassName("primary", "w-full")}
          disabled={!registrationOpen}
          pendingLabel="Creating account..."
        >
          Create account
        </SubmitButton>
        </form>
      </AuthFormPanel>
    </AuthFlowShell>
  );
}
