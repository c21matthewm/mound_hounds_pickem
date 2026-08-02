import { redirect } from "next/navigation";
import { saveProfileAction } from "@/app/actions/auth";
import { AuthFlowShell, AuthFormPanel } from "@/components/auth-flow-shell";
import { ProfileButton } from "@/components/profile-button";
import { SubmitButton } from "@/components/submit-button";
import {
  CompactNotice,
  Disclosure,
  FormField,
  actionControlClassName,
  fieldControlClassName
} from "@/components/ui-primitives";
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

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id,full_name,team_name,phone_number,phone_carrier,role")
    .eq("id", user.id)
    .maybeSingle<ProfileRow>();

  if (profileError) {
    throw new Error(`Failed loading your profile: ${profileError.message}`);
  }

  if (isProfileComplete(profile)) {
    redirect("/dashboard");
  }

  return (
    <AuthFlowShell
      action={<ProfileButton />}
      description="Add your name and team once. Contact details remain optional while notifications are email-only."
      eyebrow="League Setup"
      maxWidth="max-w-2xl"
      title="Complete your profile"
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
        <form action={saveProfileAction} className="grid gap-4">
        <FormField label="Full name">
          <input
            required
            className={fieldControlClassName()}
            defaultValue={profile?.full_name ?? ""}
            maxLength={100}
            name="full_name"
            autoComplete="name"
            type="text"
          />
        </FormField>

        <FormField label="Team name">
          <input
            required
            className={fieldControlClassName()}
            defaultValue={profile?.team_name ?? ""}
            maxLength={100}
            name="team_name"
            type="text"
          />
        </FormField>

        <Disclosure
          description="Not required for email notifications."
          summary="Optional contact details"
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Phone number">
              <input
                autoComplete="tel"
                className={fieldControlClassName()}
                defaultValue={profile?.phone_number ?? ""}
                name="phone_number"
                placeholder="317-555-1212"
                type="tel"
              />
            </FormField>

            <FormField label="Phone carrier">
              <select
                className={fieldControlClassName()}
                defaultValue={profile?.phone_carrier ?? ""}
                name="phone_carrier"
              >
                <option value="">Select carrier</option>
                {CARRIERS.map((carrier) => (
                  <option key={carrier.value} value={carrier.value}>
                    {carrier.label}
                  </option>
                ))}
              </select>
            </FormField>
          </div>
        </Disclosure>

        <SubmitButton
          className={actionControlClassName("primary", "mt-1")}
          pendingLabel="Saving profile..."
        >
          Save profile
        </SubmitButton>
        </form>
      </AuthFormPanel>
    </AuthFlowShell>
  );
}
