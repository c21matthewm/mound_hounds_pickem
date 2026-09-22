# Mound Hounds Operations Guide

This guide covers the account-level setup and end-of-season tasks that cannot be automated from the repository.

The one-time transition from experimental app data is **complete**. The
[prelaunch reset procedure](../supabase/operations/prelaunch-2027/README.md) remains an incident
record, not a step to run again. Both genuine 2025 and 2026 Hall of Fame archives are present;
normal future seasons use the existing finalization and rollover workflow.

## Enable the new Admin capabilities

The administrator confirmed all seven capability migrations are installed and the app looked
correct during review. On 2026-09-22, database types were regenerated and `db:types:check`
passed. The full sequence below is retained for other installations; do not rerun it for this
project. Completing 2026 remains an intentional Admin decision, and 2027 will be prepared when
the official season information is available. The application schema version
remains `20260904_portable_season_backups_v2`; a healthy base schema check does not prove that
these optional RPCs have been installed.

1. Open the intended Supabase project and choose **SQL Editor > New query**.
2. Open the first file in the table below in the repository, copy its **entire contents**, paste
   them into the new SQL query, and click **Run**. Each file includes its own transaction.
3. Confirm the query succeeded. If it fails, keep the file unchanged and inspect the error before
   continuing. Do not paste these scripts into the Table Editor or combine them with import data.
4. Repeat **New query → paste the complete file → Run** for each remaining file, in this order.

| Order | File under `supabase/migrations/` | Enables |
| --- | --- | --- |
| 1 | [20260913_admin_role_delegation.sql](../supabase/migrations/20260913_admin_role_delegation.sql) | Confirmed administrator promotion/demotion and removal guards |
| 2 | [20260913_add_historical_hall_of_fame_import.sql](../supabase/migrations/20260913_add_historical_hall_of_fame_import.sql) | Create-only spreadsheet archives and protection from normal finalization |
| 3 | [20260913_admin_freeze_race_field.sql](../supabase/migrations/20260913_admin_freeze_race_field.sql) | Explicit shared-window field freezing |
| 4 | [20260919_bulk_driver_roster.sql](../supabase/migrations/20260919_bulk_driver_roster.sql) | Atomic selected-driver activation/deactivation |
| 5 | [20260919_admin_bulk_participants.sql](../supabase/migrations/20260919_admin_bulk_participants.sql) | Atomic participation and selected-season enrollment changes |
| 6 | [20260919_add_season_rules_documents.sql](../supabase/migrations/20260919_add_season_rules_documents.sql) | Atomic rules URL changes and the public PDF bucket |
| 7 | [20260921_season_completion.sql](../supabase/migrations/20260921_season_completion.sql) | Explicit season completion, guarded activation, off-season profile editing and capability diagnostics |

5. Refresh **Admin > System Health**. Confirm the base schema contract is healthy and all nine
   **Admin capabilities** show **Installed**. This verifies function availability and authenticated
   execution permission, not a live mutation test.
6. Optionally run this read-only SQL to confirm that the capability functions exist:

```sql
select capability,
       case when to_regprocedure(signature) is not null then 'Installed' else 'Missing' end as status
from (values
  ('Admin roles', 'public.admin_update_participant_role(uuid,text,text)'),
  ('Historical imports', 'public.import_historical_hall_of_fame_season(integer,integer,jsonb)'),
  ('Freeze race field', 'public.admin_freeze_race_field(bigint)'),
  ('Driver roster', 'public.admin_set_driver_roster_status(jsonb,boolean)'),
  ('Participant batches', 'public.admin_bulk_update_participants(text,bigint,jsonb)'),
  ('Season rules', 'public.set_league_season_rules_document(bigint,text,text)'),
  ('Closeout review', 'public.get_season_closeout_context(bigint)'),
  ('Season completion', 'public.complete_league_season(bigint,bigint,timestamptz,text,jsonb)'),
  ('Profile editing', 'public.admin_update_participant_v2(uuid,text,text,boolean,boolean,boolean,bigint)')
) as capabilities(capability, signature);
```

7. After installing migrations on another project, run `npm run db:types`, inspect its diff,
   then run `npm run db:types:check`. Keep the explicit nullable expected-season argument used
   for off-season profile changes. The current project passed generation and verification
   against all seven installed migrations on 2026-09-22.
