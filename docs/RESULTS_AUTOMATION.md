# Technical reference: results and device notifications

Use [START_HERE.md](START_HERE.md) for the commissioner setup and the four participant
steps. This page is the engineering reference, not an additional setup checklist.

## Normal deployment

There is one recommended route: Supabase's existing clock checks the race calendar
and dispatches the GitHub worker only when a race needs checking. That worker runs
`python -m services.monitor_results --once --in-process`; the same authenticated
FastAPI ingestion route executes through local ASGI transport. No always-on Python
server, public Python host or second cron service is required.

The workflow is dispatch-only, disabled until the repository variable is enabled.
`04_configure_results_monitor_cron.sql` installs a cheap one-minute database calendar check.
Outside an enabled active-season race window it makes **no external request**.
It opens at scheduled green flag+150 minutes, follows confirmed calendar changes,
and enforces a 15-minute source cadence with a five-minute claim lease. A suspended-race override can delay checking
without changing picks. Provisional results keep checking; verified official
staging stops it atomically even when the preview has mapping flags.

GitHub may delay jobs. Fifteen minutes is minimum/target spacing, not guaranteed
wall-clock execution. Workflows must exist on the default branch; this branch does
not run merely because its file exists. Protected Vercel Preview URLs cannot be
called using the app's bridge secret alone. Use the reviewed public app origin.

