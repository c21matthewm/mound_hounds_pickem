# Start here: commissioner setup and participant instructions

You have not enabled the new features yet. Nothing has been sent to participants.
You do not need to host a Python server, install Python or choose a messaging provider.

## What participants will do

**iPhone:** open the league link in Safari → Share → Add to Home Screen →
turn on **Open as Web App**, if shown → Add.
**Android:** open the league link in Chrome → browser menu → Install app (or Add to Home screen).

Then, on either phone:

1. Open the Mound Hounds Home Screen icon and sign in.
2. Open **Profile**.
3. Choose **Enable notifications on this device**, then **Allow**.
4. Tap **Send test notification**.

That is all. Each device opts in separately. Email reminders work separately.
To stop device alerts, choose Profile → **Disable on this device**. If a phone says
an app update is ready, close all Mound Hounds windows and reopen the icon.

## Database setup: completed

On November 9, 2026, you confirmed both setup files ran successfully. The installed
schema was then read through the existing type-generation workflow. All five new
tables and twelve functions appeared, including the current polling/dispatch fields.
The installed version markers match and the device table is available with no
subscriptions enrolled at verification time.

Do **not** rerun `20261108_results_automation.sql`,
`20261109_web_push_notifications.sql` or earlier reset/cleanup scripts. Generated
application types now come from the installed schema, replacing the temporary
migration-local contracts. No test league records or real notifications were created.

## Vercel settings: saved

You confirmed the prepared Production settings were saved and redeployed the existing
release. The public sign-in page responds correctly; its published service worker
matches the earlier PWA-only release and contains no push handler. The committed
main source remains `945f5d5`; the new results/push implementation is still local and
uncommitted. That redeployment does not release these new features, so no rollback
is needed solely because the new settings were saved.

Keep `PICK_PUSH_ENABLED=false`. Existing Supabase, Resend and `CRON_SECRET` settings
stay as they are. No participant devices have been enrolled by these checks.

## GitHub settings: saved

You confirmed the two repository secrets and two repository variables were saved.
Keep `RESULTS_MONITOR_ENABLED=false` and `PICK_PUSH_ENABLED=false`. Their values
have not been retrieved or displayed by the agent.

## Release: approved, with automated delivery still disabled

The commissioner approved committing/pushing `dev2-webhook-rcs`, merging and pushing
`dev`, then merging and pushing `main`. Delete the feature branch only after both
branches contain the release and their deployments succeed; finish on `dev`.
The earlier Vercel redeploy used the previous release. This approved release adds
the new bridge, notification screens and dispatch-only workflow.

Keep `RESULTS_MONITOR_ENABLED=false` and `PICK_PUSH_ENABLED=false` throughout the
release. No additional setup SQL or workflow runs are needed before deployment.
After deployment is verified, the next operator step is the explicit test below
on the commissioner's own phone. The GitHub dry run and Vault/calendar scheduler
setup follow separately. No automated test may enroll a real device or create
league records.

The existing full local verification passed. Official-source confirmation remains
unverified for the supplied report, so automated ingestion must continue to wait
when proof or its secure PDF connection cannot be verified. Manual entry remains
available. No automatic publishing is permitted.

Protected Vercel Preview links require an additional Vercel login, so they are not
suitable for this background worker. Use the reviewed public deployment, whose
internal bridge is still protected by its own secret. No admin sign-in is given
to the worker, and it has no publishing action.

To let Supabase wake that job only on race days:

1. GitHub avatar → **Settings → Developer settings → Personal access tokens →
   Fine-grained tokens → Generate new token**.
2. Restrict it to **only** `mound_hounds_pickem`. Give **Actions: read and write**;
   keep other repository permissions at their minimum. Choose an expiry and keep
   a reminder to renew it. Copy it privately; do not send it here.
3. Supabase → **Vault** → add one secret named
   `mound_hounds_results_github_token`, with that token as the value.
4. Run `supabase/operations/04_configure_results_monitor_cron.sql` once in a new
   SQL Editor query. Do this only after the workflow/public release is ready.

This is the only results scheduler to configure. There is no additional website
host or third-party cron account. Between races, Supabase checks its own calendar
and sends no worker request and no request to INDYCAR.

### C. Test your own phone, then enable participant reminders

Install the reviewed HTTPS app on your phone using the participant steps above.
Enable notifications and send yourself a test. This is your explicit device test;
automated checks use fakes and never contact real participant devices.

After it works, set `PICK_PUSH_ENABLED=true` in Vercel and redeploy. Keep your
existing email settings. If the five-minute pick reminder schedule is already
running, keep it. If it is not, we will check and enable that existing schedule
using `supabase/operations/03_configure_push_reminder_cron.sql`; do not rotate your
email/cron secrets or create a second reminder job just for push.

## Race-week use after setup

1. Keep the race start time correct in **Admin → Race Calendar**.
2. In **Admin → Race Week → Results**, paste the exact INDYCAR race-results page
   link and enable automatic checking for that race. No time calculation is needed.
3. Checking starts **2½ hours after the scheduled green flag**, then repeats every
   **15 minutes** until verified official results are staged.
4. A provisional notice means **wait**. Checking continues; publication is blocked.
5. An official notice means **review**. Open the preview, resolve any mapping flags,
   then choose **Approve and publish**. Nothing publishes automatically.

A changed race-calendar start moves checking automatically. For a suspension or
resumption, an optional delayed-check setting lives under Advanced and does not
change pick deadlines. Doubleheaders use the exact separate result page for each race.
GitHub can start jobs late, so 15 minutes is the target/minimum spacing, not an exact
clock guarantee.

“Final Reports” or a completed lap count alone is not official confirmation. The
worker requires an explicit official post-race header, matching race/date and
scoring data. If confirmation cannot be verified, it keeps waiting; manual entry
remains available. Even published official results can be revised weeks later.
After automatic checking has stopped, use the existing Admin correction workflow
for a later penalty; the system does not silently rewrite a published leaderboard.

Technical reference, troubleshooting and isolated test procedures remain in
[RESULTS_AUTOMATION.md](RESULTS_AUTOMATION.md).
