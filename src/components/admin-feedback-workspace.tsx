import Link from "next/link";
import type { FeedbackItemRow } from "@/app/admin/admin-types";
import { updateFeedbackStatusAction } from "@/app/admin/maintenance-actions";
import { SubmitButton } from "@/components/submit-button";
import {
  AdminWorkspaceHeader,
  EmptyState,
  StatusChip
} from "@/components/ui-primitives";
import { formatDateTime } from "@/app/admin/admin-data";
import { feedbackCategoryLabel, feedbackTypeLabel } from "@/lib/feedback";

type Props = {
  feedbackCount: number;
  feedbackItems: FeedbackItemRow[];
  feedbackPage: number;
  feedbackPageCount: number;
  feedbackStatus: string;
  teamNameByProfileId: Map<string, string>;
};

export function AdminFeedbackWorkspace({
  feedbackCount,
  feedbackItems,
  feedbackPage,
  feedbackPageCount,
  feedbackStatus,
  teamNameByProfileId
}: Props) {
  const feedbackPageHref = (page: number): string => {
    const params = new URLSearchParams({
      feedback_page: String(Math.max(1, page)),
      feedback_status: feedbackStatus,
      tab: "feedback"
    });
    return `/admin?${params.toString()}`;
  };

  return (
        <section className="mt-6 rounded-lg ui-panel border border-slate-200 bg-white p-4 sm:p-6">
          <AdminWorkspaceHeader
            description="Review participant bug reports and improvement ideas in manageable batches."
            meta={
              <span className="text-sm font-semibold text-slate-700">
                {feedbackCount} submission{feedbackCount === 1 ? "" : "s"}
              </span>
            }
            title="Participant Feedback"
          />

          <form
            action="/admin"
            className="mt-4 flex flex-col gap-2 border-y border-slate-200 py-3 sm:flex-row sm:items-end"
            method="get"
          >
            <input name="tab" type="hidden" value="feedback" />
            <label className="block sm:max-w-56">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">
                Status
              </span>
              <select
                className="w-full rounded-md ui-control-border border border-slate-300 bg-white px-3 py-2 text-sm"
                defaultValue={feedbackStatus}
                name="feedback_status"
              >
                <option value="all">All feedback</option>
                <option value="new">New</option>
                <option value="in_review">In review</option>
                <option value="resolved">Resolved</option>
              </select>
            </label>
            <button
              className="min-h-10 rounded-md ui-control-border border border-slate-300 px-3 py-2 text-sm font-semibold"
              type="submit"
            >
              Apply
            </button>
          </form>

          <div className="mt-5 grid gap-3">
            {feedbackItems.length === 0 ? (
              <EmptyState
                description="Choose another status or check again after participants submit feedback."
                title="No matching feedback"
              />
            ) : (
              feedbackItems.map((item) => (
                <details key={item.id} className="rounded-md ui-panel border border-slate-200 bg-white">
                  <summary className="cursor-pointer px-3 py-3">
                    <div className="inline-flex w-full flex-wrap items-center justify-between gap-3 align-middle">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-slate-900">
                          {teamNameByProfileId.get(item.user_id) ?? `User ${item.user_id}`}
                        </p>
                        <p className="mt-0.5 text-xs text-slate-500">
                          {formatDateTime(item.created_at)} · {feedbackCategoryLabel(item.category)}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <StatusChip
                          tone={
                            item.status === "resolved"
                              ? "success"
                              : item.status === "in_review"
                                ? "warning"
                                : "info"
                          }
                        >
                          {item.status.replace("_", " ")}
                        </StatusChip>
                        <StatusChip tone={item.feedback_type === "bug" ? "danger" : "neutral"}>
                          {feedbackTypeLabel(item.feedback_type)}
                        </StatusChip>
                      </div>
                    </div>
                  </summary>
                  <div className="border-t border-slate-200 px-3 py-3 text-sm text-slate-700">
                    <p className="whitespace-pre-wrap">{item.details}</p>
                    <form
                      action={updateFeedbackStatusAction}
                      className="mt-4 flex flex-col gap-2 border-t border-slate-200 pt-3 sm:flex-row sm:items-end"
                    >
                      <input name="feedback_id" type="hidden" value={item.id} />
                      <input name="feedback_page" type="hidden" value={feedbackPage} />
                      <input name="feedback_status" type="hidden" value={feedbackStatus} />
                      <label className="block sm:max-w-48">
                        <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">
                          Workflow status
                        </span>
                        <select
                          className="w-full rounded-md ui-control-border border border-slate-300 bg-white px-3 py-2 text-sm"
                          defaultValue={item.status}
                          name="status"
                        >
                          <option value="new">New</option>
                          <option value="in_review">In review</option>
                          <option value="resolved">Resolved</option>
                        </select>
                      </label>
                      <SubmitButton
                        className="min-h-10 rounded-md ui-control-border border border-slate-300 px-3 py-2 text-sm font-semibold"
                        pendingLabel="Updating..."
                      >
                        Update status
                      </SubmitButton>
                      {item.resolved_at ? (
                        <span className="self-center text-xs text-slate-500">
                          Resolved {formatDateTime(item.resolved_at)}
                        </span>
                      ) : null}
                    </form>
                  </div>
                </details>
              ))
            )}
          </div>

          {feedbackPageCount > 1 ? (
            <nav
              aria-label="Feedback pages"
              className="mt-4 flex items-center justify-between gap-3 border-t border-slate-200 pt-4"
            >
              <Link
                aria-disabled={feedbackPage <= 1}
                className={`rounded-md ui-control-border border border-slate-300 px-3 py-2 text-sm font-semibold ${
                  feedbackPage <= 1 ? "pointer-events-none opacity-50" : ""
                }`}
                href={feedbackPageHref(feedbackPage - 1)}
              >
                Previous
              </Link>
              <span className="text-sm text-slate-600">
                Page {Math.min(feedbackPage, feedbackPageCount)} of {feedbackPageCount}
              </span>
              <Link
                aria-disabled={feedbackPage >= feedbackPageCount}
                className={`rounded-md ui-control-border border border-slate-300 px-3 py-2 text-sm font-semibold ${
                  feedbackPage >= feedbackPageCount ? "pointer-events-none opacity-50" : ""
                }`}
                href={feedbackPageHref(feedbackPage + 1)}
              >
                Next
              </Link>
            </nav>
          ) : null}

        </section>
  );
}