Primary operational references: [GitHub workflow dispatch permissions](https://docs.github.com/en/rest/actions/workflows#create-a-workflow-dispatch-event),
[Actions scheduling](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule),
[GitHub free quotas](https://github.com/pricing),
[Apple Home Screen push](https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers).
Web Push itself needs no paid messaging provider or paid Apple developer account.
Existing hosting quotas still apply; a free configuration is not a guarantee of
unlimited future hosting or handset delivery. Avoid 24/7 GitHub timer jobs on private
free accounts: 8,640 five-minute runs per 30 days exceed their 2,000-minute allowance.
The database gate avoids those off-week worker runs. Its own completed clock history
is pruned daily in bounded batches (successes after one day, failures after seven),
without touching other jobs. The fixed GitHub dispatch uses the supported synchronous
`http` extension with a ten-second timeout, not a persistent `pg_net` request queue.
It records only sanitized status codes and shows rejected starts in Admin. A worker
that fails to check in after ten minutes also becomes visible. See [Supabase HTTP](https://supabase.com/docs/guides/database/extensions/http),
[pg_net queue constraints](https://supabase.com/kb/troubleshooting/database-roles-can-read-request-headers-queued-by-pg_net-ad6357)
and [pg_cron history retention](https://github.com/citusdata/pg_cron#viewing-job-run-details).

## Environment map

Private new values are prepared in ignored `.local/notification-setup/`; no values
are displayed in chat. Existing Supabase, Resend and cron secrets are preserved.

| Setting | Where |
| --- | --- |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Next/Vercel |
| `RESULTS_BRIDGE_SECRET` | matching value in Next/Vercel and GitHub Actions Secrets |
| `RACE_RESULTS_WEBHOOK_SECRET` | GitHub Actions Secrets; internal job ingestion |
| `PICK_PUSH_ENABLED` | Next/Vercel; false until intentional rollout |
| `ADMIN_RESULTS_PUSH_ENABLED` | Next/Vercel; still requires device opt-in |
| `PICK_EMAILS_ENABLED`, Resend settings, `CRON_SECRET` | leave current Next settings unchanged |
| `RESULTS_BRIDGE_URL` | GitHub Actions Variable; public HTTPS bridge URL |
| `RESULTS_MONITOR_ENABLED` | GitHub Actions Variable; false until reviewed release is ready |
| `mound_hounds_results_github_token` | Supabase Vault; token scoped to this repository and Actions read/write |
| `RESULTS_MONITOR_ENABLED=true`, loopback ingestion URL | workflow supplies internally after it is enabled |

The Python process never receives a Supabase key or VAPID private key. The bridge
accepts only stage, candidates, monitor_result and bounded maintenance. It cannot
approve or publish. All live publication uses an authenticated Admin session and a
run-bound, expiring approval token. Never log request headers, endpoints, device keys
or private environment files. The generator's default CLI prints a NEW key pair;
`--prepare-setup` instead saves private files and preserves existing prepared keys.

## Database installation and types

Both `20261108_results_automation.sql` and `20261109_web_push_notifications.sql`
were confirmed installed on November 9, 2026. Do not rerun either setup file or
older reset/cleanup scripts. The existing `npm run db:types` workflow read the
installed PostgREST contract; its diff adds only the expected five tables/twelve
functions. The generated types replace the migration-local table/function overlays.
Narrow generator refinements retain the three SQL-supported explicit-null arguments
(calendar override, monitor error and lease token) without making their keys optional.

The installed base schema/result version markers and empty device-table availability
were checked read-only. Admin-only capability/health RPCs were not impersonated.
For future reviewed schema updates, regenerate types, inspect their diff and run
`npm run db:types:check` plus the full application verification. Run build/browser
checks with fictional services to avoid writing real league data or sending devices
messages. Signed-in System Health and actual handset delivery remain operator steps.

Profiles remain email-only and the existing health version is unchanged. Device
subscriptions/cooldowns are excluded from portable season backups. Owner RLS,
strong key validation, fixed relay allowlisting, per-account ten-device bounds and
a database test-send cooldown protect device storage. Expired 404/410 rows are
removed, with endpoint/key matching so a rotated subscription is not deleted.

Pick reminders retain the current 2d/4h windows, previous-results gate, frozen field,
registration/elimination checks and doubleheader window key. Email and push claim
independently. A channel preparation failure does not stop the other. Every device
is rechecked before sending; any accepted send marks sent, while all-expired
subscriptions are pruned without a health alarm. Remaining work stays pending once
the 40s dispatch budget is reached. Keep the existing email clock if it is already
running; do not create duplicate schedules. The Vault-based reminder setup is in
`03_configure_push_reminder_cron.sql` if that clock needs configuring.

## Official-result proof and penalty protection

The fetcher verifies the exact configured INDYCAR page, hidden selectors,
season/event/session and row IDs. It extracts actual race points and the winner's
average speed; it never infers points from finish or season totals.

A populated table, an Official Lap Report, a generic Final Reports link, or a PDF
link is **not** confirmation of post-inspection official results. UNOFFICIAL and
PROVISIONAL markers override an official-looking status. Supported HTML needs an
explicit official result header/status, with race identity. The published JSON
loader's selected Results document is checked through a fixed, session-bound IMS
CDN HTTPS URL. A bounded subprocess reads at most 1MB/four pages with CPU/wall-clock
limits. It requires an explicit official post-race result heading, matching event
and date, every position/car/name/race-points tuple, and matching winning speed.
A stable document hash records evidence without fetch-time churn.

The CDN's published legacy HTTP document was readable during investigation and
showed an Official Lap Report. Its HTTPS certificate did not validate in this
environment. Runtime verification deliberately does not downgrade to HTTP or bypass
TLS; that source remains unconfirmed until verifiable official evidence exists.
Unsupported layouts, conflicting points, missing proof or unavailable documents
remain blocked, with manual entry available. This is a real limit, not a claim
that every publisher format is already supported.

A provisional preview can be staged once; repeated provisional changes do not use
up the preview quota before the official result arrives. Official staging records
its stop marker in the same transaction, including safe duplicate acknowledgments.
An old payload cannot stop a newly configured source. Late penalties after initial
official publication need the existing explicit Admin correction workflow; the
system does not silently revise a live leaderboard after monitoring has stopped.

## Deterministic local checks

All automated checks use fictional data, generated disposable encryption keys,
mocked relays or a network-disabled local PostgreSQL container. No real participant
push, email or production fixture is sent.

```sh
./scripts/with-node.sh npm run audit:prod
./scripts/with-node.sh npm run typecheck
./scripts/with-node.sh npm run lint
./scripts/with-node.sh npm run test:unit
./scripts/with-node.sh npm run test:results:db
PYTHONDONTWRITEBYTECODE=1 PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 .venv/bin/python3.11 -B -m pytest tests/python -q -p no:cacheprovider
./scripts/with-node.sh npm run test:admin:ui
./scripts/with-node.sh npm run test:picks:ui
./scripts/with-node.sh npm run test:pwa
```

The normal production verification command is `npm run verify`. Use a temporary
app with fictional loopback services/no dotenv for automated builds; an ordinary
build can read the configured app environment. The DB runner needs local Docker
and a cached `postgres:16-alpine` image; it never pulls or connects remotely.

## Manual acceptance checks after a reviewed release

Use disposable staging data and your own explicitly opted-in device. Do not seed
fictional schedules/users/results into production. Physical iOS/Android delivery
cannot be established by a mocked automated test.

**Admin flow:** install/open the HTTPS PWA, sign in, enable notifications in Profile
and send a test. Configure a staging race/field and exact source. A new provisional
preview must say waiting, show no publish action and keep polling. A verified
Official preview must alert the Admin, open its Results tab, stop checks, and still
require explicit review/approval. Missing drivers/speed must stay blocked. Repeat
the same input and verify no extra preview/notification.

**Participant flow:** install from Safari Share (iOS 16.4+) or Chrome Install;
open the icon, sign in, enable and test in Profile. Sign out. In staging only, run
the reminder clock during an eligible 2d/4h window with missing picks. Tap the push:
`/picks` → `/login?next=%2Fpicks` → sign in → `/picks`. A password typo must preserve
the destination. Test only the second doubleheader form missing, no duplicate
same-window delivery, and explicit device disable stopping future pushes. Existing
email delivery remains independent.

**Calendar flow:** verify no source/GitHub requests before +150 minutes, one claimed
check per 15-minute slot, provisional continuing, official clean AND flagged previews
stopping, and a postponed start returning to sleep. Dry run changes no lease/state.

For advanced local webhook debugging only, run Uvicorn on loopback 8001 and supply
the explicit Python environment from `services/.env.example`. There is no need to
host it for the recommended route. `/healthz` reports configuration presence only.
Push worker v2 still caches only the two public recovery assets; payloads and
private league pages remain network-only and picks never submit in the background.
