import Link from "next/link";
import { queryStringParam, sanitizeNextPath } from "@/lib/query";
import { signInAction } from "@/app/actions/auth";
import { MOUND_HOUND_IMAGE_PATH } from "@/lib/branding";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function LoginPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const error = queryStringParam(params.error);
  const message = queryStringParam(params.message);
  const next = sanitizeNextPath(queryStringParam(params.next));

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-16">
      <p className="inline-flex w-fit rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-blue-700">
        Mound Hounds Pick&apos;em League
      </p>
      <div className="mt-4 overflow-hidden rounded-xl border border-slate-200 bg-slate-100 p-1">
        <div className="relative aspect-[16/9] overflow-hidden rounded-lg bg-slate-900">
          <div
            aria-hidden
            className="absolute inset-0 bg-cover bg-center opacity-90"
            style={{ backgroundImage: `url('${MOUND_HOUND_IMAGE_PATH}')`, backgroundPosition: "50% 38%" }}
          />
          <div
            aria-hidden
            className="absolute inset-0 bg-gradient-to-t from-slate-950/70 via-slate-950/15 to-transparent"
          />
        </div>
      </div>
      <h1 className="mt-4 text-3xl font-semibold tracking-tight">Sign in</h1>
      <p className="mt-2 text-sm text-slate-600">
        Access your Mound Hounds Pick&apos;em League account.
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

      <form
        action={signInAction}
        className="mt-6 space-y-4 rounded-lg border border-slate-200 bg-white p-5"
      >
        <input name="next" type="hidden" value={next} />

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
            name="password"
            type="password"
          />
        </label>

        <button
          className="w-full rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700"
          type="submit"
        >
          Sign in
        </button>
      </form>

      <p className="mt-5 text-sm text-slate-600">
        New here?{" "}
        <Link className="font-semibold text-slate-900 underline" href="/signup">
          Create an account
        </Link>
      </p>
    </main>
  );
}
