"use client";

import { useId, useRef, useState, type FormEvent } from "react";
import { submitFeedbackAction, type FeedbackSubmissionState } from "@/app/feedback/actions";
import { usePwa } from "@/components/pwa-provider";
import { SubmitButton } from "@/components/submit-button";
import { CompactNotice, FormField, fieldControlClassName } from "@/components/ui-primitives";
import { FEEDBACK_CATEGORY_OPTIONS, FEEDBACK_TYPE_OPTIONS } from "@/lib/feedback";

const emptyDraft = { feedback_type: "bug", category: "weekly_picks", details: "" };
const initialState: FeedbackSubmissionState = { status: "idle" };

export function FeedbackForm() {
  const id = useId();
  const { isOffline } = usePwa();
  const [draft, setDraft] = useState(emptyDraft);
  const submitting = useRef(false);
  const [state, setState] = useState<FeedbackSubmissionState>(initialState);
  const [pending, setPending] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting.current || isOffline || navigator.onLine === false) return;

    const form = new FormData(event.currentTarget);
    submitting.current = true;
    setPending(true);
    setState(initialState);
    try {
      const result = await submitFeedbackAction(form);
      if (result.status === "success") setDraft(emptyDraft);
      setState(result);
    } catch {
      setState({ status: "error", message: "We couldn’t confirm your submission. Your draft is still here." });
    } finally {
      submitting.current = false;
      setPending(false);
    }
  };

  const errorField = state.status === "error" ? state.field : undefined;
  const errorAttributes = (field: keyof typeof draft) => ({
    "aria-invalid": errorField === field || undefined,
    "aria-describedby": errorField === field ? id + "-" + field : undefined
  });
  const fieldError = (field: keyof typeof draft) => state.status === "error" && errorField === field ? (
    <span className="mt-1 block text-sm text-red-800" id={id + "-" + field} role="alert">{state.message}</span>
  ) : null;

  return (
    <form className="mt-4 grid gap-4" method="post" onSubmit={handleSubmit}>
      {state.status === "success" ? (
        <CompactNotice role="status" tone="success">{state.message}</CompactNotice>
      ) : null}
      {state.status === "error" && state.field === undefined ? (
        <CompactNotice role="alert" tone="danger">{state.message}</CompactNotice>
      ) : null}
      <fieldset className="grid min-w-0 gap-4" disabled={pending}>
        <div className="grid gap-4 md:grid-cols-2">
          <FormField label="Feedback type">
            <select
              className={fieldControlClassName()}
              value={draft.feedback_type}
              onChange={event => setDraft({ ...draft, feedback_type: event.target.value })}
              {...errorAttributes("feedback_type")}
              name="feedback_type"
              required
            >
              {FEEDBACK_TYPE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            {fieldError("feedback_type")}
          </FormField>

          <FormField label="Category">
            <select
              className={fieldControlClassName()}
              value={draft.category}
              onChange={event => setDraft({ ...draft, category: event.target.value })}
              {...errorAttributes("category")}
              name="category"
              required
            >
              {FEEDBACK_CATEGORY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            {fieldError("category")}
          </FormField>
        </div>

        <FormField label="Description">
          <textarea
            className={fieldControlClassName("h-40")}
            maxLength={4000}
            minLength={20}
            name="details"
            value={draft.details}
            onChange={event => setDraft({ ...draft, details: event.target.value })}
            {...errorAttributes("details")}
            placeholder="Please include exact steps, what you expected to happen, what happened instead, and any relevant values."
            required
          />
          {fieldError("details")}
        </FormField>
      </fieldset>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-slate-500">
          Your submission is visible to league admins and will help prioritize fixes.
        </p>
        <SubmitButton
          disabled={pending}
        >
          {pending ? "Submitting..." : "Submit feedback"}
        </SubmitButton>
      </div>
    </form>
  );
}
