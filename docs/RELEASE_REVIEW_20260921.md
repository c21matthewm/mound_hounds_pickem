# Dev release review — 2026-09-21

The reviewed changes are saved locally on `dev`. Local validation passed; this is **not yet a
main-branch release approval**. Apply the new migration, regenerate the database contract and
complete the signed-in checks below first. No commits, pushes, merges, deployments or live
Supabase data changes were performed in this review.

## Release follow-up — 2026-09-22

The administrator confirmed the seventh migration was installed, reviewed the app without
seeing problems, and authorized committing/pushing dev and merging/pushing main. `npm run
db:types` regenerated the new RPC contracts from the installed schema; the diff was reviewed
and `npm run db:types:check` passed. Changes from the preceding verified source are limited to
the regenerated type file and release notes. The original audit and instructions below remain
as the dated review record; the migration/type-refresh gates are now satisfied.

Completion of 2026 is intentionally deferred to the administrator. 2027 will be prepared and
started when more official season information is available. Neither decision is a requirement
to publish these controls, and no live season status was changed during the Git release.

## What the review found and fixed

### Saving an archive did not end the active season

`finalizeHallOfFameSeasonAction` saved final standings, but only activating a successor completed
the outgoing season. That left archived 2026 active and offered no normal Admin way to enter
an off-season without also opening 2027.

`src/app/admin/season-closeout-actions.ts`, `src/components/admin-seasons-workspace.tsx` and
`supabase/migrations/20260921_season_completion.sql` now provide two explicit steps: **Save Final
Standings**, then **Complete [year] season** after review. Imported 2026 uses the existing archive
and requires zero operational races. A regular app season requires all scheduled races to be
published, no future race, one champion and an archive that matches fresh scoring.

Closeout compares the expected archive and a source fingerprint under database locks. Changes
to relevant profiles, roster, schedule, registrations, picks or results during calculation cause
a retryable conflict. The backup, status change and audit are one transaction, so a backup or
audit failure cannot leave a partly completed season. Lock contention fails promptly rather
than keeping normal writers queued behind a long closeout. Repeated completion is idempotent.
The locks cover whole tables; closeout/activation are rare and should occur away from live edits.
These checks are not a runtime or load test for large leagues.

Activation now requires no other active season and the existing invite/roster prerequisites.
Its backup, opening-seed/point reset, status change and audit are atomic. Neither closeout nor
migration installation creates 2027, deletes accounts or changes saved Hall of Fame standings.

### The off-season needed consistent routing and editing behavior

`src/lib/authenticated-user.ts` previously required registration even when no season existed,
preventing Picks from displaying its off-season state. The registration guard now applies only
when a season is active. Dashboard says **Between seasons**, Leaderboard defaults to Hall of
Fame, analytics does not request impossible registration, and Rules explains the next-season
state. Existing active-season registration and scoring rules remain in force.

Participant edits now call `admin_update_participant_v2` with the expected active-season ID.
Explicit null means no active season. Names, teams and eligibility can be edited between seasons
without altering historical or upcoming enrollment. A form opened before a lifecycle change
cannot silently affect another season. Active-season forced-removal and submitted-pick guards
are retained by delegating to the established mutation.

### Completion would have hidden the recovery milestone

Admin previously loaded only active-season restore points. The Recovery page now selects a year
and loads bounded metadata for that season. Completed-season downloads and comparisons remain
available both between seasons and after a later season starts. Fresh backup creation and
restore remain active-season operations; the UI does not offer to restore an old season over a
new one or reopen a completed season. The database restore guard is unchanged.

### Base schema health did not verify the new Admin capabilities

System Health now checks nine capability RPCs and authenticated execution permissions separately
from the unchanged base schema version. Missing/unavailable checks are visible. Between seasons,
stale race-job heartbeats no longer create a false alarm, while recorded failures and application
errors remain visible. The winner job selects active-season, published races only; completion
clears queued winner eligibility. A calculation already running is not forcibly cancelled.

## Broader review conclusions

