# Mound Hounds Pick'em Project Context

Last reviewed: 2026-07-30

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
- Verification scripts live in `package.json`: `npm run lint`, `npm run typecheck`, `npm run test`, `npm run build`, `npm run verify`, `npm run e2e:smoke`, and `npm run e2e`.

## Important Routes

- `/` redirects authenticated complete profiles to `/dashboard`, incomplete profiles to `/onboarding`, and guests to `/login`.
- `/login`, `/signup`, `/forgot-password`, `/reset-password`, and `/auth/callback` implement Supabase email/password, signup confirmation, and password recovery.
- `/onboarding` requires full name and team name. Phone and carrier are optional while delivery is email-only.
- `/season-registration` lets a returning account join or skip the current season without admin approval.
- `/race-center` redirects to `/dashboard` for old bookmarks.
- `/dashboard` is the single race-week home for next action, saved picks, compact quick links, profile details, and admin readiness. It intentionally does not duplicate latest-race results.
- `/more` keeps secondary mobile navigation for rules, feedback, contact, and admin out of the primary race-week view.
- `/picks` shows the active race, pick lock state, saved submission snapshot, driver groups, average-speed input, local draft recovery, and an unsaved-change guard. Standard races show six groups; Indy 500 races show eight groups after qualifying order import.
- `/leaderboard` has tabs for current season standings, picks by race, personal analytics, and finalized Hall of Fame seasons.
- `/feedback` records participant bug/improvement submissions.
- `/rules` serves the active season's configured rules PDF, with the bundled 2026 PDF as the 2026 fallback.
- `/admin` is admin-only and has tabs for participants, drivers, races, race results, feedback, system health, and guided season recovery.
- `/api/admin/season-backups` is an app-admin-authenticated JSON backup, preview, import, and restore endpoint.
- `/api/cron/fantasy-winner` finalizes due race winners.
- `/api/cron/pick-reminders` sends due pick reminders.

## Auth And Access Control

- `middleware.ts` protects `/dashboard`, `/onboarding`, `/season-registration`, `/picks`, `/leaderboard`, `/admin`, and `/feedback`.
- Authenticated users visiting `/login` or `/signup` are redirected to `/dashboard`, whose
  centralized account loader sends only incomplete profiles to onboarding and only undecided
  profiles to active-season registration.
- `src/lib/profile.ts` defines a complete profile as having full name and team name.
- `src/lib/authenticated-user.ts` centralizes auth, profile completion, active season, and yearly registration routing.
- Profiles persist across years. `season_participants` stores each profile's `registered` or `declined` decision for a season. A newly activated season therefore prompts returning users at their next login.
- `src/lib/admin.ts` provides `requireAdmin()`, which redirects non-admins to the dashboard with an admin-required message.
- Supabase RLS is enabled in `supabase/schema.sql`. Participants can update their own profile details but a database trigger prevents role changes. Draft results are admin-only; participants can read published results. Admins can write drivers, races, results, and feedback.

## Data Model

The consolidated database definition is `supabase/schema.sql`; migrations for existing projects are in `supabase/migrations/`.
Indy 500 features require `supabase/migrations/20260528_add_indy_500_pick_format.sql`. Role protection and atomic draft/published results require `supabase/migrations/20260709_harden_roles_and_result_publication.sql`. Explicit seasons require `supabase/migrations/20260718_add_league_seasons_and_active_participants.sql`; yearly enrollment and resilient reminder delivery require `supabase/migrations/20260718_add_season_enrollment_and_delivery_hardening.sql`; invite-code, race-field, audit, and job-heartbeat hardening requires `supabase/migrations/20260725_harden_race_and_season_operations.sql`; shared doubleheader pick deadlines require `supabase/migrations/20260726_add_shared_pick_windows.sql`; bounded reminder queues and degraded job health require `supabase/migrations/20260729_scale_weekly_operations.sql`; atomic pick versions and guided season recovery require `supabase/migrations/20260730_atomic_picks_and_season_recovery.sql`; bounded recovery storage, sparse job history, and registration-attempt protection require `supabase/migrations/20260818_bound_recovery_jobs_and_registration.sql`; bounded first-party incident reporting requires `supabase/migrations/20260821_add_application_error_inbox.sql`.

