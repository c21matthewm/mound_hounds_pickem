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

## Fantasy winner automation

Race winners are fantasy league winners (team/profile), not INDYCAR race-winning drivers.

- Results updates schedule auto winner finalization for about 15 minutes later.
- Cron endpoint: `/api/cron/fantasy-winner`
- Recommended scheduler: Supabase Cron (`pg_cron` + `pg_net`) every 5 minutes

Set `CRON_SECRET` in Vercel and locally to protect cron route calls.