8. Complete the signed-in checks in [the release review](RELEASE_REVIEW_20260921.md) before a main-branch release.

Installing these capabilities does not import seasons, change account roles, change roster
membership, or freeze race fields. The rules migration creates the public `season-rules` bucket
with a 5 MB PDF limit if it does not exist. It refuses incompatible existing bucket settings
instead of changing a private bucket to public. RPC-backed controls fail with setup feedback
until their required migration is installed.

The genuine **2025 and 2026 Hall of Fame archives already exist**. The user confirmed the 2026
import on 2026-09-13. Do not re-import either year or rerun the prelaunch test-data cleanup. Use
fictional accounts, races and archives only in isolated local fixtures for mutation testing.

## Connect the website domain to Vercel

This is separate from Resend's email subdomain, but it makes links in league emails use the branded website address.

1. In Vercel, open the Mound Hounds project and go to **Settings > Domains**.
2. Add `moundhoundspickem.app`.
3. Also add `www.moundhoundspickem.app` and configure it to redirect to `moundhoundspickem.app` if Vercel asks which address should be primary.
4. Follow the exact DNS records Vercel displays. Add them wherever the domain's current nameservers are managed.
5. Wait until Vercel marks both domains valid, then confirm `https://moundhoundspickem.app` opens the app.
6. In **Settings > Environment Variables**, change the Production value of `NEXT_PUBLIC_SITE_URL` to `https://moundhoundspickem.app`.
7. In Supabase **Authentication > URL Configuration**, set Site URL to `https://moundhoundspickem.app` and add `https://moundhoundspickem.app/auth/callback` to Redirect URLs. Keep the Vercel callback URL as an allowed fallback.

## Resend custom SMTP for Supabase Auth

Use `mail.moundhoundspickem.app` as the dedicated sending subdomain. It is only an email identity; no website needs to load at that address.

1. Create a free Resend account, open **Domains**, select **Add Domain**, and enter `mail.moundhoundspickem.app`.
2. Resend will display the required DNS records. Open the DNS manager for `moundhoundspickem.app` and add every record exactly as Resend shows it. If the domain uses Vercel nameservers, this is **Vercel > Domains > moundhoundspickem.app > DNS Records**. Otherwise, use the registrar or DNS provider named in the domain's nameserver settings.
3. Do not invent a separate generic `mail` A or CNAME record. The Resend-provided records create and verify the sending subdomain. Be careful whether the DNS form automatically appends `.moundhoundspickem.app` to record names.
4. Return to Resend and press **Verify DNS Records**. DNS changes can take time to propagate; continue only after the domain status is **Verified**.
5. In Resend, open **API Keys** and create a key named `Mound Hounds Supabase SMTP`. Select **Sending access** and restrict it to `mail.moundhoundspickem.app`. Save the key when it is displayed; it is shown only once.
6. In Supabase, open the project and go to **Authentication > Email > SMTP Settings**. Enable custom SMTP and enter:
   - Sender name: `Mound Hounds Pick'em`
   - Sender email: `noreply@mail.moundhoundspickem.app`
   - Host: `smtp.resend.com`
   - Port: `465`
   - Username: `resend`
   - Password: the Resend API key
7. In **Authentication > URL Configuration**, confirm the Site URL and redirect URLs from the Vercel domain section above.
8. In **Authentication > Rate Limits**, set the custom-SMTP email limit high enough for planned onboarding. `100` per hour is reasonable for an 80-person league, but the Resend free plan's daily limit still applies.
9. Test one signup confirmation and one password reset with a non-admin email address. Confirm both in Resend's Logs page.

Do not commit the Resend key. Supabase stores the SMTP credential.

## Pick notification email setup

1. In Resend, create a second API key named `Mound Hounds Pick Emails`. Select **Sending access** and restrict it to `mail.moundhoundspickem.app`.
2. In Vercel, open **Project > Settings > Environment Variables**.
3. Add these variables for **Production only**:

   ```text
   RESEND_API_KEY=<the Mound Hounds Pick Emails key>
   RESEND_FROM_EMAIL=Mound Hounds Pick'em <picks@mail.moundhoundspickem.app>
   RESEND_REPLY_TO=<the league administrator's real email address>
   PICK_EMAILS_ENABLED=false
   ```

