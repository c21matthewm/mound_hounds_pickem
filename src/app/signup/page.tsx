import Link from "next/link";
import { queryStringParam } from "@/lib/query";
import { signUpAction } from "@/app/actions/auth";
import { MOUND_HOUND_IMAGE_PATH } from "@/lib/branding";
import { loadActiveLeagueSeason } from "@/lib/seasons";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/service-role";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function SignupPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const error = queryStringParam(params.error);
  const message = queryStringParam(params.message);
  const activeSeason = await loadActiveLeagueSeason(createServiceRoleSupabaseClient());

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
      <p className="mt-3 text-sm leading-6 text-slate-600">
        {activeSeason
          ? `Create your permanent account and join the ${activeSeason.seasonYear} league season.`
          : "Account registration will open when the next league season is active."}
      </p>

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
            maxLength={100}
            autoComplete="name"
            type="text"
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">Team name</span>
          <input
            required
            className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm"
            name="team_name"
            maxLength={100}
            type="text"
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">Email</span>
          <input
            required
            className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm"
            name="email"
            autoComplete="email"
            type="email"
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">Password</span>
          <input
            required
            className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm"
            minLength={10}
            name="password"
            autoComplete="new-password"
            type="password"
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">Confirm password</span>
          <input
            required
            className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm"
            minLength={10}
            name="confirm_password"
            autoComplete="new-password"
            type="password"
          />
        </label>

        <button
          className="w-full rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-400"
          disabled={!activeSeason}
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
