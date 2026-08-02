import { AuthenticatedPageShell } from "@/components/authenticated-page-shell";
import { MobileBottomNav } from "@/components/mobile-bottom-nav";
import { SubmitButton } from "@/components/submit-button";
import {
  ActionLink,
  CompactNotice,
  ContentPanel,
  Disclosure,
  EmptyState,
  FormField,
  SectionHeader,
  StatusChip,
  actionControlClassName,
  fieldControlClassName
} from "@/components/ui-primitives";
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
        <ActionLink href="/dashboard" variant="secondary">
          Dashboard
        </ActionLink>
      }
      description="Report bugs or suggest improvements for league admins to review."
      eyebrow="Feedback"
      maxWidth="max-w-4xl"
      title="Bug Reports & Improvements"
    >

      {message ? (
        <CompactNotice className="mt-6" tone="success">
          {message}
        </CompactNotice>
      ) : null}

      {error ? (
        <CompactNotice className="mt-6" tone="danger">
          {error}
        </CompactNotice>
      ) : null}

      <ContentPanel className="mt-6">
        <SectionHeader
          description="Choose the closest category and describe what happened or what should improve."
          title="Submit Feedback"
        />

        <form action={submitFeedbackAction} className="mt-4 grid gap-4">
          <div className="grid gap-4 md:grid-cols-2">
            <FormField label="Feedback type">
              <select
                className={fieldControlClassName()}
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
            </FormField>

            <FormField label="Category">
              <select
                className={fieldControlClassName()}
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
            </FormField>
          </div>

          <FormField label="Description">
            <textarea
              className={fieldControlClassName("h-40")}
              maxLength={4000}
              minLength={20}
              name="details"
              placeholder="Please include exact steps, what you expected to happen, what happened instead, and any relevant values."
              required
            />
          </FormField>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-slate-500">
              Your submission is visible to league admins and will help prioritize fixes.
            </p>
            <SubmitButton
              className={actionControlClassName("primary")}
              pendingLabel="Submitting..."
            >
              Submit feedback
            </SubmitButton>
          </div>
        </form>
      </ContentPanel>

      <ContentPanel className="mt-6">
        <SectionHeader
          description={`Times shown in ${LEAGUE_TIME_ZONE}.`}
          title="Your Recent Submissions"
        />
        {myFeedback.length === 0 ? (
          <EmptyState
            className="mt-4"
            description="Bug reports and improvement ideas you submit will appear here."
            title="No feedback submitted yet"
          />
        ) : (
          <div className="mt-3 grid gap-2">
            {myFeedback.map((item) => (
              <Disclosure
                description={formatDateTime(item.created_at)}
                key={item.id}
                meta={
                  <StatusChip>
                    {feedbackTypeLabel(item.feedback_type)}
                  </StatusChip>
                }
                summary={feedbackCategoryLabel(item.category)}
              >
                <p className="whitespace-pre-wrap text-sm leading-6 text-slate-700">
                  {item.details}
                </p>
              </Disclosure>
            ))}
          </div>
        )}
      </ContentPanel>

      <MobileBottomNav />
    </AuthenticatedPageShell>
  );
}
