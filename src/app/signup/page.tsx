import Link from "next/link";
import { queryStringParam } from "@/lib/query";
import { signUpAction } from "@/app/actions/auth";
import { MOUND_HOUND_IMAGE_PATH } from "@/lib/branding";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function SignupPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const error = queryStringParam(params.error);
  const message = queryStringParam(params.message);

  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-6 py-16">
      <div className="flex items-center gap-3">
        <div
          aria-hidden
          className="h-14 w-14 rounded-2xl border border-slate-200 bg-slate-200 bg-cover bg-center shadow-sm"
          style={{ backgroundImage: `url('${MOUND_HOUND_IMAGE_PATH}')`, backgroundPosition: "50% 38%" }}
        />
        <div>
          <p className="inline-flex w-fit rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-blue-700">
            Mound Hounds Pick&apos;em League
          </p>
          <h1 className="mt-2 text-4xl font-semibold tracking-tight text-slate-950">
            Create account
          </h1>
        </div>
      </div>
      <p className="mt-3 text-sm leading-6 text-slate-600">Join the Mound Hounds Pick&apos;em League.</p>

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

      <form action={signUpAction} className="mt-6 space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">Full name</span>
          <input
            required
            className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm"
            name="full_name"
            type="text"
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">Team name</span>
          <input
            required
            className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm"
            name="team_name"
            type="text"
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">Email</span>
          <input
            required
            className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm"
            name="email"
            type="email"
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">Password</span>
          <input
            required
            className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm"
            minLength={6}
            name="password"
            type="password"
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">Confirm password</span>
          <input
            required
            className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm"
            minLength={6}
            name="confirm_password"
            type="password"
          />
        </label>

        <button
          className="w-full rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-700"
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
