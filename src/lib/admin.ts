import { redirect } from "next/navigation";
import { isProfileComplete, type ProfileRow } from "@/lib/profile";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export async function requireAdmin() {
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

  if (!profile || !isProfileComplete(profile)) {
    redirect("/onboarding");
  }

  if (profile.role !== "admin") {
    redirect("/dashboard?message=Admin%20access%20required.");
  }

  return { profile, supabase, user };
}
