# Deploy To Vercel

This app is designed to run locally from `dev` and deploy publicly from `main`.

Production URL:

```text
https://moundhoundspickem.app
```

The Vercel-generated URL can remain available as a fallback, but the custom domain is canonical.

## 1. GitHub And Branches

Vercel should be connected to this GitHub repo and production should deploy from `main`.

Set the Vercel project Node.js version to 22.x. `package.json` is also pinned to `22.x` so Vercel
cannot silently advance the app to a new major Node version. This matches `.nvmrc`.

Daily development flow:

```bash
git checkout dev
npm run verify
git push origin dev
```

When ready to release:

```bash
git checkout main
git merge dev
git push origin main
git checkout dev
```

Vercel will build the pushed `main` branch.

Do not use Vercel's manual **Redeploy** control for normal code releases. A push to `main` creates
a fresh production deployment automatically. Use **Redeploy** only when intentionally rebuilding
an existing commit, such as after correcting a Vercel environment variable without changing code.

## 2. Vercel Environment Variables

In Vercel:

```text
Project -> Settings -> Environment Variables
```

Set these for Production. Preview/Development can use the same values while the app is small.

Required:

```text
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
NEXT_PUBLIC_SITE_URL
CRON_SECRET
```

Set `NEXT_PUBLIC_SITE_URL` to:

```text
https://moundhoundspickem.app
```

Optional reminder delivery values:

```text
RESEND_API_KEY
RESEND_FROM_EMAIL
RESEND_REPLY_TO
PICK_EMAILS_ENABLED
LEAGUE_ADMIN_EMAIL
```

Keep `PICK_EMAILS_ENABLED` set to `false` until the Resend domain, API key, and reminder migration
are ready. Change it to `true` only when production delivery should begin.

Generate a strong cron secret locally:

```bash
openssl rand -base64 48
```

After changing env vars, redeploy the latest production deployment.

## 3. Supabase Auth URLs

In Supabase:

```text
Authentication -> URL Configuration
```

Set Site URL:

```text
https://moundhoundspickem.app
```

Add Redirect URLs:

```text
http://localhost:3000/auth/callback
https://moundhoundspickem.app/auth/callback
```

Password reset emails also use these callback URLs. The app sends users through
`/auth/callback?next=/reset-password`, so no separate `/reset-password` redirect URL is required.

### Branded Authentication Emails

The production-ready recovery template is stored at:

```text
supabase/templates/password-recovery.html
```

Supabase hosts and sends authentication emails, so this template must also be saved in the hosted
project after code deployment:

