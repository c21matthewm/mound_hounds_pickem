# Mound Hounds Pick'em Project Context

Last reviewed: 2026-06-27

This is the working-memory companion to `README.md`. Keep the README focused on setup and user-facing operation; keep this file updated whenever routes, schema, scoring, admin workflows, auth behavior, or testing strategy changes.

## What This App Is

Mound Hounds Pick'em is a private INDYCAR fantasy league app. Participants submit drivers from race-specific groups for the next race, plus an average-speed tiebreaker. Standard races use six championship-standing groups; the Indianapolis 500 uses eight qualifying-order groups. Admins manage drivers, races, qualifying order, official race results, feedback, and fantasy race winners. The app produces season standings, locked picks by race, and participant analytics.

## Stack And Runtime

- Next.js App Router with React, TypeScript strict mode, and Server Actions.
- Tailwind CSS plus global theme overrides in `src/app/globals.css`.
- Supabase Auth, Postgres, RLS, Storage, and service-role server utilities.
- Supabase `pg_cron` and `pg_net` are intended for frequent production cron calls.
- Vercel production deploys from `main`; normal work happens on `dev`.
- Node version is `22` from `.nvmrc`.
- Verification scripts live in `package.json`: `npm run lint`, `npm run typecheck`, `npm run build`, `npm run verify`, `npm run e2e:smoke`, and `npm run e2e`.

## Important Routes

- `/` redirects authenticated complete profiles to `/dashboard`, incomplete profiles to `/onboarding`, and guests to `/login`.
- `/login`, `/signup`, `/forgot-password`, `/reset-password`, and `/auth/callback` implement Supabase email/password, signup confirmation, and password recovery.
- `/onboarding` requires full name, team name, phone number, and phone carrier before app access.
- `/dashboard` is the participant hub with links to picks, leaderboard, rules, feedback, contact admin, and admin dashboard when applicable.
- `/picks` shows the active race, pick lock state, saved submission snapshot, driver groups, average-speed input, and an unsaved-change guard. Standard races show six groups; Indy 500 races show eight groups after qualifying order import.
- `/leaderboard` has tabs for season standings, picks by race, and personal analytics.
- `/feedback` records participant bug/improvement submissions.
- `/rules` serves the rules PDF from `public/docs/2026-mound-hounds-rules-and-regulations.pdf`.
- `/admin` is admin-only and has tabs for drivers, races, race results, and feedback.
- `/api/cron/fantasy-winner` finalizes due race winners.
- `/api/cron/pick-reminders` sends due pick reminders.

## Auth And Access Control

- `middleware.ts` protects `/dashboard`, `/onboarding`, `/picks`, `/leaderboard`, `/admin`, and `/feedback`.
- Authenticated users visiting `/login` or `/signup` are redirected to `/onboarding`.
- `src/lib/profile.ts` defines a complete profile as having full name, team name, phone number, and phone carrier.
- `src/lib/admin.ts` provides `requireAdmin()`, which redirects non-admins to the dashboard with an admin-required message.
- Supabase RLS is enabled in `supabase/schema.sql`. Participants can read/update their own profile and picks; admins can write drivers, races, results, and feedback. `race_driver_groups` and `pick_reminders` are admin-readable.

## Data Model

The consolidated database definition is `supabase/schema.sql`; migrations for existing projects are in `supabase/migrations/`.
`src/lib/supabase/schema-compat.ts` contains temporary missing-column fallbacks so an unmigrated Supabase database still loads standard race/admin/pick screens. Indy 500 features require `supabase/migrations/20260528_add_indy_500_pick_format.sql` to be applied.

- `profiles`: extends Supabase auth users with full name, unique team name, phone/carrier, and `admin` or `participant` role.
- `drivers`: active/inactive INDYCAR drivers with image URL, championship points, current standing, and current group number.
- `races`: race metadata, `pick_format` (`standard` or `indy_500`), qualifying start, race start, payout, optional title image, official winning average speed, fantasy winner fields, and archive status.
- `picks`: one row per user/race with average speed, six required standard driver IDs, and two nullable Indy-only driver IDs.
- `results`: official driver points per race.
- `race_driver_groups`: race-specific group snapshot used to keep scoring stable after standings/groups refresh; for Indy 500 it stores qualifying position and groups 1-8.
- `feedback_items`: participant feedback submissions.
- `pick_reminders`: dedupe/log table for reminder delivery.