| Area | Evidence and result |
| --- | --- |
| League management | Seasons, roles, individual/bulk participants, opening roster, race fields, results, rules, archives and recovery use the existing Admin workspaces. The missing closeout and completed-backup access are now covered. |
| Data integrity | Archive identity/source checks, authorization rechecks and atomic audit/backup behavior prevent stale or partial closeout. Existing role, pick-removal, field freeze, results publication and historical-import safeguards passed local regression checks. |
| Participant UX | Between-season routing and copy are consistent. Mobile Admin fixtures fit 320–1280px. Confirmation cancellation and form payloads were checked. These are offline component checks, not real phone/session testing. |
| Queries and bandwidth | New capability loading is scoped to System Health. Recovery loads summaries for one year, not snapshot bodies. Closeout performs fresh scoring and a season snapshot only when explicitly requested. No new polling or dependency was added. |
| Architecture | Existing server actions, scoring model, RPCs and recovery functions are reused. No scoring rewrite, replacement authorization layer or new index was needed for these rare lifecycle actions. |
| Operational safety | Signed-in UI testing, actual Storage PDF delivery, provider configuration and dependency advisory freshness are not established by the offline suites. Live services were not probed to test hypotheses. |

## Validation performed

- **550 unit tests / 59 files:** passed, including scoring, imports, authorization, uploads,
  off-season access, closeout actions, health diagnostics and recovery rendering.
- **70 browser checks:** passed with all network requests blocked: 55 responsive layouts across
  320, 375, 390, 768 and 1280px, plus 15 interactions. Actions/HTTP are mocked. Zero attempted
  network requests or browser exceptions. Screenshots were captured, not manually inspected.
- **32 new lifecycle PostgreSQL checks:** passed with real snapshot/backup/retention functions.
- **Existing database regressions:** 17 roles, 20 driver roster, 27 participant batches and
  14 field freezing checks passed; historical archive import, rules documents and portable
  backup export/import/restore suites also passed. Concurrency, stale state, audit rollback,
  checksums and permission boundaries are covered by these targeted fixtures.
- **All 14 affected RPC/trigger definitions:** match consolidated `supabase/schema.sql` exactly.
- **TypeScript, full ESLint and Next.js production build:** passed. The build used Webpack in
  an isolated credential-free tree and did not interfere with `.next/dev` or port 3007.

Database suites create disposable PostgreSQL containers from cached images, use no networking,
and never read application credentials. They exercise targeted functions with representative
fixtures rather than reproducing the full hosted Supabase environment. The earlier authorized
`db:types` read verified the first six installed migrations; it predates this new migration.

## Before a main-branch release

1. In the intended Supabase project, open **SQL Editor > New query**. Copy the entire contents of
   [20260921_season_completion.sql](../supabase/migrations/20260921_season_completion.sql), paste
   and **Run**. This is the only new migration from this pass. If it fails, preserve the script
   and error for review. Do not re-import 2025/2026 or repeat the old prelaunch cleanup.
2. Refresh **Admin > System Health**. Confirm the base contract is healthy and all nine Admin
   capabilities show **Installed**. The expected base version still ends in
   `portable_season_backups_v2`; optional capabilities have their own check.
3. Run `npm run db:types`, inspect the diff, then `npm run db:types:check`. Four new RPC types
   are currently local declarations. The generator preserves the required nullable
   `admin_update_participant_v2.p_expected_season_id` argument. Do not replace it with a
   non-nullable number. Repeat `npm run verify:release` after this contract refresh, with the
   dev server stopped if necessary to avoid sharing Next build artifacts.
4. Review **Leaderboard > Hall of Fame > View 2026 final standings**. In **Admin > Seasons &
   League**, select **Complete 2026 season** and confirm. The imported archive is already saved;
   do not use a fresh import or archive refresh. Verify **No active season** afterward.
5. Check Dashboard, Picks, Leaderboard and Rules while signed in, on desktop and a phone. Verify
   the off-season messages and the existing 2025/2026 archives. In Recovery select 2026 and
   confirm the completion milestone can be downloaded; do not perform a restore merely to test.
6. In Participants confirm profile/eligibility editing is available and active-season
   registration is disabled. Prepare 2027 in Seasons & League when ready; creating an upcoming
   season does not open registration. Activate it only when the league should open.

After saving the reviewed files, login returned HTTP 200 on both `http://localhost:3007` and
`http://192.168.1.8:3007`. The server listens on all interfaces. Use the Wi-Fi address on a phone
on the same network; the former `.76` address is no longer current. Local HTTP success does not
verify the phone's network path or an authenticated Supabase session.

## Deliberate boundaries

The single-champion tiebreak, race-specific driver snapshots, permanent accounts, independent
Hall of Fame archives and established registration model remain intact. Completed seasons
cannot be reopened with the activation button, and restoration remains limited to the active
season; review/correct final standings before completing a season.

Storage deletion remains deferred because older images/PDFs may be referenced by recovery
points or downloaded backups. The read-only media audit is available; the legacy cleanup CLI
is not a substitute for coordinated deletion across all references and writers. No live email
or cron configuration was enabled, and this work does not certify external service readiness.
