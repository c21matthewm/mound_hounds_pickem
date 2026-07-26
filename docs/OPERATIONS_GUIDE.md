# Mound Hounds Operations Guide

This guide covers the account-level setup and end-of-season tasks that cannot be automated from the repository.

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
   REMINDER_SMS_ENABLED=false
   ```

4. Confirm the existing `NEXT_PUBLIC_SITE_URL` Production variable is `https://moundhoundspickem.app` after the custom domain is active. Email links are built from this value.
5. Save the variables with `PICK_EMAILS_ENABLED=false`. They take effect on the next production deployment; pushing the release to `main` will create that deployment without sending league email.
6. Run `supabase/migrations/20260717_update_pick_reminder_windows.sql` in the Supabase SQL Editor.
7. Confirm the existing `pick_reminders_5min` job is active with the verification query in `DEPLOY_VERCEL.md`.
8. When the migration, domain, and sender are all verified, change `PICK_EMAILS_ENABLED` to `true` in Vercel and create a new production deployment. This arms email delivery. If the current race is already inside a notification window, eligible missing-pick teams can be emailed as soon as that deployment is active.

The email schedule is:

- 5 days before the pick deadline: “Picks are open” notice.
- 2 days before the pick deadline: first reminder.
- 4 hours before the pick deadline: final reminder.

Only registered teams without a saved pick for that race receive a given email. Each delivery is
deduplicated in `pick_reminders`; failed or abandoned delivery attempts can retry up to three times
with the same provider idempotency key. Standard-race deadlines are qualifying start. The
Indianapolis 500 deadline remains race start because qualifying-order groups must be imported
before that form is usable. If previous-race results have not been published, the form-open notice
waits until those results are ready.

For an 80-person league on Resend's free plan, set `REMINDER_SMS_ENABLED=false` in Vercel. One email reminder to 80 missing-pick participants fits under the 100-email daily limit. Enabling carrier-gateway SMS can double that window to 160 messages. Also avoid onboarding all 80 users on the same day as a full reminder run.

## Deploying the Hall of Fame

1. In Supabase, open **SQL Editor**.
2. Run `supabase/migrations/20260717_add_hall_of_fame.sql` once against the production project.
3. Deploy the application changes to Vercel.
4. After the final race has started and every race has published results, open **Admin > Results**.
5. Review the season status in **Season Archive**, then press **Finalize Season**.
6. Open **Leaderboard > Hall of Fame** and verify the champion and full standings.

The admin can use **Refresh Final Standings** if a published result is legitimately corrected later. The archive is stored independently from user profiles, picks, drivers, and race results.

## Image storage maintenance

New driver and race uploads are resized and converted to WebP before upload. Replacing, clearing, or deleting a managed image also removes the previous object after the database update succeeds.

Run the orphan audit before deleting anything:

```bash
npm run cleanup:orphaned-images
```

Review every listed path. Only then apply the exact same audit with deletion enabled:

```bash
npm run cleanup:orphaned-images -- --apply
```

The script only inspects the app-managed `drivers/` and `races/` prefixes. It ignores external image URLs and is a dry run unless `--apply` is present.

## Next-season driver rollover

Do not delete driver records that are referenced by historical picks or results unless the historical races are also intentionally being removed. Those references protect scoring integrity.

Use this rollover instead:

1. Finalize the completed season in **Admin > Results**.
2. Create the upcoming season with its invite code and first race.
3. In **Admin > Drivers > Preseason seed tools**, select that upcoming season, then preview and import the complete official opening
   standings. The import is transactional: listed drivers become active, returning records and
   images are retained, new drivers are created, and omitted drivers become inactive.
4. Replace returning driver photos and add any missing photos after the roster sync.
5. Activate the season only after the admin shows both its invite code and roster as configured.
6. Do not run the opening-roster import after picks exist; the app intentionally locks it.
7. Run the orphan-image dry run and inspect the output.

Inactive drivers do not appear on the current pick form. Retaining their records preserves historical race and pick displays while consuming negligible database space.

## Yearly participant registration

Auth accounts and profiles are permanent. Do not ask returning participants to create a new email
or password each year.

1. Finalize the completed season Hall of Fame snapshot.
2. In **Admin > Races > Season management**, create the next season. Set its private invite code
   in the same form. Codes must be 8-64 characters and are stored as one-way hashes.
3. Add the season rules PDF path/URL and at least its first race.
4. Import the complete opening driver roster for that upcoming season.
5. Activate the next season. Activation is blocked until both an invite code and opening roster are configured. This leaves
   every returning profile unregistered for the new year.
6. On their next login, each participant is sent to **Season registration** to enter the private
   code and join or skip that season. Joining is immediate and does not require admin approval.
7. Use **Admin > Participants** to review the registered field or correct a participant decision.

A participant who skips can register later from the dashboard. A participant cannot leave a season
after submitting picks. `profiles.is_active` is reserved for account eligibility; yearly membership
lives in `season_participants`.

Changing an invite code does not affect participants already registered for that season. For the
already-running 2026 season, apply the operations migration, then use **Admin > Races > Season
management** to set the desired 2026 code. Do not put the code in source control or Vercel
environment variables.

The participant editor has separate **Participation enabled** and **Registered [year]** controls.
Disabling participation blocks picks and removes the participant from current scoring/reminders
without deleting their login or history. If the participant already has current-season picks, the
admin must explicitly authorize forced removal; normal profile edits do not remove them.

## System health and schema contract

Open **Admin > System Health** after a migration, deployment, season rollover, or notification
configuration change. Confirm:

- schema version is `20260726_shared_pick_windows` and the database contract reports healthy;
- the expected season is active and the registered-team count is reasonable;
- the next race and previous-results gate are correct;
- pick email/SMS enabled states match Vercel;
- recent reminder attempts do not show repeated failures.
- both scheduled jobs show recent heartbeat rows, even when no email or winner was due;
- recent admin audit entries match intentional participant, race, result, and season changes.

The latest matching database migrations are
`supabase/migrations/20260725_harden_race_and_season_operations.sql` and
`supabase/migrations/20260726_add_shared_pick_windows.sql`. Run them in filename order in Supabase
SQL Editor before deploying this application version. They are additive and keep existing 2026
registrations intact. After they succeed, set the 2026 invite code in the admin interface before
accepting any new 2026 participants.

## Doubleheader Setup

1. Create the first standard-format race with its qualifying time, race start, and round.
2. Create the consecutive second race and select the first race under **Shared pick deadline**.
3. Confirm both race rows show **Shared deadline** and the same qualifying time.
4. Before picks open, verify Race Center shows `0/2` submissions for a participant and Admin
   readiness counts two expected submissions per registered team.
5. Do not unlink the races after fields freeze or picks exist. Results and scoring are still
   published separately for each race.

The participant form displays one race at a time with a two-race switcher. Saving the first missing
form advances to the other. Reminder emails are deduplicated per weekend and list only the forms
that participant still needs. The race after a doubleheader remains closed until both results are
published.
