import Link from "next/link";
import { resendSignupConfirmationAction } from "@/app/actions/auth";
import { AuthFlowShell, AuthFormPanel } from "@/components/auth-flow-shell";
import { SubmitButton } from "@/components/submit-button";
import {
  CompactNotice,
  FormField,
  actionControlClassName,
  fieldControlClassName
} from "@/components/ui-primitives";
import { queryStringParam } from "@/lib/query";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function ResendConfirmationPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const error = queryStringParam(params.error);

  return (
    <AuthFlowShell
      description="Request a fresh link if your account confirmation email did not arrive or expired."
      footer={
        <Link className="font-semibold text-slate-900 underline" href="/login">
          Back to sign in
        </Link>
      }
      title="Resend confirmation"
    >
      {error ? (
        <CompactNotice className="mt-4" tone="danger">
          {error}
        </CompactNotice>
      ) : null}

      <AuthFormPanel>
        <form action={resendSignupConfirmationAction} className="space-y-4">
          <FormField
            description="Use the same email address entered when the account was created."
            label="Email"
          >
            <input
              required
              autoComplete="email"
              className={fieldControlClassName()}
              name="email"
              type="email"
            />
          </FormField>

          <SubmitButton
            className={actionControlClassName("primary", "w-full")}
            pendingLabel="Sending confirmation..."
          >
            Send confirmation email
          </SubmitButton>
        </form>
      </AuthFormPanel>
    </AuthFlowShell>
  );
}
