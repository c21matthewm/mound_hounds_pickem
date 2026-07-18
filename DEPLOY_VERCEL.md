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

For an existing project, apply any missing files in `supabase/migrations/` in filename order.

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

Apply the hardening migration before deploying the application commit that uses it. Follow
`HARDENING_DEPLOY.md` for backup, verification, and isolated-E2E setup steps.

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

### Season turnover workflow

Use this order after the final race each year:

1. Publish the final race results and confirm the current standings.
2. In **Admin -> Race Results**, save the final standings to the Hall of Fame.
3. In **Admin -> Races**, create the next season and add at least its first scheduled race.
4. In **Admin -> Participants**, mark teams active or inactive for the new season.
5. In **Admin -> Drivers**, mark departing drivers inactive, update returning drivers and images,
   and add new drivers. Do not delete a driver referenced by historical picks or results.
6. Activate the new season in **Admin -> Races**. Current driver points reset to zero and the prior
   finishing order remains the opening seed.
7. If the official preseason field order needs correction, use **Preseason seed tools** before any
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
3. Open dashboard.
4. Confirm `/picks`, `/leaderboard`, `/rules`, and `/feedback` load.
5. Login as admin and confirm `/admin` loads.

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
