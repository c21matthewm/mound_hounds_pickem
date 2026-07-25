import Link from "next/link";
import { AuthenticatedPageShell } from "@/components/authenticated-page-shell";
import { MobileBottomNav } from "@/components/mobile-bottom-nav";
import { SignOutButton } from "@/components/sign-out-button";
import { SubmitButton } from "@/components/submit-button";
import { submitFeedbackAction } from "@/app/feedback/actions";
import {
  FEEDBACK_CATEGORY_OPTIONS,
  FEEDBACK_TYPE_OPTIONS,
  feedbackCategoryLabel,
  feedbackTypeLabel
} from "@/lib/feedback";
import { requireAppUser } from "@/lib/authenticated-user";
import { queryStringParam } from "@/lib/query";
import { formatLeagueDateTime, LEAGUE_TIME_ZONE } from "@/lib/timezone";

type FeedbackItemRow = {
  category: string;
  created_at: string;
  details: string;
  feedback_type: string;
  id: number;
};

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const formatDateTime = (value: string): string =>
  formatLeagueDateTime(value, { dateStyle: "medium", timeStyle: "short" });

const detailPreview = (value: string): string => {
  if (value.length <= 120) {
    return value;
  }

  return `${value.slice(0, 117)}...`;
};

export default async function FeedbackPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const message = queryStringParam(params.message);
  const error = queryStringParam(params.error);

  const { supabase, user } = await requireAppUser({ requireSeasonDecision: true });

  const { data: myFeedbackRows, error: feedbackLoadError } = await supabase
    .from("feedback_items")
    .select("id,feedback_type,category,details,created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(8);

  if (feedbackLoadError) {
    throw new Error(`Failed loading your feedback history: ${feedbackLoadError.message}`);
  }

  const myFeedback: FeedbackItemRow[] = (myFeedbackRows ?? []) as FeedbackItemRow[];

  return (
    <AuthenticatedPageShell
      actions={
        <>
          <Link
            className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
            href="/dashboard"
          >
            Dashboard
          </Link>
          <SignOutButton className="static" />
        </>
      }
      description="Report bugs or suggest improvements for league admins to review."
      eyebrow="Feedback"
      maxWidth="max-w-4xl"
      title="Bug Reports & Improvements"
    >

      {message ? (
        <p className="mt-6 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {message}
        </p>
      ) : null}

      {error ? (
        <p className="mt-6 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-6">
        <h2 className="text-xl font-semibold text-slate-900">Submit Feedback</h2>
        <p className="mt-2 text-sm text-slate-600">
          Choose the closest category, then describe what happened or what should improve. Be as
          descriptive as possible so we can reproduce and fix it quickly.
        </p>

        <form action={submitFeedbackAction} className="mt-4 grid gap-4">
          <div className="grid gap-4 md:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">
                Feedback type
              </span>
              <select
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900"
                defaultValue="bug"
                name="feedback_type"
                required
              >
                {FEEDBACK_TYPE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">
                Category
              </span>
              <select
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900"
                defaultValue="weekly_picks"
                name="category"
                required
              >
                {FEEDBACK_CATEGORY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="block">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">
              Description
            </span>
            <textarea
              className="h-40 w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm"
              maxLength={4000}
              minLength={20}
              name="details"
              placeholder="Please include exact steps, what you expected to happen, what happened instead, and any relevant values."
              required
            />
          </label>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-slate-500">
              Your submission is visible to league admins and will help prioritize fixes.
            </p>
            <SubmitButton
              className="rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-700"
              pendingLabel="Submitting..."
            >
              Submit feedback
            </SubmitButton>
          </div>
        </form>
      </section>

      <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-slate-900">Your Recent Submissions</h2>
        <p className="mt-1 text-xs text-slate-500">Times shown in {LEAGUE_TIME_ZONE}.</p>
        {myFeedback.length === 0 ? (
          <p className="mt-3 text-sm text-slate-600">No feedback submitted yet.</p>
        ) : (
          <div className="mt-3 grid gap-2">
            {myFeedback.map((item) => (
              <article key={item.id} className="rounded-md border border-slate-200 bg-slate-50 px-3 py-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">
                      {feedbackCategoryLabel(item.category)}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-500">{formatDateTime(item.created_at)}</p>
                  </div>
                  <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-xs font-semibold text-slate-700">
                    {feedbackTypeLabel(item.feedback_type)}
                  </span>
                </div>
                <p className="mt-2 text-sm text-slate-700">{detailPreview(item.details)}</p>
              </article>
            ))}
          </div>
        )}
      </section>

      <MobileBottomNav />
    </AuthenticatedPageShell>
  );
}
