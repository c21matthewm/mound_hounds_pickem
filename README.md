# Mound Hounds Pick'em

A custom INDYCAR fantasy league app for managing race picks, driver groups, race results,
season standings, league rules, feedback, and admin operations.

## Stack

- Next.js App Router
- React
- Tailwind CSS
- Supabase Auth, PostgreSQL, Storage, RLS, and `pg_cron`/`pg_net`
- Vercel for production hosting
- Playwright for end-to-end testing

## Core Concepts

- Participants submit one driver from each of six groups before qualifying starts.
- Driver groups are based on active driver championship standings.
- Race results update driver championship points and regenerate groups for the next race.
- Race scoring uses the group mapping that was active for that race, not whatever the current
  groups become after results are saved.
- Participants who do not submit picks receive the lowest possible score for that race: the
  lowest scoring driver from each race-specific group.
- Highest and lowest benchmark scores are calculated from the best/worst driver in each
  race-specific group.
- Average speed tiebreaks apply only to first-place ties for a race.

## Local Setup

Use Node from `.nvmrc`:

```bash
nvm use
npm install
cp .env.local.example .env.local
```

Fill `.env.local` with values from Supabase and your local/dev settings:

```bash
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
NEXT_PUBLIC_SITE_URL=http://localhost:3000
CRON_SECRET=...
```

Email reminder values are optional while reminders are on hold:

```bash
RESEND_API_KEY=
RESEND_FROM_EMAIL=
RESEND_REPLY_TO=
```

Run the app:

```bash
npm run dev
```

Open `http://localhost:3000`.

## Verification

Run the full local verification set:

```bash
npm run verify
```

That runs:

- `npm run lint`
- `npm run typecheck`
- `npm run build`

Run Playwright smoke tests:

```bash
npm run e2e:smoke
```

Run the full Playwright suite:

```bash
npm run e2e
```

If you already have a local dev server running on `localhost:3000`, point Playwright at it:

```bash
PW_USE_EXISTING_SERVER=1 PW_BASE_URL=http://127.0.0.1:3000 npm run e2e
```

The full e2e flow creates temporary Supabase data and cleans it up after the run. It also restores
driver standings/points that it changes during the test.

## Supabase Setup

For a fresh Supabase project, run the consolidated schema:

```text
supabase/schema.sql
```

For an existing project, apply any migration files in `supabase/migrations/` that have not been
run yet. The newest migration protects race scoring by automatically snapshotting driver groups
whenever results are inserted:

```text
supabase/migrations/20260310_auto_snapshot_race_groups_on_results_insert.sql
```

After creating your first user account, promote it to admin in Supabase SQL Editor:

```sql
update public.profiles p
set role = 'admin'
from auth.users u
where p.id = u.id
  and lower(u.email) = lower('your-admin-email@example.com');
```

## Admin Workflow

1. Import preseason championship standings or manage drivers manually.
2. Add races with race start, qualifying start, payout, and optional title image.
3. Participants submit picks before qualifying.
4. After a race, import INDYCAR results or enter driver points manually.
5. Results save official points, snapshot race groups if needed, refresh driver championship
   standings, refresh driver groups for the next race, and schedule fantasy winner calculation.
6. Use the leaderboard tabs to review standings, locked picks by race, and participant analytics.

Example paste formats live in:

- `docs/examples/indycar-race-results-sample.txt`
- `docs/examples/championship-standings-sample.txt`

## Production Deployment

Use `DEPLOY_VERCEL.md` for first-time deployment, Vercel environment variables, Supabase Auth
redirect URLs, cron setup, and production smoke testing.

Normal branch workflow:

```bash
git checkout dev
# make and test changes
git push origin dev
git checkout main
git merge dev
git push origin main
git checkout dev
```

Vercel production deploys from `main`.

## Important Routes

- `/login` and `/signup`: public auth pages
- `/dashboard`: participant home, rules/support links, profile snapshot
- `/picks`: active race pick form
- `/leaderboard`: standings, picks by race, analytics
- `/feedback`: participant bug/improvement submissions
- `/rules`: in-app rules PDF viewer
- `/admin`: admin-only drivers, races, results, and feedback management
- `/api/cron/fantasy-winner`: protected fantasy winner finalization cron
- `/api/cron/pick-reminders`: protected pick reminder cron

## Notes

- `.venv` is not required; this is a Node/Next.js app.
- `node_modules`, `.next`, Playwright artifacts, and local env files are intentionally ignored.
- Reminder emails/SMS require a configured email provider. Without a custom sending domain, leave
  Resend values unset and keep reminder delivery on hold.