4. Confirm the existing `NEXT_PUBLIC_SITE_URL` Production variable is `https://moundhoundspickem.app` after the custom domain is active. Email links are built from this value.
5. Save the variables with `PICK_EMAILS_ENABLED=false`. They take effect on the next production deployment; pushing the release to `main` will create that deployment without sending league email.
6. Run `supabase/migrations/20260717_update_pick_reminder_windows.sql` and every later pending
   migration through `supabase/migrations/20260822_retire_five_day_pick_email.sql` in filename
   order in the Supabase SQL Editor.
7. Deploy the matching app while `PICK_EMAILS_ENABLED=false`. In **Admin > System Health**, confirm
   the schema contract is healthy. In **Admin > Race Week**, review the calculated schedule and
   participant email preview, then use **Send test to me**. This sends only to the signed-in administrator and does not alter the
   participant queue or sent history.
8. When the migration, domain, sender, and test are verified, change `PICK_EMAILS_ENABLED` to
   `true` in Vercel and create a new production deployment.
9. Set `enable_pick_reminders := true` in a temporary copy of
   `supabase/operations/02_configure_cron_jobs.sql`, insert the current `CRON_SECRET`, run it, and
   confirm exactly one active `pick_reminders_5min` job exists. If the current race is already
   inside a notification window, eligible missing-pick teams can be emailed on its next run.

The application email schedule is:

- 2 days before the pick deadline: first reminder.
- 4 hours before the pick deadline: final reminder.

The league administrator sends the early-week form-open announcement manually outside the app.

Only active, registered teams without every required saved form receive a given email. Each
delivery is deduplicated in `pick_reminders`; the cron sends at most 25 queued deliveries per
five-minute run and paces provider request starts below the default rate limit. Failed or abandoned
delivery attempts can retry up to three times with the same provider idempotency key. Eligibility,
saved picks, and the current deadline are rechecked immediately before each provider request.
Standard-race deadlines are qualifying start. The Indianapolis 500 deadline remains race start
because qualifying-order groups must be imported before that form is usable. If previous-race
results have not been published, automated reminders wait until those results are ready.

For a 90-person league on Resend's free plan, one email stage to every missing-pick participant
leaves little daily headroom for tests or authentication email. Avoid bulk onboarding on the same
day as a full reminder run, and check the current provider quota before enabling delivery.

### Qualifying schedule changes

For a delayed or corrected standard-race qualifying time:

1. Open **Admin > Race Week**, select the affected race, open **Preparation**, and find
   **Official qualifying time correction**.
2. Enter the new official Indianapolis time, check the confirmation, and select **Update
   deadline**. A doubleheader updates both race forms in the same transaction.
3. Confirm the new time on the Picks page and in **Admin > Race Week > Picks & Reminders**.

The pick form, database submission guard, and unsent email stages all use the corrected time.
Already-sent stages are preserved: for example, changing qualifying after the two-day reminder has
sent does not resend that reminder, while the final four-hour reminder moves to four hours before
the new deadline. An already-open Picks page refreshes its schedule periodically and when the tab
regains focus.

## Deploying the Hall of Fame

1. In Supabase, open **SQL Editor**.
2. Run `supabase/migrations/20260717_add_hall_of_fame.sql` once against the production project.
3. Deploy the application changes to Vercel.
4. After the final race has started and every race has published results, open **Admin > Seasons & League**.
5. Review **Season closeout**, then press **Save Final Standings**.
6. Open **Leaderboard > Hall of Fame**, select **View [year] final standings**, and verify the champion and full standings.

Before completing the season, the admin can use **Refresh Final Standings** for an app-generated archive if a published result is legitimately corrected. Historical spreadsheet archives are protected from that refresh. The archive is stored independently from user profiles, picks, drivers, and race results.

Current-season standings compare total points, then final-race points, then second-to-last-race
points. Finalization stops if those comparisons still leave multiple teams in first place; the
league must determine one champion before archiving. The app does not look farther back or choose
a champion by name. Spreadsheet imports retain their original official ranks and champion.

