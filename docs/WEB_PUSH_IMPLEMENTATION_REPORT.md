# Web Push pivot: implementation and verification report

November 9, 2026; implementation prepared on `dev2-webhook-rcs`.
The commissioner authorized release through `dev` into `main`, with automated
delivery disabled and feature-branch deletion conditional on successful deployments.

## 1. Removal summary and complete pivot file inventory

Deleted `services/rcs_notifier.py`, removed the SDK from requirements and the local
project venv, and removed provider/phone configuration, inbound reply handling,
HMAC phone approval, notification claims, delivery columns/provider IDs and their
phone-specific tests. No obsolete local phone environment values were present.
Historical migrations that retired phone data remain intact as required history.

The following paths were changed/added for this pivot (including existing,
uncommitted draft files revised in place):

| Area | Files |
| --- | --- |
| Python removal and staging | `services/app.py`, `services/config.py`, `services/monitor_results.py`, `services/requirements.txt`, `services/official_results_pdf.py`, `services/indycar_results_fetcher.py`, `services/.env.example`, `tests/python/test_results_service.py` |
| Next staging / Admin-only approval | `src/lib/results-automation-contract.ts`, `src/lib/results-automation-handler.ts`, `src/lib/results-automation-store.ts`, `src/lib/results-automation.ts`, `src/app/admin/results-automation-actions.ts`, `src/components/admin-results-automation.tsx`, `src/app/api/internal/results-automation/route.ts` |
| Push transport / persistence / API | `src/lib/web-push.ts`, `src/lib/push-subscriptions.ts`, `src/lib/push-api.ts`, `src/lib/admin-results-push.ts`, `src/lib/supabase/types.ts`, `src/lib/supabase/database.types.ts`, `src/app/api/push/subscription/route.ts`, `src/app/api/push/test/route.ts` |
| Consent and deep links | `src/components/push-notification-settings.tsx`, `src/app/profile/page.tsx`, `src/app/actions/auth.ts`, `middleware.ts`, `public/sw.js` |
| Independent reminder channels / health | `src/lib/pick-reminders.ts`, `src/lib/reminder-queue.ts`, `src/app/api/cron/pick-reminders/route.ts`, `src/app/admin/page.tsx`, `src/components/admin-system-health.tsx`, `src/components/admin-reminders-workspace.tsx` |
| SQL / cron | `supabase/migrations/20261108_results_automation.sql`, `supabase/migrations/20261109_web_push_notifications.sql`, `supabase/schema.sql`, `supabase/operations/02_configure_cron_jobs.sql`, `supabase/operations/03_configure_push_reminder_cron.sql`, `supabase/operations/04_configure_results_monitor_cron.sql` |
| Focused unit coverage | `tests/unit/admin-results-automation.test.tsx`, `tests/unit/results-automation-contract.test.ts`, `tests/unit/results-automation-handler.test.ts`, `tests/unit/results-automation-service.test.ts`, `tests/unit/pwa-service-worker.test.ts`, `tests/unit/web-push.test.ts`, `tests/unit/push-api.test.ts`, `tests/unit/pick-reminders-push.test.ts`, `tests/unit/push-login-redirect.test.ts` |
| Local verification | `scripts/test-results-automation.mjs`, `scripts/test-pwa.mjs`, `scripts/test-admin-ui.mjs`, `tests/browser/admin-ui-fixture.jsx` |
| Configuration / operator tools | `.env.local.example`, `.gitignore`, `package.json`, `package-lock.json`, `scripts/generate-vapid-keys.mjs`, `scripts/generate-supabase-types.mjs`, `tests/unit/database-type-generation.test.ts` |
| CI / optional scheduler | `.github/workflows/verify.yml`, `.github/workflows/results-monitor.yml` |
| Documentation | `README.md`, `docs/PWA.md`, `docs/RESULTS_AUTOMATION.md`, `docs/START_HERE.md`, this report |

