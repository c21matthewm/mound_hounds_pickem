# Installed-migration and app verification — 2026-10-07

The installed schema and current `dev` application passed the checks below. Two issues found
in the signed-in review were fixed locally. No commits, pushes, merges or deployments occurred.
Live Supabase work consisted of schema/data reads and existing-backup preview/export; there
were no account, season, pick, result, archive, recovery-history or configuration changes.

## Installed database and preserved data

- All three September 30 migrations are installed. Signed-in **Admin > System Health** reports
  **System ready**, all eleven capabilities **Installed**, and no open application errors.
- The base schema/health contract remains `20260904_portable_season_backups_v2`. The pick-save
  and recovery-retention markers both report `20260930`.
- `npm run db:types` regenerated the deployed PostgREST contract. Its diff contains the expected
  retention RPCs plus the two owner-only maintenance functions, without unrelated table or
  nullable-argument changes. `npm run db:types:check` passed. Internal maintenance functions
  remain unavailable to public, participant, administrator and service-role callers.
- 2026 is **completed**; there is no active season and 2027 has not been created. The retained
  administrator remains the only account/profile, with all 33 drivers preserved.
- 2025 retains 89 archived entries across 17 races; 2026 retains 78 across 18. Ranks are unique
  and contiguous, row counts match metadata, and combined points match the archive totals.
- No experimental races, picks, results or pick-submission versions remain. Recovery retains
  one completion milestone, with no routine copies eligible for cleanup. The existing file
  downloaded successfully and its SHA-256 checksum matched its exact 25,617-byte snapshot text.

## Fixes from the signed-in review

### Development recovery requests were rejected as cross-origin

Next development can build `Request.url` from its `0.0.0.0` bind address rather than the address
used by the browser. `Preview Restore` consequently returned 403 for a legitimate localhost
request. Browser error reporting used the same comparison and could suffer the same problem.

`src/lib/request-origin.ts` now provides the shared check. Development compares against the
request's actual Host and port; malformed authorities and different origins are rejected.
Production still uses only `canonicalSiteOrigin()`, regardless of Host. Forwarded headers do
not expand accepted origins. Recovery retains its Fetch Metadata, custom-header, signed-token
and admin-authentication guards.

Real localhost and LAN requests now reach authentication (401 without a session), while a
foreign origin remains 403. The signed-in existing-backup comparison succeeds. Regression tests
cover localhost/LAN/IPv6, ports, malformed authorities, forwarded headers, production isolation,
authentication and Recovery's additional guards. Error-reporter tests use mocks and publish
no live incident records.

### Race Calendar offered a form with no eligible season

When only completed seasons existed, the creation form contained an empty required season
selector and still displayed Add race. Its empty-state text told the admin to use that form.

`src/components/admin-races-workspace.tsx` now shows **Prepare the next season** with a link to
**Seasons & League** instead. The link was followed in the signed-in app and opens its working
season controls. Active/upcoming seasons retain the existing creation form. Completed-calendar
empty-state wording no longer suggests adding races to that completed year.

## Verification evidence

| Check | Result |
| --- | --- |
| Full TypeScript, without incremental cache | Passed |
| Full ESLint | Passed |
| Unit tests, including new origin regressions | 622 passed across 64 files |
| Offline Admin component browser checks | 98 passed; widths 320, 375, 390, 768 and 1280 |
| Offline pick-save component browser checks | 21 passed |
| Read-only localhost public browser smoke | 2 passed, desktop and mobile |
| Disposable PostgreSQL suites | All 10 passed |
| Final isolated production build | Passed; all 23 pages generated |

The database suites cover portable recovery, routine retention, unchanged/edited pick saves,
season lifecycle, admin delegation, participant batches, driver batches, field freezing,
historical archives and rules documents. They use fictional records in disposable local
network-disabled PostgreSQL containers. The lifecycle runner now installs the retention
migration too; its 33 checks include completion/activation backups and preservation of a
completion milestone alongside the three routine copies. These checks do not mutate Supabase.

The production build used `next build --webpack` in a temporary source copy with fictional
Supabase configuration and external fetch/HTTP/socket connections blocked. This avoids contact
with live services and avoids changing the running development server's `.next` directory.
The copy was removed afterward. This is build verification, not a deployed-production smoke test.

The authenticated review loaded all eight Admin workspaces, Dashboard, Profile, Picks, all four
Leaderboard views, both complete Hall of Fame archives, More, Rules, participant Feedback and
Contact Admin. Completed-season recovery preview/export work; fresh backups and restores remain
unavailable without an active season. No controls that write live data or send email were used.

At 320 pixels, Dashboard, Rules, Feedback, Contact Admin, season setup, Calendar and Recovery
have no document-wide horizontal overflow. Both archive tables show all their scores within
the page; 2026 was also checked at 390 pixels. The champions comparison and recovery comparison
scroll inside bounded containers. Desktop System Health and mobile responsive views were
reviewed separately. LAN connectivity was checked using the current `192.168.1.76:3007` address;
responsive browser emulation does not establish behavior on every physical phone.

## Scope and next season

There is no live active season in which to submit a pick or publish results. Those mutation,
retention, permission, concurrency, rollback and lifecycle paths were validated in isolated
fixtures rather than by creating production test data. Email delivery, scheduled production
jobs, live cleanup/restore and future-season activation were not triggered. No load test or
claim of universal defect-free behavior is implied by these checks.

When official 2027 information is available, prepare the season through **Seasons & League**,
configure the invite code and roster, and activate it deliberately. The completed historical
archives and one-time prelaunch reset should not be recreated. Git publication remains a
separate explicit administrator decision.