The Hall of Fame opens with past champions, total points, points per race, races, Field Size,
and the margin over the runner-up where the archived placements establish it. A comparison
table appears when more than one season is archived. Each season displays one recorded champion.
A rank-1 and rank-2 pair with equal totals displays **Won on tiebreak**, retaining the original
champion and finishing order. Select a season to see its full standings,
use **Season** to switch years, or **All champions** to return to the overview.
Archive timestamps remain stored for administrative use and are not shown to participants.

The dashboard waits for every non-archived race's results to be published before announcing that
final standings are ready. Saving the archive and completing the season are separate decisions:

1. Review **Leaderboard > Hall of Fame > View [year] final standings**.
2. Return to **Admin > Seasons & League > Season closeout**.
3. Select **Complete [year] season** and confirm. The database verifies the saved archive,
   checks that source data has not changed, creates a recovery point, records the decision,
   and marks the season completed in one transaction. If any check fails, none of those
   completion changes are committed.
4. Confirm **No active season**. Dashboard shows **Between seasons** and Leaderboard defaults
   to Hall of Fame. Registration and picks remain closed until the next season is activated.
5. In **Admin > Recovery**, choose the completed year under **Backup season** to download its
   milestone backup. Completed-season backups can be compared and downloaded; restore still
   requires that same season to be active and never writes into another season.

For the current 2026 transition, the archive already exists and the experimental races were
removed. After applying the new migration, start at step 1 above; **do not save or import the
2026 standings again**. Historical closeout refuses leftover app races instead of ignoring them.
The migration itself does not complete 2026 or activate 2027.

For a normal app season, every scheduled race must be published and have started. Current scores,
teams, placements, race breakdowns and race count must match the saved final archive. Resolve
corrections while the season is active, refresh its archive, then complete it. Completion retains
accounts, registrations, picks, results, driver state and Hall of Fame. Completed seasons cannot
be reactivated by the activation control.

Older spreadsheet seasons can be imported in **Admin > Seasons & League > Import a historical season**
after applying `20260913_add_historical_hall_of_fame_import.sql`. Paste Rank, Team Name and Total Points
from Google Sheets/Excel (TSV or CSV), enter the year and race count, and review the full preview.
Optional score columns must include every race and sum to the total. Explicit ranks are preserved;
resolve first-place ties before importing. Confirm the preview, then choose **Import season into Hall
of Fame**. An existing year cannot be replaced. No historical accounts or race records are needed.

The real 2025 and 2026 spreadsheet archives have already been imported; the user confirmed 2026 is
visible on 2026-09-13. Do not rerun the prelaunch cleanup or import those years again.

## Image storage maintenance

New driver and race uploads are resized and converted to WebP, saved with unique filenames, and
never overwrite earlier objects. Replacing an image or deleting its driver/race keeps the previous
file available for recovery and other references. An uncertain save also retains the new file;
refresh and check the record before retrying. Do not manually delete old media merely because its
current row URL changed.

Use **Admin > Drivers & Groups > Storage media maintenance > Audit storage images** to review
current references, saved recovery references, missing images, and unreferenced candidates. The
in-app audit is read-only and does not authorize deleting its candidates.

The legacy `cleanup:orphaned-images` script checks only current driver/race references, not recovery
snapshots or downloaded backups. Its `--apply` mode is not a safe substitute for a recovery-aware
cleanup. Uploads and restore operations also need coordination before automated deletion is exposed
in Admin. See `docs/ADMIN_EXPANSION_PROGRESS.md` for this outstanding design work.

## Next-season driver rollover

Do not delete driver records that are referenced by historical picks or results unless the historical races are also intentionally being removed. Those references protect scoring integrity.

Use this rollover instead:

1. Save and review the final standings, then **Complete [year] season** in **Admin > Seasons & League**.
2. Create the upcoming season with its invite code and first race.
3. In **Admin > Drivers & Groups > Preseason seed tools**, select that upcoming season, then preview and import the complete official opening
   standings. The import is transactional: listed drivers become active, returning records and
   images are retained, new drivers are created, and omitted drivers become inactive.
4. Replace returning driver photos and add any missing photos after the roster sync.
5. Activate the season only after the admin shows both its invite code and roster as configured.
6. Do not run the opening-roster import after picks exist; the app intentionally locks it.
7. Review the read-only **Storage media maintenance** audit in **Drivers & Groups**.

