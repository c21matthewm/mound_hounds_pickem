import { redirect } from "next/navigation";
import { saveProfileAction } from "@/app/actions/auth";
import { SignOutButton } from "@/components/sign-out-button";
import { isProfileComplete, type ProfileRow } from "@/lib/profile";
import { queryStringParam } from "@/lib/query";
import { createServerSupabaseClient } from "@/lib/supabase/server";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const CARRIERS = [
  { label: "AT&T", value: "att" },
  { label: "Verizon", value: "verizon" },
  { label: "T-Mobile", value: "tmobile" },
  { label: "Cricket", value: "cricket" },
  { label: "US Cellular", value: "uscellular" },
  { label: "Google Fi", value: "googlefi" },
  { label: "Other", value: "other" }
];

export default async function OnboardingPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const error = queryStringParam(params.error);
  const message = queryStringParam(params.message);

  const supabase = await createServerSupabaseClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("id,full_name,team_name,phone_number,phone_carrier,role")
    .eq("id", user.id)
    .maybeSingle<ProfileRow>();

  if (isProfileComplete(profile)) {
    redirect("/dashboard");
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center px-6 py-16">
      <SignOutButton />
      <p className="inline-flex w-fit rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-blue-700">
        League Setup
      </p>
      <h1 className="mt-4 text-3xl font-semibold tracking-tight">Complete your profile</h1>
      <p className="mt-2 text-sm text-slate-600">
        We need your team and contact details before you can submit race picks.
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
        action={saveProfileAction}
        className="mt-6 grid gap-4 rounded-lg border border-slate-200 bg-white p-6"
      >
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">Full name</span>
          <input
            required
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            defaultValue={profile?.full_name ?? ""}
            name="full_name"
            type="text"
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">Team name</span>
          <input
            required
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            defaultValue={profile?.team_name ?? ""}
            name="team_name"
            type="text"
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">Phone number</span>
          <input
            required
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            defaultValue={profile?.phone_number ?? ""}
            name="phone_number"
            placeholder="e.g. 317-555-1212"
            type="tel"
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">Phone carrier</span>
          <select
            required
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            defaultValue={profile?.phone_carrier ?? ""}
            name="phone_carrier"
          >
            <option disabled value="">
              Select carrier
            </option>
            {CARRIERS.map((carrier) => (
              <option key={carrier.value} value={carrier.value}>
                {carrier.label}
              </option>
            ))}
          </select>
        </label>

        <button
          className="mt-2 rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700"
          type="submit"
        >
          Save profile
        </button>
      </form>

    </main>
  );
}
