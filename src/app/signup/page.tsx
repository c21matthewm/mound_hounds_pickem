import Link from "next/link";
import { queryStringParam } from "@/lib/query";
import { signUpAction } from "@/app/actions/auth";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function SignupPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const error = queryStringParam(params.error);
  const message = queryStringParam(params.message);

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-16">
      <p className="inline-flex w-fit rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-blue-700">
        Mound Hounds Fantasy
      </p>
      <h1 className="mt-4 text-3xl font-semibold tracking-tight">Create account</h1>
      <p className="mt-2 text-sm text-slate-600">Join your INDYCAR fantasy league.</p>

      {error ? (
        <p className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      {message ? (
        <p className="mt-4 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {message}
        </p>
      ) : null}

      <form action={signUpAction} className="mt-6 space-y-4 rounded-lg border border-slate-200 bg-white p-5">
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">Full name</span>
          <input
            required
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            name="full_name"
            type="text"
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">Team name</span>
          <input
            required
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            name="team_name"
            type="text"
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">Email</span>
          <input
            required
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            name="email"
            type="email"
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">Password</span>
          <input
            required
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            minLength={6}
            name="password"
            type="password"
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">Confirm password</span>
          <input
            required
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            minLength={6}
            name="confirm_password"
            type="password"
          />
        </label>

        <button
          className="w-full rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700"
          type="submit"
        >
          Create account
        </button>
      </form>

      <p className="mt-5 text-sm text-slate-600">
        Already have an account?{" "}
        <Link className="font-semibold text-slate-900 underline" href="/login">
          Sign in
        </Link>
      </p>
    </main>
  );
}