- `profiles`: permanent Supabase auth identities with full name, unique team name, optional phone/carrier, role, and account eligibility.
- `league_seasons`: explicit upcoming/active/completed seasons. Only one can be active.
- `season_participants`: per-season self-registration decisions, independent from permanent profiles.
- `season_registration_secrets`: one-way hashes for per-season private invite codes; authenticated clients cannot read this table.
- `drivers`: active/inactive INDYCAR drivers with image URL, championship points, current standing, and current group number.
- `races`: race metadata, `results_status` (`draft` or `published`), publication time, `pick_format` (`standard` or `indy_500`), `pick_window_key`, qualifying/race start, payout, official speed, winner fields, and archive status. Two consecutive standard races may share a pick-window key and qualifying deadline while remaining independently scored.
- `picks`: one authoritative current row per user/race with average speed, six required standard driver IDs, and two nullable Indy-only driver IDs. Each successful resubmission atomically replaces this scoring row.
- `pick_submission_versions`: append-only audit history for successful pick saves; these rows are not used directly for scoring.
- `app_error_events`: admin-only, sanitized application incidents. Repeated errors are grouped; resolved incidents expire after 30 days and total retained incidents are capped at 500.
- `results`: official driver points per race.
- `race_driver_groups`: race-specific group snapshot used to keep scoring stable after standings/groups refresh; for Indy 500 it stores qualifying position and groups 1-8.
- `feedback_items`: participant feedback submissions with new/in-review/resolved workflow state.
- `pick_reminders`: delivery queue/dedupe log with attempts, failure details, lease expiry, and provider ID.
- `app_metadata`: small deployment contract table; the admin health page checks its schema version.
- `admin_audit_events` and `job_runs`: admin mutation history and scheduled-job heartbeat/failure records.
- `hall_of_fame_seasons` and `hall_of_fame_entries`: immutable final standings snapshots independent of live profiles, races, and picks.
- `season_restore_points`: immutable, checksummed active-season snapshots used by guided backup and recovery.

Key database triggers:

- `enforce_pick_deadline()` requires active-season registration and blocks insert/update after the race-specific deadline, for archived races, and while every race in the previous pick window is not yet published.
- `protect_profile_role()` prevents a participant from assigning or changing profile roles.
- `validate_pick_groups()` freezes and validates against the race-specific driver field so later driver changes cannot invalidate saved picks.
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
- Season standings are cumulative across non-archived races with published results. Draft rows never affect participant scoring or driver groups.
- `src/lib/scoring-engine.ts` owns shared pure score/pick/group calculations used by leaderboard scoring, winner calculation, and admin audits.
- `src/lib/season-scoring-model.ts` computes standings and every participant's analytics in one pass; `src/lib/scoring.ts` loads and caches that shared model for leaderboard consumers.
- Current scoring, analytics, fantasy winners, and reminders load only registered profiles and active-season race data.
- Registration time does not create a scoring cutoff. A participant who registers late receives the normal no-pick fallback for every already-published race.

## Admin Workflow