1. Open **Supabase Dashboard -> Authentication -> Email Templates**.
2. Select **Reset password**.
3. Set the subject to **[Mound Hounds Pick'em] Reset your password**.
4. Replace the message body with the complete contents of
   `supabase/templates/password-recovery.html`.
5. Save the template, then request one reset from `/forgot-password` and confirm the button reaches
   `/reset-password`.

Keep `{{ .ConfirmationURL }}` exactly as written. Supabase replaces it with the one-time recovery
link. Resend email tracking must remain disabled for Supabase Auth messages so it does not rewrite
that link.

Repeat the same hosted-template process for new-account confirmations:

1. Select **Confirm signup** in **Authentication -> Email Templates**.
2. Set the subject to **[Mound Hounds Pick'em] Confirm your email**.
3. Replace the message body with the complete contents of
   `supabase/templates/signup-confirmation.html`.
4. Save it and verify one new account from `/signup`.

The HTML belongs in Supabase, not in a Vercel environment variable or deployment setting.

You can also keep the Vercel-generated callback as a fallback:

```text
https://moundhoundspickem.vercel.app/auth/callback
```

## 4. Supabase Database

For a new project, run:

```text
supabase/schema.sql
```

Then apply `supabase/migrations/20260725_harden_race_and_season_operations.sql`,
`supabase/migrations/20260726_add_shared_pick_windows.sql`, and
`supabase/migrations/20260729_scale_weekly_operations.sql`, followed by
`supabase/migrations/20260730_atomic_picks_and_season_recovery.sql`, and
`supabase/migrations/20260818_bound_recovery_jobs_and_registration.sql`, continuing through
`supabase/migrations/20260831_retire_sms_participant_data.sql`. For an existing project,
apply any missing files in `supabase/migrations/` in filename order.

Most recent scoring safety migration:

```text
supabase/migrations/20260310_auto_snapshot_race_groups_on_results_insert.sql
```

That migration ensures driver groups are snapshotted as soon as race results are inserted, even if
results are inserted outside the normal admin UI path.

Latest Indy 500 pick-format migration:

```text
supabase/migrations/20260528_add_indy_500_pick_format.sql
```

Latest production hardening migration:

```text
supabase/migrations/20260709_harden_roles_and_result_publication.sql
```

Apply the hardening migration before deploying application code that uses draft/published results.
Confirm a current Supabase backup first, and do not use the mutating Playwright suite as a
migration check.

Latest season and participant-management migration:

```text
supabase/migrations/20260718_add_league_seasons_and_active_participants.sql
```

For the existing live database, apply this migration in **Supabase -> SQL Editor** before deploying
the application commit that uses it. The migration creates the current season, assigns existing
races to it, moves the old `Race N -` prefix into a separate round column, and leaves Hall of Fame
snapshots independent from live profiles and races.

After it succeeds, verify:

```sql
select season_year, display_name, status
from public.league_seasons
order by season_year desc;

select round_number, race_name, season_id
from public.races
order by season_id, round_number;

select count(*) filter (where is_active) as active_participants,
       count(*) as total_profiles
from public.profiles;
```

There should be exactly one `active` season, every race should have a round number, and existing
participant profiles should initially remain active.

Latest yearly enrollment and reminder-delivery hardening migration:

```text
supabase/migrations/20260718_add_season_enrollment_and_delivery_hardening.sql
```

Apply this migration after the season migration above and before deploying the matching app code.
It keeps auth accounts and profiles permanent, records registration per season, backfills the
currently active field, requires active-season registration for picks, and makes failed reminder
deliveries visible and retryable.

Verify it after running:

```sql
select key, value from public.app_metadata where key = 'schema_version';

select s.season_year, sp.status, count(*)
from public.season_participants sp
join public.league_seasons s on s.id = sp.season_id
group by s.season_year, sp.status
order by s.season_year desc, sp.status;

select delivery_status, count(*)
from public.pick_reminders
group by delivery_status
order by delivery_status;
```

The schema version should be `20260718_season_enrollment_v1`. Existing teams that were active
before this migration should be `registered` for the current active season.

Latest race/season operations hardening migration:

```text
supabase/migrations/20260725_harden_race_and_season_operations.sql
```

Apply this migration after the yearly enrollment migration and before deploying the matching app
code. It adds hashed private season invite codes, atomic participant and driver-roster changes,
transactional Indy qualifying replacement, frozen race fields, correction safeguards, admin audit
history, and scheduled-job heartbeats.

Verify it after running:

```sql
select key, value
from public.app_metadata
where key = 'schema_version';

select season_year, status, registration_code_configured_at
from public.league_seasons
order by season_year desc;
```

Then open **Admin -> Race Week** while signed into the app as an administrator and confirm the
database contract reports healthy. Do not call `get_app_health_contract()` from Supabase SQL
Editor; it intentionally requires an authenticated app-admin JWT, which SQL Editor does not have.

Latest shared doubleheader pick-window migration:

```text
supabase/migrations/20260726_add_shared_pick_windows.sql
```

Apply it after the operations hardening migration and before deploying the matching application
code. It gives every race a pick-window identifier. Normal races retain independent identifiers;
two consecutive standard races can share one qualifying deadline while keeping separate picks,
results, scoring, speed tie-breakers, and leaderboard rows.

Verify it after running:

```sql
select season_id, pick_window_key, count(*) as race_count,
       min(round_number) as first_round, max(round_number) as last_round,
       count(distinct qualifying_start_at) as deadline_count
from public.races
group by season_id, pick_window_key
order by season_id desc, first_round;

select key, value
from public.app_metadata
where key = 'schema_version';
```

Existing races should each show `race_count = 1`. A configured doubleheader shows `race_count = 2`,
consecutive rounds, and `deadline_count = 1`. The schema version must be
`20260726_shared_pick_windows`. Confirm the health contract from **Admin -> Race Week**.

Latest weekly-scale operations migration:

```text
supabase/migrations/20260729_scale_weekly_operations.sql
```

Apply it after the shared pick-window migration and before deploying the matching application
code. It limits each reminder cron invocation to 25 queued deliveries with five concurrent sends,
adds resumable retry state, records partially successful runs as `degraded`, and adds targeted
failed-delivery retry controls to **Admin -> Race Week**.

Verify it after running:

```sql
select key, value
from public.app_metadata
where key = 'schema_version';

select status, count(*)
from public.job_runs
group by status
order by status;

select delivery_status,
       count(*) filter (where attempt_count = 0) as fresh,
       count(*) filter (where attempt_count between 1 and 2) as retrying,
       count(*) filter (where attempt_count >= 3) as permanently_failed
from public.pick_reminders
group by delivery_status
order by delivery_status;

select
  to_regprocedure(
    'public.claim_pick_reminder_delivery(bigint,uuid,text,text,text)'
  ) is not null as reminder_claim_ready,
  exists (
    select 1
    from pg_constraint
    where conrelid = 'public.job_runs'::regclass
      and conname = 'job_runs_status_check'
      and pg_get_constraintdef(oid) like '%degraded%'
  ) as degraded_job_status_ready;
```

The schema version must be `20260729_weekly_scale_v1`, and both readiness columns must be `true`.
Confirm the complete health contract from **Admin -> Race Week**. Keep the existing
`pick_reminders_5min` cron schedule: a 90-person queue drains across several short, idempotent
invocations.

Latest atomic-pick and season-recovery migration:

```text
supabase/migrations/20260730_atomic_picks_and_season_recovery.sql
```

Apply it after the weekly-scale migration and before deploying the matching application code. It
keeps one latest scoring pick per participant/race, records successful versions for audit, adds
local draft recovery support, bounds feedback administration, and adds checksummed season restore
points.

Verify it after running:

```sql
select key, value
from public.app_metadata
where key = 'schema_version';

select
  to_regprocedure('public.save_weekly_pick(bigint,numeric,bigint[])') is not null
    as atomic_pick_save_ready,
  to_regprocedure('public.create_season_restore_point(bigint,text,text)') is not null
    as season_backup_ready,
  to_regprocedure('public.restore_season_from_restore_point(uuid,integer)') is not null
    as season_restore_ready;
```

After applying only this migration, the interim schema version is
`20260730_atomic_picks_recovery_v1` and all readiness columns must be `true`.

Latest recovery, job-retention, and registration-protection migration:

```text
supabase/migrations/20260818_bound_recovery_jobs_and_registration.sql
```

Apply it after the atomic-pick migration and before deploying the matching application code. It
bounds automatic restore points, keeps one current heartbeat per scheduled job, prunes old job
events, rate-limits season invite attempts with keyed hashes, and hardens recovery requests.

After applying this migration, the interim schema version is
`20260818_recovery_jobs_security_v1`. Continue through the later migrations below before running
the final production-health query. Do not call admin-only health or recovery functions directly
from Supabase SQL Editor.

Latest application-error inbox migration:

```text
supabase/migrations/20260821_add_application_error_inbox.sql
```

Apply it after the recovery/registration migration and before deploying the matching application
code. It adds a bounded, admin-only incident inbox used by participant-safe error handling. It does
not change the existing schema-version string; readiness appears as its own `application_error_inbox`
check in `supabase/operations/01_verify_production_health.sql` and under **Admin -> Race Week**.

After the operations migration but before the shared-window and weekly-scale migrations, the older
expected schema versions are `20260725_operations_v2` and `20260726_shared_pick_windows`.
Existing 2026 participants remain registered. Open **Admin -> Races -> Season management** and set
the private 2026 invite code; only new or not-yet-registered participants will be asked for it.

Latest pick-reminder delivery and schedule-correction migration:

```text
supabase/migrations/20260822_harden_pick_reminder_delivery.sql
supabase/migrations/20260822_retire_five_day_pick_email.sql
```

Apply it after the application-error migration and before deploying the matching application code.
It adds a service-role pre-send eligibility check and an atomic admin correction for qualifying
delays, including shared doubleheader windows. A correction preserves reminder types already sent,
removes only unsent queue work, and recalculates future reminders from the new qualifying time.

After these reminder migrations, the interim schema version is
`20260822_reminder_delivery_v1`. The `reminder_delivery_validation`,
`qualifying_schedule_correction`, and `two_stage_policy` checks must report `PASS`. Then open
**Admin -> Race Week**, review the two calculated send times, preview the email, and use
**Send test to me**. Test messages go only to the signed-in administrator and do not create or
modify participant reminder history.

Latest season-rollover policy migration:

```text
supabase/migrations/20260831_harden_season_rollover_registration.sql
supabase/migrations/20260831_repair_timestamp_variable_collisions.sql
supabase/migrations/20260831_retire_sms_participant_data.sql
```

Apply it after the reminder migrations. It lets an admin activate a prepared season before adding
its schedule, and it keeps the first pick window closed until six days before qualifying. Once the
first race field freezes, a later qualifying delay cannot re-close that already-open form. Later
rounds remain gated by publication of the previous pick window's results. After applying it, run
`supabase/operations/01_verify_production_health.sql`; the final schema version must be
`20260831_email_only_notifications_v1`, and `opening_pick_window_schedule` and
`registration_rate_limit` must report `PASS`.

For the older result-publication migration, retain known historical exceptions rather than
reconstructing missing snapshots from current standings: Race 8 has 25 official rows and a
27-driver snapshot; Race 2 has 25 official rows and no complete historical snapshot.

### Season turnover workflow

Use this order after the final race each year:

1. Publish the final race results and confirm the current standings.
2. In **Admin -> Race Results**, save the final standings to the Hall of Fame.
3. In **Admin -> Races**, create the next season with its private invite code.
4. Use **Admin -> Drivers -> Preseason seed tools** to select the upcoming season and import the
   complete official opening roster. Omitted drivers become inactive automatically.
5. Activate the new season in **Admin -> Races**. Activation requires both the private invite code
   and opening roster. Current driver points reset to zero and the prior
   finishing order remains the opening seed.
6. Add the new season rules and race schedule when they are ready. The opening-round form becomes
   available six days before qualifying; no schedule is required just to open registration.
7. Returning participants sign in with their existing email/password and confirm their own
   registration for the new year. No admin approval and no new account are required.
8. Review the registered field in **Admin -> Participants**. Admin edits are for corrections only.
9. If the official preseason field order needs correction, use **Preseason seed tools** before any
   new-season result is published.

When creating races, enter only the complete event name, such as `Acura Grand Prix of Long Beach`.
Enter its season and round in their separate fields. The Pick'em form continues to show the full
event name.

## 5. Promote Admin

After signing up with your commissioner/admin account, run this in Supabase SQL Editor:

```sql
update public.profiles p
set role = 'admin'
from auth.users u
where p.id = u.id
  and lower(u.email) = lower('your-admin-email@example.com');
```

Then visit:

```text
https://moundhoundspickem.app/admin
```

## 6. Verify Production

Before merging a database or application release, verify that the checked-in Supabase contract
matches the deployed schema and run the full local quality gate:

```bash
npm run verify:release
```

If the contract check fails after an intentional migration, run `npm run db:types`, review the
generated diff, and rerun `npm run verify:release`. Type generation reads the schema only and must
be run from a trusted local environment containing the service-role key; never expose that key in
client code or commit it.

Open the production URL and test:

1. Login/signup.
2. Complete onboarding.
3. Confirm the active-season registration screen, then open the dashboard.
4. Confirm `/picks`, `/leaderboard`, `/rules`, and `/feedback` load.
5. Login as admin and confirm `/admin?tab=health` reports the expected schema version.
6. Open `/admin?tab=recovery`, create one backup, and store the downloaded JSON securely.
7. In Vercel **Logs**, search for `[security:csp-report]` while opening the main pages. The policy is
   report-only and cannot block users; investigate repeated same-origin script/style reports before
   ever changing it to an enforced policy.

Cron health checks:

```bash
curl -i \
  -H "Authorization: Bearer <CRON_SECRET>" \
  https://moundhoundspickem.app/api/cron/fantasy-winner
```

```bash
curl -i \
  -H "Authorization: Bearer <CRON_SECRET>" \
  https://moundhoundspickem.app/api/cron/pick-reminders
```

Expected response includes:

```json
{"ok":true}
```

Without the auth header, production should return `401`.

## 7. Supabase Cron

Vercel Hobby only supports daily cron frequency, so use Supabase `pg_cron` + `pg_net` for frequent
jobs.

Use the single canonical operator query:

```text
supabase/operations/02_configure_cron_jobs.sql
```

It removes duplicate legacy jobs, schedules fantasy-winner recovery hourly, and either schedules
or removes the five-minute reminder job based on its `enable_pick_reminders` setting. Follow the
secret-rotation and unsaved-query instructions in `supabase/operations/README.md` before running
it. Do not keep separate cron setup queries in Supabase SQL Editor.

## 8. GitHub Production Smoke E2E

Workflow:

```text
.github/workflows/production-smoke-e2e.yml
```

Required GitHub repository secrets:

```text
NEXT_PUBLIC_SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
```

Optional repository variable:

```text
PRODUCTION_BASE_URL=https://moundhoundspickem.app
```

The workflow can run automatically after successful deployments or manually from the GitHub
Actions tab.

## Troubleshooting

`500: MIDDLEWARE_INVOCATION_FAILED`

Usually means a required Vercel env var is missing in Production. Check:

```text
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
NEXT_PUBLIC_SITE_URL
CRON_SECRET
```

`401` from cron endpoint

The `Authorization: Bearer <CRON_SECRET>` header does not match Vercel's `CRON_SECRET`, or the
deployment has not been redeployed since the env var changed.

Auth redirects to localhost in production

Update `NEXT_PUBLIC_SITE_URL` in Vercel and Supabase Auth URL Configuration, then redeploy.