Manual entry, the shared preview mapper, domain math, Resend message builder,
email sender, portable backup builder and base health version were preserved.
The fetcher now requires explicit official evidence, rejects contradictory notices
anywhere in the document, and verifies PDF identity/scoring in a bounded subprocess.
Earlier branch cleanup files remain in the worktree; they were not reverted or
reclassified as changes made by this pivot.

## 2. Architecture summary

- Device registration is explicit, per-device and off until opt-in. Ownership is
  enforced in the API and RLS; cryptographic keys/endpoints never enter profiles
  or portable league backups. Ten-device bounds and an account test cooldown
  prevent persistent device-row/test-send growth.
- Vetted `web-push@3.6.7` generates RFC8291 encrypted payloads and VAPID signing;
  Node fetch supplies the total 10s timeout, redirect rejection and body cleanup.
  Browser-relay allowlisting rejects arbitrary/private destinations. Payloads use
  fixed local icons, safe relative targets and no participant identity/pick data.
- Worker v2 preserves exactly two public cached assets. Every push shows a visible
  notification. Clicks navigate/focus an existing same-origin window or open one.
  A small capability handshake handles old installed workers without forced reloads.
- Profile opt-in invokes permission directly from the user gesture. Secure context,
  standalone mode, platform support, denied permission, test feedback, ownership
  mismatch and expired subscriptions have explicit behavior. Sign-out retains
  consent; explicit opt-out stops both device reminder and Admin alerts.
- Pick reminders retain the existing 2d/4h, frozen-field, previous-results,
  registration/active-participant and doubleheader gates. Email and push claims
  are independent. Partial device success marks sent; all-expired devices cause
  clean pruning; one channel's lookup failure does not stop the other. A 40s
  claim budget leaves work for the next cron tick instead of exceeding runtime.
- Only authenticated in-app Admin actions approve/publish. The external bridge
  cannot publish. New staged runs schedule best-effort Admin push with Next after;
  alert failures cannot undo staging. Matching manual publication recognizes the
  clean staged run; changed/flagged previews remain guarded or superseded.
- The dispatch-only GitHub monitor runs FastAPI ingestion inside the ephemeral job
  (`--once --in-process`). A cheap internal database clock wakes it only for enabled
  active-season races after green flag+150 minutes, with >=15-minute source spacing.
  Provisional data keeps checking; verified official staging stops checking atomically.
  History is bounded, dispatch failures appear in Admin, and slow multi-race batches
  rotate unattempted races fairly. Nothing publishes without in-app Admin approval.

## 3. Verification results

The latest follow-up adds official-proof, windowed polling and simpler setup checks.
All listed gates completed successfully on the final implementation. Node commands
were executed through `./scripts/with-node.sh` (Node 24/npm 11.20.0). The full verify
and browser runs used temporary copies, fictional loopback services, no dotenv
files and an external-network guard; no real accounts/devices or league data.

| Requested check | Exit | Exact result / output summary |
| --- | --- | --- |
| `npm run audit:prod` | 0 | `found 0 vulnerabilities` |
| `npm run typecheck` | 0 | `tsc --noEmit`, no diagnostics |
| `npm run lint` | 0 | `eslint .`, no diagnostics |
| `npm run test:unit` | 0 | `Test Files 78 passed (78)`; `Tests 851 passed (851)` |
| `npm run verify` | 0 | lint/typecheck/test/build passed; 28 generated pages; no external requests |
| `npm run test:pwa` | 0 | `PASS: 15 local PWA checks; no real accounts, databases, app credentials, or external application requests.` |
| `npm run test:admin:ui` | 0 | `PASS: 117 offline rendered layout and interaction checks; no browser network requests permitted.` |
| `npm run test:picks:ui` | 0 | `PASS: 35 offline pick-save UI checks; no browser requests permitted.` |
| `npm run test:results:db` | 0 | `PASS: 49 isolated PostgreSQL results-automation checks; no external networking or real league data.` |
| `pytest tests/python` | 0 | `77 passed, 1 warning in 3.61s` using Python 3.11, plugin autoload disabled and no cache/bytecode writes |
| Additional isolated browser regression | 0 | `3 passed` across Chromium desktop/mobile and Firefox; zero external/unexpected fixture requests |
| Workflow YAML syntax | 0 | Both workflow definitions parsed locally |
| `git diff --check` | 0 | no diagnostics |