- Drivers can be manually created/updated/deleted, marked inactive, given image uploads, or seeded from pasted INDYCAR championship standings.
- Importing standings uses `src/lib/championship-standings.ts`, updates/creates drivers by normalized name, then refreshes standings/groups.
- Races can be created/updated/deleted/archived with standard or Indy 500 pick rules, qualifying start, race start, payout, and optional title image upload. Consecutive standard races can be linked to one shared deadline from the race editor.
- The Race Results tab has an Indianapolis 500 qualifying-order importer that expects positions 1-33, maps drivers by normalized name, and writes `race_driver_groups.qualifying_position` plus derived groups.
- Manual entries save draft rows and temporarily remove a corrected race from published scoring. Draft publication requires every snapshotted driver plus official winning average speed.
- Bulk import uses `publish_race_results()` to publish a unique, contiguous official finishing order atomically. Standard-race drivers in the pickable snapshot but absent from that order are stored as zero-point nonstarters; Indianapolis still requires all 33 drivers. The server validates field membership even if client preview is bypassed.
- Publication refreshes championship points from published races only, updates groups, revalidates app paths, and recalculates the fantasy winner immediately. A pending timestamp and hourly cron provide fallback recovery after a temporary calculation failure.
- Race winner can be manually overridden or auto-calculated with `src/lib/fantasy-winner.ts`.
- Auto-calculation ranks the full participant/admin field using the same weekly scoring model shown on the leaderboard, including lowest-possible-score fallback rows for teams without submitted picks.
- Admin feedback is status-filtered and paginated; test cleanup remains under advanced maintenance.
- Participant management edits profile labels, account eligibility, and current-season registration atomically; routine registration is self-service through the season invite code.
- Admin data loading is tab-scoped. The Results workspace defaults to the next unpublished race and loads picks, result rows, race-driver groups, imports, and scoring audit data for only that selected race.
- Race management loads one selected season at a time. Recovery creates portable downloads,
  automatic post-publication snapshots, previews, checksum validation, and transactional restore.
- Race Week reports the schema contract, active season, registration count, next-race gate, delivery toggles, reminder queue totals, degraded cron runs, targeted failed-delivery retries, application incidents, and admin audit history.
- Admin mutations are separated by domain under `src/app/admin/*-actions.ts`; tab-specific server workspaces live under `src/components/admin-*-workspace.tsx`. `src/app/admin/page.tsx` owns authorization, tab-scoped loading, and orchestration rather than every form implementation.

## Cron And Notifications

