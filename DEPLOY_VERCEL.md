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
REMINDER_SMS_ENABLED
LEAGUE_ADMIN_EMAIL
```

Keep `PICK_EMAILS_ENABLED` set to `false` until the Resend domain, API key, and reminder migration
are ready. Change it to `true` only when production delivery should begin.

Set `REMINDER_SMS_ENABLED` to `false` for email-only reminders. Set it to `true` only after
confirming the provider quota can cover both email and carrier-gateway delivery.

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

You can also keep the Vercel-generated callback as a fallback:

```text
https://moundhoundspickem.vercel.app/auth/callback
```

## 4. Supabase Database

For a new project, run:

```text
supabase/schema.sql
```

Then apply `supabase/migrations/20260725_harden_race_and_season_operations.sql` and
`supabase/migrations/20260726_add_shared_pick_windows.sql` in that order. For an existing project,
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

select public.get_app_health_contract();

select season_year, status, registration_code_configured_at
from public.league_seasons
order by season_year desc;
```

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

select public.get_app_health_contract();
```

Existing races should each show `race_count = 1`. A configured doubleheader shows `race_count = 2`,
consecutive rounds, and `deadline_count = 1`. The schema version must be
`20260726_shared_pick_windows`, and the health contract must report `"healthy": true`.

After the operations migration but before this newest migration, the older expected schema version
is `20260725_operations_v2`. Existing 2026 participants remain registered. Open **Admin -> Races ->
Season management** and set the private 2026 invite code; only new or not-yet-registered
participants will be asked for it.

For the older result-publication migration, retain known historical exceptions rather than
reconstructing missing snapshots from current standings: Race 8 has 25 official rows and a
27-driver snapshot; Race 2 has 25 official rows and no complete historical snapshot.

### Season turnover workflow

Use this order after the final race each year:

1. Publish the final race results and confirm the current standings.
2. In **Admin -> Race Results**, save the final standings to the Hall of Fame.
3. In **Admin -> Races**, create the next season with its private invite code, rules PDF, and at
   least its first scheduled race.
4. Use **Admin -> Drivers -> Preseason seed tools** to select the upcoming season and import the
   complete official opening roster. Omitted drivers become inactive automatically.
5. Activate the new season in **Admin -> Races**. Activation requires both the private invite code
   and opening roster. Current driver points reset to zero and the prior
   finishing order remains the opening seed.
6. Returning participants sign in with their existing email/password and confirm their own
   registration for the new year. No admin approval and no new account are required.
7. Review the registered field in **Admin -> Participants**. Admin edits are for corrections only.
8. If the official preseason field order needs correction, use **Preseason seed tools** before any
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

Open the production URL and test:

1. Login/signup.
2. Complete onboarding.
3. Confirm the active-season registration screen, then open the dashboard.
4. Confirm `/picks`, `/leaderboard`, `/rules`, and `/feedback` load.
5. Login as admin and confirm `/admin?tab=health` reports the expected schema version.

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

Run once in Supabase SQL Editor:

```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;
```

Fantasy winner job:

```sql
do $$
declare
  existing_job_id bigint;
begin
  select j.jobid into existing_job_id
  from cron.job j
  where j.jobname = 'fantasy_winner_5min';

  if existing_job_id is not null then
    perform cron.unschedule(existing_job_id);
  end if;
end;
$$;

select cron.schedule(
  'fantasy_winner_5min',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := 'https://moundhoundspickem.app/api/cron/fantasy-winner',
    headers := jsonb_build_object(
      'authorization', 'Bearer YOUR_CRON_SECRET',
      'content-type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  $$
);
```

Pick reminder job:

```sql
do $$
declare
  existing_job_id bigint;
begin
  select j.jobid into existing_job_id
  from cron.job j
  where j.jobname = 'pick_reminders_5min';

  if existing_job_id is not null then
    perform cron.unschedule(existing_job_id);
  end if;
end;
$$;

select cron.schedule(
  'pick_reminders_5min',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := 'https://moundhoundspickem.app/api/cron/pick-reminders',
    headers := jsonb_build_object(
      'authorization', 'Bearer YOUR_CRON_SECRET',
      'content-type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  $$
);
```

Verify jobs:

```sql
select jobid, jobname, schedule, active
from cron.job
order by jobid desc;
```

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
