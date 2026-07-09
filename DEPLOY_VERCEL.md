# Deploy To Vercel

This app is designed to run locally from `dev` and deploy publicly from `main`.

Production URL currently used in examples:

```text
https://moundhoundspickem.vercel.app
```

Replace that with a future custom domain if you add one later.

## 1. GitHub And Branches

Vercel should be connected to this GitHub repo and production should deploy from `main`.

Set the Vercel project Node.js version to 22.x. The pinned Supabase client requires Node 22 or
newer, matching `.nvmrc`.

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
https://moundhoundspickem.vercel.app
```

Optional reminder delivery values:

```text
RESEND_API_KEY
RESEND_FROM_EMAIL
RESEND_REPLY_TO
```

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
https://moundhoundspickem.vercel.app
```

Add Redirect URLs:

```text
http://localhost:3000/auth/callback
https://moundhoundspickem.vercel.app/auth/callback
```

Password reset emails also use these callback URLs. The app sends users through
`/auth/callback?next=/reset-password`, so no separate `/reset-password` redirect URL is required.

If you add a custom domain later, also add:

```text
https://your-domain.com/auth/callback
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
https://moundhoundspickem.vercel.app/admin
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
  https://moundhoundspickem.vercel.app/api/cron/fantasy-winner
```

```bash
curl -i \
  -H "Authorization: Bearer <CRON_SECRET>" \
  https://moundhoundspickem.vercel.app/api/cron/pick-reminders
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
    url := 'https://moundhoundspickem.vercel.app/api/cron/fantasy-winner',
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
    url := 'https://moundhoundspickem.vercel.app/api/cron/pick-reminders',
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
PRODUCTION_BASE_URL=https://moundhoundspickem.vercel.app
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