- Cron auth is checked in `src/lib/cron-auth.ts`. In production, `CRON_SECRET` is required and accepted via `Authorization: Bearer <secret>` or `x-cron-secret`.
- Fantasy winner cron calls `finalizeDueRaceWinners()` and finalizes races whose `winner_auto_eligible_at` has passed and are not manual overrides.
- Pick reminder cron calls `sendDuePickReminders()` in `src/lib/pick-reminders.ts`.
- Automated reminder windows are 2 days and 4 hours before the race-specific pick deadline; the league administrator sends the earlier form-open announcement manually. The deadline is qualifying start for standard races and race start for the Indy 500. A shared doubleheader sends one deduplicated weekend email listing only missing race forms. Only registered profiles without all required picks receive it. Delivery rows are prepared persistently and processed in batches of 25 with five concurrent sends; failed attempts retry with a lease and deterministic Resend idempotency key. Carrier-gateway SMS remains disabled unless explicitly enabled.
- Reminder delivery depends on `PICK_EMAILS_ENABLED=true`, plus Resend env vars `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, and optional `RESEND_REPLY_TO`. Carrier-gateway SMS is disabled unless `REMINDER_SMS_ENABLED=true`.

## Storage And Assets

- Branding image path is `public/images/branding/mound-hound.webp`, referenced through `src/lib/branding.ts`.
- Driver images upload to a public Supabase Storage bucket named `driver-headshots`.
- Race title images upload to a public Supabase Storage bucket named `race-title-images`.
- Server Action upload size is raised to `12mb` in `next.config.ts`; helper limits are 5MB for driver images and 8MB for race title images.

## Time Handling

- League timezone is `America/Indiana/Indianapolis` in `src/lib/timezone.ts`.
- Admin datetime-local inputs are interpreted in league time and stored as ISO timestamps.
- Season filtering uses the league-local calendar year.
- Pick page race selection uses the next active-season pick window. Shared doubleheaders show one
  race form at a time and default to the first missing submission.

## Testing

- Vitest unit tests cover the shared 90-participant season scoring model, weekly ranking, bounded reminder queues, reminder-window boundaries, race lifecycle rules, and both admin text import parsers.

- Playwright config starts `npm run dev -- --port 3007` unless `PW_USE_EXISTING_SERVER=1` is set.
- Read-only production smoke: `tests/e2e/production-readonly.spec.ts` checks public pages and protected redirects without creating data.
- Mutating auth test: `tests/e2e/public-auth.spec.ts` covers signup validation and account creation cleanup on isolated Supabase only.
- Full mutation flow: `tests/e2e/full-flow.spec.ts` seeds Supabase users/drivers/races, uploads a race banner, submits picks, verifies unsaved-change guard, locks picks, enters results, checks leaderboard sorting/analytics, submits feedback, archives a race, and cleans up.
- Indy 500 mutation flow: `tests/e2e/indy-500-flow.spec.ts` seeds a 33-driver qualifying field, creates an Indy 500 race, verifies picks are unavailable before qualifying import, imports qualifying order, submits 8 picks, checks race-start lock behavior, verifies the results publish preview, inserts race results, checks G7/G8 leaderboard display/scoring, and cleans up.
- Mutating E2E requires `PW_ALLOW_SUPABASE_E2E=1` plus `E2E_SUPABASE_URL`, `E2E_SUPABASE_ANON_KEY`, and `E2E_SUPABASE_SERVICE_ROLE_KEY` from the process environment. It refuses normal `.env.local` database credentials and must use a dedicated/local Supabase project.
- Global setup/teardown removes exact-pattern Playwright artifacts and recomputes published driver standings.

## Files To Check First For Future Changes

- Auth and yearly registration: `src/app/actions/auth.ts`, `src/app/login/page.tsx`, `src/app/signup/page.tsx`, `src/app/onboarding/page.tsx`, `src/app/season-registration/page.tsx`, `src/lib/authenticated-user.ts`, `middleware.ts`.
- Picks: `src/app/picks/page.tsx`, `src/app/picks/actions.ts`, `src/components/pickem-form.tsx`, `src/components/pick-submission-snapshot.tsx`.
- Leaderboard/scoring: `src/app/leaderboard/page.tsx`, `src/lib/scoring.ts`, `src/lib/season-scoring-model.ts`, `src/lib/scoring-engine.ts`, `src/lib/weekly-ranking.ts`, `src/components/standings-table.tsx`, `src/components/picks-by-race-table.tsx`.
- Admin: `src/app/admin/page.tsx`, `src/app/admin/actions.ts`, `src/components/admin-results-import-form.tsx`.
- Race format helpers: `src/lib/race-format.ts`, `src/lib/qualifying-order.ts`.
- Data and security: `supabase/schema.sql`, `supabase/migrations/`, `supabase/operations/`, `src/lib/supabase/`, `src/lib/admin.ts`.
- Cron: `src/app/api/cron/fantasy-winner/route.ts`, `src/app/api/cron/pick-reminders/route.ts`, `src/lib/fantasy-winner.ts`, `src/lib/pick-reminders.ts`.

## Project Invariants To Preserve

- Do not score races from mutable current groups when a race-specific snapshot exists.
- Do not allow pick submissions after the race-specific pick deadline or for archived races.
- Do not merge doubleheader picks, results, speed tie-breakers, or scoring rows; only the qualifying
  deadline and field-freeze window are shared.
- Do not expose draft results or use them for standings, reminders, next-race groups, or winners.
- Do not use `profiles.is_active` as yearly enrollment; use `season_participants`.
- Do not include unregistered profiles in current standings, analytics, winners, or reminders.
- Do not run mutating Playwright tests against live/shared Supabase.
- Keep the Indianapolis 500 exception explicit through `pick_format`; do not infer it from race name.
- Keep admin result import and manual result entry behavior aligned.
- Revalidate `/admin`, `/picks`, and `/leaderboard` after changes that affect drivers, races, picks, results, winners, or feedback.
- Avoid deleting drivers that are referenced by picks or results; mark inactive instead.
- Treat README and deployment docs as user-facing; update this context file when implementation-level behavior changes.
