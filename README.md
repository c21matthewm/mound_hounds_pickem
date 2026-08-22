# Mound Hounds Pick'em

A custom INDYCAR fantasy league app for managing race picks, driver groups, race results,
season standings, league rules, feedback, and admin operations.

## Stack

- Next.js App Router
- React
- Tailwind CSS
- Supabase Auth, PostgreSQL, Storage, RLS, and `pg_cron`/`pg_net`
- Vercel for production hosting
- Vitest for deterministic scoring/import unit tests
- Playwright for read-only production smoke tests and isolated end-to-end testing

## Core Concepts

- Participants submit one driver from each of six groups before qualifying starts.
- Driver groups are based on active driver championship standings.
- Indianapolis 500 races are the exception: participants pick after qualifying order is uploaded,
  choose one driver from each of eight qualifying-order groups, and picks lock at race start.
- Race results update driver championship points and regenerate groups for the next race.
- Race scoring uses the group mapping that was active for that race, not whatever the current
  groups become after results are saved.
- Participants who do not submit picks receive the lowest possible score for that race: the
  lowest scoring driver from each race-specific group.
- Highest and lowest benchmark scores are calculated from the best/worst driver in each
  race-specific group.
- Average speed tiebreaks apply only to first-place ties for a race.
- Accounts and profiles are permanent. Participation is registered separately for each season, so
  returning users sign in with the same credentials and confirm whether they are joining that year.

## Local Setup

Use Node from `.nvmrc`:

```bash
nvm install 22
nvm use
npm ci
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
PICK_EMAILS_ENABLED=false
REMINDER_SMS_ENABLED=false
```

Set `PICK_EMAILS_ENABLED=true` only in the production environment after Resend is verified and the
schedule migration is applied. Keep `REMINDER_SMS_ENABLED=false` for email-only reminders.
Carrier-gateway delivery is opt-in because both channels can exceed the free daily quota.

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
- `npm run test`
- `npm run build`

Run Playwright smoke tests:

```bash
npm run e2e:smoke
```

The smoke suite is read-only and is safe to point at a deployed app.

Run the mutating suite only against a dedicated/local Supabase project:

```bash
export E2E_SUPABASE_URL=YOUR_TEST_PROJECT_URL
export E2E_SUPABASE_ANON_KEY=YOUR_TEST_PROJECT_ANON_KEY
export E2E_SUPABASE_SERVICE_ROLE_KEY=YOUR_TEST_PROJECT_SERVICE_ROLE_KEY
PW_ALLOW_SUPABASE_E2E=1 npm run e2e
```

Mutating tests refuse the normal `.env.local` database credentials and refuse an E2E URL matching
the normal app URL. The full flow creates users, drivers, races, picks, and results in the isolated
project, then cleans them up and recomputes published driver standings.

## Supabase Setup

For a fresh Supabase project, run the consolidated schema:

```text
supabase/schema.sql
```

Then apply the migrations named at the bottom of that file in filename order. For an existing
project, apply only migration files in `supabase/migrations/` that have not already been run.
Migration history is intentionally not squashed or replaced by SQL Editor documents.

```text
supabase/migrations/20260725_harden_race_and_season_operations.sql
supabase/migrations/20260726_add_shared_pick_windows.sql
supabase/migrations/20260729_scale_weekly_operations.sql
supabase/migrations/20260730_atomic_picks_and_season_recovery.sql
supabase/migrations/20260818_bound_recovery_jobs_and_registration.sql
supabase/migrations/20260821_add_application_error_inbox.sql
supabase/migrations/20260822_harden_pick_reminder_delivery.sql
supabase/migrations/20260822_retire_five_day_pick_email.sql
```

The expected production schema version is:

```text
20260822_reminder_delivery_v1
```

Reusable health, cron, and race-diagnostic queries are in `supabase/operations/`. The deployment
sequence is maintained in `DEPLOY_VERCEL.md`.

After creating your first user account, promote it to admin in Supabase SQL Editor:

```sql
update public.profiles p
set role = 'admin'
from auth.users u
where p.id = u.id
  and lower(u.email) = lower('your-admin-email@example.com');
```

## Admin Workflow

1. Create or activate the league season, then import preseason championship standings or manage
   drivers manually.
2. Add races with a separate season and round, full event name, race start, qualifying start,
   payout, and optional title image.
   For a doubleheader, create the first race normally, then create the consecutive second race
   with the first race selected under **Shared pick deadline**.
3. For the Indianapolis 500, mark the race with Indy 500 pick rules and import its 33-car
   qualifying order.
4. Participants submit picks before the race-specific pick deadline.
5. After a race, use bulk import to preview and atomically publish the official finishing order, or
   save individual manual rows as drafts. Pickable standard drivers omitted from the official order
   are saved automatically as zero-point nonstarters.
6. Draft rows stay hidden and do not affect standings. Publish a complete draft with the official
   winning average speed to refresh championship standings/groups and calculate the fantasy winner.
7. Use the leaderboard tabs to review standings, locked picks by race, participant analytics, and
   finalized Hall of Fame seasons.
8. Use **Admin > Race Week** to verify the schema contract, active season, next-race result
   gate, registration count, reminder schedule and preview, queue totals, degraded cron runs,
   application error inbox, and failed-delivery retry controls. Send tests only from the dedicated
   test control; it never changes participant reminder history.
9. Use **Admin > Recovery** to create and download a portable season backup before unusual
   database work. Follow `docs/SEASON_RECOVERY.md` if a restore is ever needed.

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
- `/forgot-password` and `/reset-password`: Supabase password recovery flow
- `/season-registration`: returning-user confirmation for the active season
- `/dashboard`: participant race-week home, quick actions, saved-pick status, and profile snapshot
- `/more`: compact mobile access to rules, feedback, contact, admin, and account details
- `/picks`: active race pick form
- `/leaderboard`: current standings, picks by race, analytics, and Hall of Fame archives
- `/feedback`: participant bug/improvement submissions
- `/rules`: in-app rules PDF viewer
- `/admin`: admin-only participants, drivers, races, results, feedback, system health, and recovery
- `/api/admin/season-backups`: admin-authenticated backup download/preview/restore endpoint
- `/api/cron/fantasy-winner`: protected hourly fallback for fantasy winner finalization
- `/api/cron/pick-reminders`: protected pick reminder cron

Reusable Supabase SQL Editor queries are organized under `supabase/operations`. Applied schema
changes remain in `supabase/migrations`; do not replace migration history with saved SQL Editor
documents.

## Notes

- `.venv` is not required; this is a Node/Next.js app.
- `node_modules`, `.next`, Playwright artifacts, and local env files are intentionally ignored.
- Reminder delivery requires a configured email provider. Without a verified sending domain, leave
  Resend values unset and keep `PICK_EMAILS_ENABLED=false`.