Key database triggers:

- `enforce_pick_deadline()` blocks insert/update after the race-specific pick deadline and blocks archived races. Standard lock is qualifying start; Indy 500 lock is race start.
- `validate_pick_groups()` ensures each selected driver is active, in the matching group, and distinct. Standard validates current driver groups 1-6; Indy validates race-specific qualifying groups 1-8.
- `handle_new_user()` auto-creates a profile when a Supabase auth user is created.
- `ensure_race_driver_groups_snapshot_from_results()` snapshots active standard driver groups before result rows are inserted or moved to a race. Indy 500 results require qualifying order to already exist.

## Core League Rules And Scoring

- Standard races: each participant picks one driver from each of six groups before qualifying begins.
- Standard race groups are based on current active driver championship standings: places 1-4 are group 1, 5-8 group 2, 9-12 group 3, 13-16 group 4, 17-20 group 5, and the rest group 6.
- Indianapolis 500 races are marked with `races.pick_format = 'indy_500'`. Participants pick after qualifying order is uploaded, choose 8 drivers from 8 qualifying-order groups, and picks lock at race start instead of qualifying start.
- Indy 500 qualifying groups come from `race_driver_groups`: groups 1-7 have four drivers each and group 8 has five drivers, based on qualifying positions 1-33.
- Race scoring uses the `race_driver_groups` snapshot for that race, falling back to picked group/current group only when snapshot data is missing.
- A participant's race score is the sum of the official points for their picked drivers: six for standard races, eight for the Indy 500.
- Participants without picks for a completed race receive the lowest possible score for that race, calculated as the lowest scoring driver from each race-specific group.
- Highest and lowest possible race benchmarks are shown for the latest completed race.
- Weekly ordering is handled by `src/lib/weekly-ranking.ts`: highest points first; average-speed tiebreak applies only among first-place weekly ties; other ties fall back to team name and competition ranks where appropriate.
- Season standings are cumulative across non-archived races that have results. Current rank changes compare latest and previous completed race standings.

## Admin Workflow

- Drivers can be manually created/updated/deleted, marked inactive, given image uploads, or seeded from pasted INDYCAR championship standings.
- Importing standings uses `src/lib/championship-standings.ts`, updates/creates drivers by normalized name, then refreshes standings/groups.
- Races can be created/updated/deleted/archived with standard or Indy 500 pick rules, qualifying start, race start, payout, and optional title image upload.
- The Race Results tab has an Indianapolis 500 qualifying-order importer that expects positions 1-33, maps drivers by normalized name, and writes `race_driver_groups.qualifying_position` plus derived groups.
- Manual result entry and bulk INDYCAR result import both call `ensureRaceDriverGroupSnapshot()` before saving results.
- Result import uses `src/lib/indycar-results.ts`, requires clean driver-name mapping, and stores official winning average speed for the weekly tiebreak. The client preview shows matched/unmatched drivers, winner average speed, highest/lowest possible scores, duplicate/ignored rows, and no-pick users affected.
- After results save, admin actions refresh driver championship points from all results, refresh current standings/groups, revalidate app paths, and schedule race winner auto-calculation about 15 minutes later.
- Race winner can be manually overridden or auto-calculated with `src/lib/fantasy-winner.ts`.
- Auto-calculation ranks the full participant/admin field using the same weekly scoring model shown on the leaderboard, including lowest-possible-score fallback rows for teams without submitted picks.
- Admin feedback tab lists participant feedback and includes cleanup tooling for automated test artifacts.

## Cron And Notifications