The current branch adds focused push, approval and scheduler coverage while
removing obsolete phone tests. Single-run timings are observations, not a benchmark
guarantee. Existing tool notices remain: Vite future config-loader,
Node module-type notice in smoke-readiness, and Starlette TestClient httpx adapter
deprecation. They are separate from application/runtime errors; no new lint warning
remains. The Python suite passed again after uninstalling the retired SDK.

After the operator confirmed installation of both migrations, `npm run db:types`
read the deployed schema, its diff was inspected and `npm run db:types:check` was
run. The diff adds only the five expected tables/twelve functions. Three narrow
nullability refinements preserve SQL-supported explicit-null RPC arguments.
Handwritten schema overlays, unsafe client casts and the `pushStore` adapter were
removed; app queries now use the generated installed contract.

Read-only live checks confirmed the unchanged base schema version, results feature
version and available device table with zero enrollments. No authenticated Admin
session was impersonated. Physical iOS/Android delivery, signed-in System Health,
Vercel and GitHub settings were confirmed saved by the operator. Vault configuration,
calendar scheduler setup and actual handset delivery remain pending release.
The operator confirmed Vercel settings were saved and redeployed the prior release;
public login and the unchanged older service worker were checked read-only.
No live notification, email, remote migration, deployment, commit or push was
performed by the agent. The operator applied the two SQL files in Supabase.

## 4. Operator handoff

Use [START_HERE.md](START_HERE.md). The database setup is complete. The Vercel settings were saved. The next step is
completing the approved release and checking its deployments, keeping the worker and push reminders disabled. Private settings files have already been prepared in
ignored `.local/notification-setup/` with directory mode 0700/file mode 0600. Do not
regenerate keys or paste them into chat. No live settings or schedules were changed by the agent.

The guide then walks through Vercel settings, two GitHub secrets/two variables, one
repository-scoped Vault token, the race-only clock and an explicit test on the
commissioner's own phone. There is no separate Python host or messaging provider.
Participants only install the Home Screen app, sign in, enable notifications in
Profile and send a test. Existing email controls stay independent.

Important limit: the supplied live source currently exposes an Official Lap Report,
which is not accepted as post-inspection final proof, and its HTTPS PDF certificate
could not be verified here. The runtime waits instead of bypassing TLS or guessing
finality. Synthetic tests prove the supported parser and guardrails; real publisher
compatibility and physical handset delivery still require the operator checks in
the guide. Later published penalties use the existing explicit Admin correction.

## 5. Earlier non-destructive cleanup

Deleted the unused `src/lib/supabase/client.ts` wrapper. Removed unreferenced
`scheduleRaceWinnerAutoCalculation`/its delay constant, `loadLeagueSeasons`,
`buildParticipantAnalyticsSnapshotUncached`, `textMatch`, `numericMatch` and
`getLeagueSeasonDateRange`. Manual and automated result paths share
`buildRaceResultsPreview`, avoiding duplicate driver matching/validation logic.
Two low-value tests were removed and duplicate email cases parameterized. Protected
name/alias, group scoring, missing-pick, speed tiebreak and leaderboard transition
coverage remains.

Before cleanup: 723 unit tests in 69 files, 7.72s. Cleanup-only: 721 in 69 files, 5.93s.
With the new feature coverage: 851 in 78 files, 6.48s (net +128 tests from the original
baseline). Python service: 77 tests; isolated PostgreSQL: 49 checks. Full-suite
execution times vary with parallel activity; the observed cleanup timing does not
establish a general speed guarantee. No production data was used or modified.
