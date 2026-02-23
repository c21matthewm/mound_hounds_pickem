# Deploy To Vercel (First-Time Setup)

This guide publishes your Next.js app to a public URL so participants can create accounts and test.

## 1) Prerequisites

- GitHub account
- Vercel account (sign in with GitHub)
- Supabase project already set up (you already ran `supabase/schema.sql`)

## 2) Push This Project To GitHub

From project root:

```bash
git init
git add .
git commit -m "Initial INDYCAR fantasy app"
git branch -M main
git remote add origin https://github.com/<your-user>/<your-repo>.git
git push -u origin main
```

If this repo is already connected to GitHub, just commit and push latest changes.

## 3) Create Vercel Project

1. Open Vercel dashboard: `https://vercel.com/dashboard`
2. Click `Add New...` -> `Project`
3. Import your GitHub repo
4. Framework should auto-detect as `Next.js`
5. Keep root directory as repo root
6. Click `Deploy` once (without env vars it may fail, that is okay for first URL creation)

## 4) Set Environment Variables In Vercel

In Vercel project:

1. Go to `Settings` -> `Environment Variables`
2. Add each variable below for `Production`, `Preview`, and `Development`:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `CRON_SECRET`
- `NEXT_PUBLIC_SITE_URL`
- `RESEND_API_KEY`
- `RESEND_FROM_EMAIL`
- `RESEND_API_KEY`
- `RESEND_FROM_EMAIL`
- `RESEND_REPLY_TO` (optional)

Use your existing `.env.local` values for the first four.

For `CRON_SECRET`, generate a strong value:

```bash
openssl rand -base64 48
```

Set `NEXT_PUBLIC_SITE_URL` to your production Vercel URL, for example:

```text
https://your-project-name.vercel.app
```

Then click `Redeploy` from the latest deployment.

## 5) Configure Supabase Auth URLs (Required)

In Supabase dashboard:

1. Open `Authentication` -> `URL Configuration`
2. Set `Site URL` to your Vercel production URL:
   - `https://your-project-name.vercel.app`
3. Add `Redirect URLs`:
   - `http://localhost:3000/auth/callback`
   - `https://your-project-name.vercel.app/auth/callback`
   - If using a custom domain later, add `https://your-domain.com/auth/callback`
4. Save

If email confirmation is enabled, users must confirm by email before login.

## 6) Create/Promote Your Admin User

1. Sign up once on the public site with your own account
2. In Supabase SQL Editor, run:

```sql
update public.profiles p
set role = 'admin'
from auth.users u
where p.id = u.id
  and lower(u.email) = lower('your-admin-email@example.com');
```

Now your account can access `/admin`.

## 7) Verify Public Flow

Test in this order:

1. Open public URL
2. Create a new test participant account
3. Login and complete onboarding
4. Submit picks on `/picks`
5. Login as admin, create race/results, verify leaderboard updates

## 8) Verify Cron Endpoint Security + Health

From terminal:

```bash
curl -i \
  -H "Authorization: Bearer <CRON_SECRET>" \
  https://your-project-name.vercel.app/api/cron/fantasy-winner
```

Expected: JSON with `"ok": true`.

Also verify pick reminders endpoint:

```bash
curl -i \
  -H "Authorization: Bearer <CRON_SECRET>" \
  https://your-project-name.vercel.app/api/cron/pick-reminders
```

Expected: JSON with `"ok": true`.

Without auth header, it should return `401` in production.

## 9) Set Up Supabase Cron (5-Minute Automation)

This replaces Vercel Cron on Hobby and gives you the frequent schedule you wanted.

In Supabase SQL Editor, run:

```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Optional cleanup if job already exists.
do $$
declare
  existing_job_id bigint;
begin
  select j.jobid
    into existing_job_id
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
    url := 'https://your-project-name.vercel.app/api/cron/fantasy-winner',
    headers := jsonb_build_object(
      'authorization', 'Bearer YOUR_CRON_SECRET',
      'content-type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  $$
);
```

Add a second cron for pick reminders:

```sql
do $$
declare
  existing_job_id bigint;
begin
  select j.jobid
    into existing_job_id
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
    url := 'https://your-project-name.vercel.app/api/cron/pick-reminders',
    headers := jsonb_build_object(
      'authorization', 'Bearer YOUR_CRON_SECRET',
      'content-type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  $$
);
```

Then verify job registration:

```sql
select jobid, jobname, schedule, active
from cron.job
order by jobid desc;
```

Replace placeholders first:
- `https://your-project-name.vercel.app` with your real production domain
- `YOUR_CRON_SECRET` with the same value stored in Vercel env vars

## 10) Optional: Custom Domain

In Vercel:

1. `Settings` -> `Domains`
2. Add your domain and follow DNS instructions
3. Update:
   - `NEXT_PUBLIC_SITE_URL` in Vercel
   - Supabase `Site URL`
   - Supabase redirect URL for `/auth/callback`

Redeploy after changing env vars.

## Troubleshooting: `MIDDLEWARE_INVOCATION_FAILED`

If you see `500: INTERNAL_SERVER_ERROR` with `MIDDLEWARE_INVOCATION_FAILED`, the most common cause
is missing Supabase env vars in Vercel Production.

Check in Vercel (`Project -> Settings -> Environment Variables`) that these are present for
**Production**:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `CRON_SECRET`
- `NEXT_PUBLIC_SITE_URL`

After updating env vars, redeploy and test again.