- Cron auth is checked in `src/lib/cron-auth.ts`. In production, `CRON_SECRET` is required and accepted via `Authorization: Bearer <secret>` or `x-cron-secret`.
- Fantasy winner cron calls `finalizeDueRaceWinners()` and finalizes races whose `winner_auto_eligible_at` has passed and are not manual overrides.
- Pick reminder cron calls `sendDuePickReminders()` in `src/lib/pick-reminders.ts`.
- Reminder windows are 4 days, 2 days, and 2 hours before the race-specific pick deadline. Missing-pick participants can receive email plus SMS gateway email, deduped by `pick_reminders`.
- Reminder delivery depends on Resend env vars: `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, and optional `RESEND_REPLY_TO`.

## Storage And Assets

- Branding image path is `public/images/branding/mound-hound.png`, referenced through `src/lib/branding.ts`.
- Driver images upload to a public Supabase Storage bucket named `driver-headshots`.
- Race title images upload to a public Supabase Storage bucket named `race-title-images`.
- Server Action upload size is raised to `12mb` in `next.config.ts`; helper limits are 5MB for driver images and 8MB for race title images.

## Time Handling

- League timezone is `America/Indiana/Indianapolis` in `src/lib/timezone.ts`.
- Admin datetime-local inputs are interpreted in league time and stored as ISO timestamps.
- Season filtering uses the league-local calendar year.
- Pick page race selection prefers a recently started race within the last 24 hours, then the next upcoming race, first within the current league season and then as fallback across all races.

## Testing

- Playwright config starts `npm run dev -- --port 3007` unless `PW_USE_EXISTING_SERVER=1` is set.
- Smoke test: `tests/e2e/public-auth.spec.ts` covers public signup validation and account creation cleanup.
- Full mutation flow: `tests/e2e/full-flow.spec.ts` seeds Supabase users/drivers/races, uploads a race banner, submits picks, verifies unsaved-change guard, locks picks, enters results, checks leaderboard filters/sorts/analytics, submits feedback, archives a race, and cleans up.
- Indy 500 mutation flow: `tests/e2e/indy-500-flow.spec.ts` seeds a 33-driver qualifying field, creates an Indy 500 race, verifies picks are unavailable before qualifying import, imports qualifying order, submits 8 picks, checks race-start lock behavior, verifies the results publish preview, inserts race results, checks G7/G8 leaderboard display/scoring, and cleans up.
- E2E tests require `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`, read from process env or `.env.local`.
- The full flow intentionally restores driver standings/points it changes.

## Files To Check First For Future Changes

- Auth and onboarding: `src/app/actions/auth.ts`, `src/app/login/page.tsx`, `src/app/signup/page.tsx`, `src/app/onboarding/page.tsx`, `middleware.ts`.
- Picks: `src/app/picks/page.tsx`, `src/app/picks/actions.ts`, `src/components/pickem-form.tsx`, `src/components/pick-submission-snapshot.tsx`.
- Leaderboard/scoring: `src/app/leaderboard/page.tsx`, `src/lib/scoring.ts`, `src/lib/weekly-ranking.ts`, `src/components/standings-table.tsx`, `src/components/picks-by-race-table.tsx`.
- Admin: `src/app/admin/page.tsx`, `src/app/admin/actions.ts`, `src/components/admin-results-import-form.tsx`.
- Race format helpers: `src/lib/race-format.ts`, `src/lib/qualifying-order.ts`.
- Data and security: `supabase/schema.sql`, `supabase/migrations/`, `src/lib/supabase/`, `src/lib/admin.ts`.
- Cron: `src/app/api/cron/fantasy-winner/route.ts`, `src/app/api/cron/pick-reminders/route.ts`, `src/lib/fantasy-winner.ts`, `src/lib/pick-reminders.ts`.

## Project Invariants To Preserve

- Do not score races from mutable current groups when a race-specific snapshot exists.
- Do not allow pick submissions after the race-specific pick deadline or for archived races.
- Keep the Indianapolis 500 exception explicit through `pick_format`; do not infer it from race name.
- Keep admin result import and manual result entry behavior aligned.
- Revalidate `/admin`, `/picks`, and `/leaderboard` after changes that affect drivers, races, picks, results, winners, or feedback.
- Avoid deleting drivers that are referenced by picks or results; mark inactive instead.
- Treat README and deployment docs as user-facing; update this context file when implementation-level behavior changes.
