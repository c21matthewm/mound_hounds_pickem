"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAppUser } from "@/lib/authenticated-user";
import { errorReference, reportAppError } from "@/lib/app-error-reporter";
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

  if (details.length > 4000) {
    feedbackRedirect("error", "Feedback must be 4,000 characters or fewer.");
  }

  const { supabase, user } = await requireAppUser({ requireSeasonDecision: true });

  const { error } = await supabase.from("feedback_items").insert({
    category,
    details,
    feedback_type: feedbackType,
    user_id: user.id
  });

  if (error) {
    const reported = await reportAppError({
      actorProfileId: user.id,
      code: "feedback-submit-failed",
      context: { operation: "submit-feedback" },
      error,
      route: "/feedback",
      subsystem: "feedback"
    });
    feedbackRedirect(
      "error",
      `Your feedback could not be submitted. Please try again.${errorReference(reported)}`
    );
  }

  revalidatePath("/admin");
  revalidatePath("/feedback");
  feedbackRedirect("message", "Thanks for the feedback. Your submission was recorded.");
}
