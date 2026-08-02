import Link from "next/link";
import { queryStringParam, sanitizeNextPath } from "@/lib/query";
import { signInAction } from "@/app/actions/auth";
import { AuthFlowShell, AuthFormPanel } from "@/components/auth-flow-shell";
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

export default async function LoginPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const error = queryStringParam(params.error);
  const message = queryStringParam(params.message);
  const next = sanitizeNextPath(queryStringParam(params.next) ?? "/dashboard");

  return (
    <AuthFlowShell
      description="Access your league account and current race week."
      footer={
        <>
          New here?{" "}
          <Link className="font-semibold text-slate-900 underline" href="/signup">
            Create an account
          </Link>
        </>
      }
      title="Sign in"
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
        <form action={signInAction} className="space-y-4">
          <input name="next" type="hidden" value={next} />

          <FormField label="Email">
            <input
              required
              autoComplete="email"
              className={fieldControlClassName()}
              name="email"
              type="email"
            />
          </FormField>

          <div>
            <div className="mb-1 flex items-center justify-between gap-3">
              <label
                className="text-xs font-semibold uppercase tracking-wide text-slate-600"
                htmlFor="password"
              >
                Password
              </label>
              <Link
                className="text-xs font-semibold text-blue-700 underline"
                href="/forgot-password"
              >
                Forgot password?
              </Link>
            </div>
            <input
              required
              autoComplete="current-password"
              className={fieldControlClassName()}
              id="password"
              name="password"
              type="password"
            />
          </div>

          <SubmitButton
            className={actionControlClassName("primary", "w-full")}
            pendingLabel="Signing in..."
          >
            Sign in
          </SubmitButton>
        </form>
      </AuthFormPanel>
    </AuthFlowShell>
  );
}
