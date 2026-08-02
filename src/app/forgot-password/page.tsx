import Link from "next/link";
import { requestPasswordResetAction } from "@/app/actions/auth";
import { AuthFlowShell, AuthFormPanel } from "@/components/auth-flow-shell";
import { queryStringParam } from "@/lib/query";
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

export default async function ForgotPasswordPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const error = queryStringParam(params.error);
  const message = queryStringParam(params.message);

  return (
    <AuthFlowShell
      description="Enter your account email and we'll send you a secure link to choose a new password."
      footer={
        <>
          Remembered it?{" "}
          <Link className="font-semibold text-slate-900 underline" href="/login">
            Back to sign in
          </Link>
        </>
      }
      title="Reset password"
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
        <form action={requestPasswordResetAction} className="space-y-4">
          <FormField label="Email">
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
            pendingLabel="Sending..."
          >
            Send reset link
          </SubmitButton>
        </form>
      </AuthFormPanel>
    </AuthFlowShell>
  );
}
