import Link from "next/link";
import { redirect } from "next/navigation";
import { signOutAction } from "@/app/actions/auth";
import { submitFeedbackAction } from "@/app/feedback/actions";
import {
  FEEDBACK_CATEGORY_OPTIONS,
  FEEDBACK_TYPE_OPTIONS,
  feedbackCategoryLabel,
  feedbackTypeLabel
} from "@/lib/feedback";
import { isProfileComplete, type ProfileRow } from "@/lib/profile";
import { queryStringParam } from "@/lib/query";
import { createServerSupabaseClient } from "@/lib/supabase/server";
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

  const { data: myFeedbackRows } = await supabase
    .from("feedback_items")
    .select("id,feedback_type,category,details,created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(8);

  const myFeedback: FeedbackItemRow[] = (myFeedbackRows ?? []) as FeedbackItemRow[];

  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col px-6 py-10">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="inline-flex rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-blue-700">
            Feedback
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight">Bug Reports & Improvements</h1>
          <p className="mt-2 text-sm text-slate-600">
            We love to continually improve and value your feedback.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Link
            className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
            href="/dashboard"
          >
            Dashboard
          </Link>
          <Link
            className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
            href="/picks"
          >
            Pick&apos;em Form
          </Link>
          <Link
            className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
            href="/leaderboard"
          >
            Leaderboard
          </Link>
          <form action={signOutAction}>
            <button
              className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
              type="submit"
            >
              Sign out
            </button>
          </form>
        </div>
      </header>

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

      <section className="mt-6 rounded-lg border border-slate-200 bg-white p-6">
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
                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
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
                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
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
              className="h-40 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              name="details"
              placeholder="Please include exact steps, what you expected to happen, what happened instead, and any relevant values."
              required
            />
          </label>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-slate-500">
              Your submission is visible to league admins and will help prioritize fixes.
            </p>
            <button
              className="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700"
              type="submit"
            >
              Submit feedback
            </button>
          </div>
        </form>
      </section>

      <section className="mt-6 rounded-lg border border-slate-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-slate-900">Your Recent Submissions</h2>
        <p className="mt-1 text-xs text-slate-500">Times shown in {LEAGUE_TIME_ZONE}.</p>
        {myFeedback.length === 0 ? (
          <p className="mt-3 text-sm text-slate-600">No feedback submitted yet.</p>
        ) : (
          <div className="mt-3 overflow-x-auto rounded-md border border-slate-200">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-slate-50 text-slate-700">
                <tr>
                  <th className="px-3 py-2 font-semibold">Submitted</th>
                  <th className="px-3 py-2 font-semibold">Type</th>
                  <th className="px-3 py-2 font-semibold">Category</th>
                  <th className="px-3 py-2 font-semibold">Summary</th>
                </tr>
              </thead>
              <tbody>
                {myFeedback.map((item) => (
                  <tr key={item.id} className="border-t border-slate-200">
                    <td className="px-3 py-2">{formatDateTime(item.created_at)}</td>
                    <td className="px-3 py-2">{feedbackTypeLabel(item.feedback_type)}</td>
                    <td className="px-3 py-2">{feedbackCategoryLabel(item.category)}</td>
                    <td className="px-3 py-2">{detailPreview(item.details)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
