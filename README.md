# Mound Hounds Pick'em

Custom INDYCAR fantasy league app built with:

- Next.js (App Router)
- React
- Tailwind CSS
- Supabase (PostgreSQL + Auth + RLS)

## Step 1 status

Step 1 local setup is complete in this repo.

Recommended Node version:

```bash
nvm use 22
```

To finish local dependency install, run:

```bash
npm install
```

Copy environment template:

```bash
cp .env.local.example .env.local
```

Then run:

```bash
npm run lint
npm run build
npm run dev
```

Supabase schema SQL:

`supabase/schema.sql`

Remaining Step 1 actions in Supabase web dashboard are in `STEP1_SETUP.md`.

## Deploying to Vercel

Use the first-time deployment guide:

`DEPLOY_VERCEL.md`

## Production smoke CI

GitHub workflow: `.github/workflows/production-smoke-e2e.yml`

- Triggers on successful deployment status events and manual dispatch.
- Runs Playwright smoke tests against the deployed URL.
- Uses a cross-browser matrix (Chromium desktop, mobile Chromium, Firefox in CI).

Set these GitHub repository secrets for the workflow:

- `NEXT_PUBLIC_SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

Optional repository variable:

- `PRODUCTION_BASE_URL` (fallback URL if deployment event URL is unavailable)

## Fantasy winner automation

Race winners are fantasy league winners (team/profile), not INDYCAR race-winning drivers.

- Results updates schedule auto winner finalization for about 15 minutes later.
- Cron endpoint: `/api/cron/fantasy-winner`
- Recommended scheduler: Supabase Cron (`pg_cron` + `pg_net`) every 5 minutes

Set `CRON_SECRET` in Vercel and locally to protect cron route calls.

## Pick reminder automation

Cron endpoint: `/api/cron/pick-reminders`

Behavior:

- Targets the next unarchived race where qualifying has not started.
- Sends reminders only to participants who have not submitted picks for that race.
- Reminder windows:
  - 4 days before qualifying deadline
  - 2 days before qualifying deadline
  - 2 hours before qualifying deadline
- Sends email reminders to participant account emails.
- Sends SMS reminders through carrier email gateways when `phone_number` and a supported
  `phone_carrier` are present.
- Uses `public.pick_reminders` to dedupe sends (no duplicate sends per user/race/window/channel).

Required env vars:

- `RESEND_API_KEY`
- `RESEND_FROM_EMAIL`
- `CRON_SECRET`

Optional:

- `RESEND_REPLY_TO`
