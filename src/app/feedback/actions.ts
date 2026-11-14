"use server";

import { revalidatePath } from "next/cache";
import { requireAppUser } from "@/lib/authenticated-user";
import { errorReference, reportAppError } from "@/lib/app-error-reporter";
import { isFeedbackCategory, isFeedbackType } from "@/lib/feedback";

const asText = (value: FormDataEntryValue | null): string =>
  typeof value === "string" ? value.trim() : "";

export type FeedbackSubmissionState =
  | { status: "idle" }
  | { status: "error"; message: string; field?: "feedback_type" | "category" | "details" }
  | { status: "success"; message: string };

export async function submitFeedbackAction(
  formData: FormData
): Promise<FeedbackSubmissionState> {
  const feedbackType = asText(formData.get("feedback_type"));
  const category = asText(formData.get("category"));
  const details = asText(formData.get("details"));

  if (!isFeedbackType(feedbackType)) {
    return { status: "error", field: "feedback_type", message: "Select a valid feedback type." };
  }

  if (!isFeedbackCategory(category)) {
    return { status: "error", field: "category", message: "Select a valid category." };
  }

  if (details.length < 20) {
    return { status: "error", field: "details", message: "Please provide at least 20 characters so we have enough detail." };
  }

  if (details.length > 4000) {
    return { status: "error", field: "details", message: "Feedback must be 4,000 characters or fewer." };
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
    return {
      status: "error",
      message: "Your feedback could not be submitted. Please try again." + errorReference(reported)
    };
  }

  revalidatePath("/admin");
  revalidatePath("/feedback");
  return { status: "success", message: "Thanks for the feedback. Your submission was recorded." };
}