Inactive drivers do not appear on the current pick form. Retaining their records preserves historical race and pick displays while consuming negligible database space.

## Yearly participant registration

Auth accounts and profiles are permanent. Do not ask returning participants to create a new email
or password each year.

1. Save and review the final Hall of Fame snapshot, then explicitly complete that season.
2. In **Admin > Seasons & League > Season management**, create the next season. Set its private invite code
   in the same form. Codes must be 8-64 characters and are stored as one-way hashes.
3. Add the season rules PDF path/URL and at least its first race.
4. Import the complete opening driver roster for that upcoming season.
5. Activate the next season when ready to open registration. This requires a configured invite
   code, an opening roster, and no other active season. Activation creates a recovery point and
   resets active-driver points, retaining the opening order. Returning profiles with no enrollment
   decision still need to register; explicit upcoming-season enrollment by an admin is preserved.
6. On their next login, each participant is sent to **Season registration** to enter the private
   code and join or skip that season. Joining is immediate and does not require admin approval.
7. Use **Admin > Participants** to review the registered field or correct a participant decision.

A participant who skips can register later from the dashboard. A participant cannot leave a season
after submitting picks. `profiles.is_active` is reserved for account eligibility; yearly membership
lives in `season_participants`.

Changing an invite code does not affect participants already registered for that season. Configure
the intended upcoming season's code in **Seasons & League**. Do not reopen experimental 2026
registration or put invite codes in source control or Vercel environment variables.

Use **Share registration** in Seasons to create separate links for new and returning accounts.
Enter the current invite code yourself; the database stores a hash and cannot reveal it. The code
travels in a URL fragment, is removed after the form reads it, and is not sent in server query
parameters. Share the link only with intended league members; copying it does not send email.

Between seasons, the participant editor can update names, teams and account eligibility while
preserving historical and upcoming registrations. Its active-season registration control is
disabled; selected upcoming-season enrollment remains available through the batch controls. A
form opened before activation/completion cannot silently apply to a different season.

The participant editor has separate **Participation enabled** and **Registered [year]** controls.
Disabling participation blocks picks and removes the participant from current scoring/reminders
without deleting their login or history. If the participant already has current-season picks, the
admin must explicitly authorize forced removal; normal profile edits do not remove them.

## Selected-season participant and driver changes

In **Admin > Participants**, choose an active or upcoming season and press **View season**.
Registration badges, filters and the selection actions refer to that year. Search by name, team or
email, select individual rows or the current page, and choose one action for up to 100 accounts:
**Enable participation**, **Disable participation**, **Register for [year]**, or **Mark declined
for [year]**. Review the confirmation before applying. Eligibility affects the account across
seasons; registration changes affect only the selected year. Role permissions remain separate.

A stale record or invalid account prevents the entire batch from saving. Accounts with submitted
picks cannot be disabled or declined through the bulk control; use the existing individual editor
for deliberate active-season removal with the extra confirmation. Individual profile forms retain
their active-season registration scope even when another year is selected above them.

In **Drivers & Groups**, select up to 100 drivers, choose their active/inactive status, and use
**Apply to selected**. Current standings/groups refresh in the same transaction as the roster
change and audit. Saved race fields, points and results remain intact. A selected driver hidden by
the missing-photo filter still belongs to the selection; review the displayed hidden count.

## Season rules documents

1. Open **Admin > Seasons & League**, find the active or upcoming season, and review its current
   rules link. Completed seasons cannot have their rules changed here.
2. To use an existing document, enter a single-slash site path such as `/docs/2027-rules.pdf`, or a
   valid HTTPS URL without credentials, spaces or control characters. Choose **Save rules**.
   An empty URL clears the configured document.
3. To upload instead, use **Upload [year] rules PDF**, choose a complete PDF of at most 5 MB, and
   select **Upload and publish PDF**. The document becomes publicly readable through Storage,
   matching the Rules page's existing public document delivery.
4. Open the season's PDF link to review it. For the active season, **Rules & Regulations** shows
   the configured PDF and offers **Open PDF** as a browser fallback.
5. If another admin changed the season or document during editing, refresh and review that change
   before retrying. If a save is reported as unconfirmed, check the current document first; the
   upload may have succeeded and its unique file is intentionally retained.

