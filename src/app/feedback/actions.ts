"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { isProfileComplete, type ProfileRow } from "@/lib/profile";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isFeedbackCategory, isFeedbackType } from "@/lib/feedback";

const asText = (value: FormDataEntryValue | null): string =>
  typeof value === "string" ? value.trim() : "";

const feedbackRedirect = (key: "error" | "message", value: string): never => {
  const params = new URLSearchParams({ [key]: value });
  redirect(`/feedback?${params.toString()}`);
};

export async function submitFeedbackAction(formData: FormData) {
  const feedbackType = asText(formData.get("feedback_type"));
  const category = asText(formData.get("category"));
  const details = asText(formData.get("details"));

  if (!isFeedbackType(feedbackType)) {
    feedbackRedirect("error", "Select a valid feedback type.");
  }

  if (!isFeedbackCategory(category)) {
    feedbackRedirect("error", "Select a valid category.");
  }

  if (details.length < 20) {
    feedbackRedirect("error", "Please provide at least 20 characters so we have enough detail.");
  }

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

  const { error } = await supabase.from("feedback_items").insert({
    category,
    details,
    feedback_type: feedbackType,
    user_id: user.id
  });

  if (error) {
    feedbackRedirect("error", error.message);
  }

  revalidatePath("/admin");
  revalidatePath("/feedback");
  feedbackRedirect("message", "Thanks for the feedback. Your submission was recorded.");
}
