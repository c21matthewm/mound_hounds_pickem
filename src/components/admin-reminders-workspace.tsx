import { SubmitButton } from "@/components/submit-button";
import { CompactNotice, Disclosure, StatusChip, actionControlClassName } from "@/components/ui-primitives";
import { formatLeagueDateTime } from "@/lib/timezone";
import type { AdminReminderQueueHealth, AdminReminderPreview } from "@/components/admin-system-health";
const formatHealthTime = (value: string) => formatLeagueDateTime(value, {dateStyle: "medium", timeStyle: "short"});
type Props = {
  selectedRaceId: number;
  emailEnabled: boolean; reminderQueue: AdminReminderQueueHealth | null; reminderPreview: AdminReminderPreview | null;
  retryFailedRemindersAction: (data: FormData) => void | Promise<void>;
  sendReminderTestAction: (data: FormData) => void | Promise<void>;
  nextRace: {expectedPickCount: number; pickCount: number; roundLabel: string; roundNumber: number; raceName: string; pickLockAt: string; previousResultsStatus: string} | null;
};
export function AdminRemindersWorkspace({ selectedRaceId, emailEnabled, reminderQueue, reminderPreview, retryFailedRemindersAction, sendReminderTestAction, nextRace }: Props) {
 const permanentReminderFailures = reminderQueue?.permanentFailed ?? 0;
 return <>
      <div className="mt-5 grid gap-5 border-y border-slate-200 py-5 lg:grid-cols-2 lg:divide-x lg:divide-slate-200">
        <section className="lg:pr-5">
          <h3 className="font-semibold text-slate-900">Selected pick window</h3>
          <p className="mt-2 text-sm text-slate-700">
            {nextRace
              ? `${nextRace.roundLabel || `R${nextRace.roundNumber}`} · ${nextRace.raceName}`
              : "No upcoming race is scheduled."}
          </p>
          {nextRace ? (
            <>
              <p className="mt-1 text-xs text-slate-500">
                {nextRace.pickCount}/{nextRace.expectedPickCount} submitted
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Locks {formatHealthTime(nextRace.pickLockAt)}
              </p>
              <p className="mt-2 text-sm font-medium text-slate-700">
                {nextRace.previousResultsStatus}
              </p>
            </>
          ) : null}
        </section>

        <section className="lg:pl-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-semibold text-slate-900">Reminder queue</h3>
            {reminderQueue ? (
              <span className="text-xs font-medium text-slate-500">
                {reminderQueue.reminderType}
              </span>
            ) : null}
          </div>
          {reminderQueue ? (
            <>
              <p className="mt-1 truncate text-xs text-slate-500">{reminderQueue.raceName}</p>
              <dl className="mt-3 grid grid-cols-4 gap-2 text-sm">
                <div><dt className="text-xs text-slate-500">Sent</dt><dd className="font-semibold text-emerald-700">{reminderQueue.sent}</dd></div>
                <div><dt className="text-xs text-slate-500">Pending</dt><dd className="font-semibold">{reminderQueue.pending}</dd></div>
                <div><dt className="text-xs text-slate-500">Retrying</dt><dd className="font-semibold text-amber-700">{reminderQueue.retrying}</dd></div>
                <div><dt className="text-xs text-slate-500">Failed</dt><dd className="font-semibold text-red-700">{permanentReminderFailures}</dd></div>
              </dl>
              {permanentReminderFailures > 0 ? (
                <form action={retryFailedRemindersAction} className="mt-3">
                  <input name="result_race_id" type="hidden" value={selectedRaceId} />
                  <input name="race_id" type="hidden" value={reminderQueue.raceId} />
                  <input name="reminder_type" type="hidden" value={reminderQueue.reminderType} />
                  <SubmitButton
                    className={actionControlClassName("secondary", "text-red-700")}
                    pendingLabel="Queueing..."
                  >
                    Retry failed emails
                  </SubmitButton>
                </form>
              ) : null}
            </>
          ) : (
            <p className="mt-2 text-sm text-slate-600">No reminder window is currently due.</p>
          )}
        </section>
      </div>

      {reminderPreview ? (
        <section className="mt-5 border-b border-slate-200 pb-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="font-semibold text-slate-900">Reminder readiness</h3>
              <p className="mt-1 text-sm text-slate-600">
                {reminderPreview.missingParticipantCount} registered participant
                {reminderPreview.missingParticipantCount === 1 ? " is" : "s are"} currently
                missing at least one form for {reminderPreview.raceName}.
              </p>
            </div>
            <StatusChip tone={emailEnabled ? "success" : "warning"}>
              {emailEnabled ? "Delivery enabled" : "Delivery disabled"}
            </StatusChip>
          </div>

          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {reminderPreview.schedule.map((item) => (
              <div
                className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2"
                key={item.key}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                    {item.label}
                  </p>
                  <StatusChip
                    tone={
                      item.status === "sent"
                        ? "success"
                        : item.status === "due"
                          ? "warning"
                          : "neutral"
                    }
                  >
                    {item.status === "sent"
                      ? `${item.sentCount} sent`
                      : item.status === "due"
                        ? "Due now"
                        : item.status === "passed"
                          ? "Passed"
                          : "Scheduled"}
                  </StatusChip>
                </div>
                <p className="mt-1 text-sm font-medium text-slate-900">
                  {formatHealthTime(item.sendAt)}
                </p>
              </div>
            ))}
          </div>
          <p className="mt-2 text-xs text-slate-500">
            The early-week form-open announcement is manual. The app sends only the two-day and
            four-hour stages. Schedule changes move unsent stages to the corrected qualifying
            time; a stage already sent remains recorded and is not sent again.
          </p>
          {reminderPreview.missingParticipantCount >= 90 ? (
            <CompactNotice className="mt-3" tone="warning">
              {reminderPreview.missingParticipantCount} participants are still missing picks.
              Resend&apos;s free daily allowance is shared with authentication email, so check its
              remaining quota before this stage becomes due.
            </CompactNotice>
          ) : null}

          <div className="mt-4 flex flex-wrap items-end justify-between gap-3">
            <div className="text-xs leading-5 text-slate-600">
              <p>From: {reminderPreview.from ?? "Not configured"}</p>
              <p>
                Test recipient: {reminderPreview.recipientEmail ?? "Administrator email unavailable"}
              </p>
            </div>
            <form action={sendReminderTestAction} className="flex flex-wrap items-end gap-2">
              <input name="result_race_id" type="hidden" value={selectedRaceId} />
                  <input name="race_id" type="hidden" value={reminderPreview.raceId} />
              <label className="block">
                <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  Test template
                </span>
                <select
                  className="rounded-md ui-control-border border border-slate-300 bg-white px-3 py-2 text-sm"
                  defaultValue={reminderPreview.reminderType}
                  name="reminder_type"
                >
                  <option value="2d">Two-day reminder</option>
                  <option value="4h">Final reminder</option>
                </select>
              </label>
              <SubmitButton
                className={actionControlClassName("secondary")}
                disabled={!reminderPreview.recipientEmail}
                pendingLabel="Sending test..."
              >
                Send test to me
              </SubmitButton>
            </form>
          </div>

          <Disclosure
            className="mt-4"
            description={reminderPreview.subject}
            summary="Preview participant email"
          >
            <iframe
              className="h-[560px] w-full rounded-md border border-slate-200 bg-slate-100"
              loading="lazy"
              sandbox=""
              srcDoc={reminderPreview.html}
              title="Pick reminder email preview"
            />
            <details className="mt-3">
              <summary className="cursor-pointer text-xs font-semibold text-slate-700">
                Plain-text fallback
              </summary>
              <pre className="mt-2 whitespace-pre-wrap rounded-md bg-slate-950 p-3 text-xs leading-5 text-slate-100">
                {reminderPreview.text}
              </pre>
            </details>
          </Disclosure>
        </section>
      ) : null}

</>;
}