PDF metadata and its opening/closing markers are checked; this is not a general PDF security
scanner. Only administrators may initiate uploads. Previous PDFs are never overwritten or deleted
by a successful replacement, preserving prior links and recovery references. A newly uploaded
object is removed only after a confirmed database rejection. The rules URL and its audit event
commit together.

## System health and schema contract

Open **Admin > System Health** after a migration, deployment, season rollover, or notification
configuration change. Use Race Week's **Picks & Reminders** stage for the selected race's reminder
readiness and previews. Confirm:

- schema version is `20260904_portable_season_backups_v2` and the database contract reports healthy;
- the expected season is active and the registered-team count is reasonable;
- the next race and previous-results gate are correct;
- the pick-email enabled state matches Vercel;
- reminder queue counts progress from pending/retrying to sent without permanent failures;
- the two reminder send times match the next race's current qualifying deadline, and an admin
  test email renders correctly before participant delivery is enabled;
- use **Retry permanent failures** only after correcting the provider or recipient problem;
- the hourly fantasy-winner recovery job shows a current heartbeat; when email reminders are
  enabled, the reminder job does as well. The separate event list stays intentionally sparse and
  records only useful work, degraded runs, and failures;
- recent admin audit entries match intentional participant, race, result, and season changes.
- the application error inbox is available and has no unexplained open incidents; repeated errors
  are grouped, and **Mark resolved** should be used only after the affected workflow is verified.

The latest matching database migrations are
`supabase/migrations/20260725_harden_race_and_season_operations.sql`,
`supabase/migrations/20260726_add_shared_pick_windows.sql`, and
`supabase/migrations/20260729_scale_weekly_operations.sql`, and
`supabase/migrations/20260730_atomic_picks_and_season_recovery.sql`, and
`supabase/migrations/20260818_bound_recovery_jobs_and_registration.sql`, and
`supabase/migrations/20260821_add_application_error_inbox.sql`, and
`supabase/migrations/20260822_harden_pick_reminder_delivery.sql`, and
`supabase/migrations/20260822_retire_five_day_pick_email.sql`, and
`supabase/migrations/20260831_harden_season_rollover_registration.sql`, and
`supabase/migrations/20260831_repair_timestamp_variable_collisions.sql`, and
`supabase/migrations/20260831_retire_sms_participant_data.sql`, and
`supabase/migrations/20260904_fix_portable_season_backups.sql`. Run them in filename order in
Supabase SQL Editor before deploying a database version that lacks them. Do not rerun migrations
already applied. The six newer optional Admin capability migrations are listed at the top of this
guide; they do not change the base schema version or reopen registration.

Use **Admin audit log** in System Health to search event summaries or filter by exact action/entity
type. **Older events** and **Newer events** navigate 25-event pages while preserving filters.
**View details** loads that event's recorded before/after state; large values may be shortened and
sensitive fields are hidden. An empty result is distinguished from a loading/query failure, which
provides retry feedback. These controls are read-only.

## Season backup and recovery

Open **Admin > Recovery** and select **Create & Download Backup** before results corrections,
season rollover, or unusual database work. Store the downloaded JSON outside Supabase and Vercel,
and retain at least the three newest files.

Result publication and high-risk admin operations also create bounded internal restore points. If
recovery is needed, use the guided preview in the Recovery tab; it compares season-owned rows,
requires the season year, and creates a separate safety point before restoring. Permanent account
identity fields are validated but are not overwritten. Do not manually paste backup contents into
database tables. The permanent incident procedure and backup limitations are in
`docs/SEASON_RECOVERY.md`.

## Doubleheader Setup

1. Create the first standard-format race with its qualifying time, race start, and round.
2. Create the consecutive second race and select the first race under **Shared pick deadline**.
3. Confirm both race rows show **Shared deadline** and the same qualifying time.
4. Before picks open, verify Dashboard shows `0/2` submissions for a participant and Admin
   readiness counts two expected submissions per registered team.
5. Do not unlink the races after fields freeze or picks exist. Results and scoring are still
   published separately for each race.

The participant form displays one race at a time with a two-race switcher. Saving the first missing
form advances to the other. Reminder emails are deduplicated per weekend and list only the forms
that participant still needs. The race after a doubleheader remains closed until both results are
published.
