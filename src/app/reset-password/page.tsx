import Link from "next/link";
import { updatePasswordAction } from "@/app/actions/auth";
import { AuthFlowShell, AuthFormPanel } from "@/components/auth-flow-shell";
import { queryStringParam } from "@/lib/query";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { SubmitButton } from "@/components/submit-button";
import {
  ActionLink,
  CompactNotice,
  FormField,
  actionControlClassName,
  fieldControlClassName
} from "@/components/ui-primitives";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function ResetPasswordPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const error = queryStringParam(params.error);
  const supabase = await createServerSupabaseClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  return (
    <AuthFlowShell
      description="Set a new password for your league account. After it saves, sign in again with the new password."
      footer={
        <>
          Already reset it?{" "}
          <Link className="font-semibold text-slate-900 underline" href="/login">
            Sign in
          </Link>
        </>
      }
      title="Choose new password"
    >

      {!user ? (
        <CompactNotice className="mt-6 p-4" tone="warning">
          <p className="font-semibold">Your reset session is not active</p>
          <p className="mt-1 leading-6">
            Password reset links expire after a short period. Request a fresh link, then open it from the same browser.
          </p>
          <ActionLink className="mt-3" href="/forgot-password">
            Request new link
          </ActionLink>
        </CompactNotice>
      ) : (
        <>
          {error ? (
            <CompactNotice className="mt-4" tone="danger">
              {error}
            </CompactNotice>
          ) : null}

          <AuthFormPanel>
            <form action={updatePasswordAction} className="space-y-4">
            <FormField label="New password">
              <input
                required
                autoComplete="new-password"
                className={fieldControlClassName()}
                minLength={10}
                name="password"
                type="password"
              />
            </FormField>

            <FormField label="Confirm new password">
              <input
                required
                autoComplete="new-password"
                className={fieldControlClassName()}
                minLength={10}
                name="confirm_password"
                type="password"
              />
            </FormField>

            <SubmitButton
              className={actionControlClassName("primary", "w-full")}
              pendingLabel="Updating..."
            >
              Update password
            </SubmitButton>
            </form>
          </AuthFormPanel>
        </>
      )}
    </AuthFlowShell>
  );
}
