# One-time transition from experimental 2026 to the real 2027 league

This is a dated maintenance procedure, not a recurring season rollover or an application feature.
The keeper is **6badc049-4960-45ee-92e9-5b21dba0d4f1**: Matthew Mark / Final Piece of the Puzzle.
The user confirmed that this account can sign in and open Admin. Live read-only checks on
2026-09-12 confirmed its email, admin role, and active status.

## Completed on 2026-09-12

The user ran the preflight and transactional cleanup in SQL Editor. Codex removed the 13
inventoried Auth accounts through the Auth Admin API and verified the entire 2025 archive
against its saved copy before and after deletion. Codex backed up and removed the 18 unused
race images. The final API inventory is `inventory-1789216835824.json` in the private folder;
the user also ran `03_verify_reset.sql` and every check reported PASS.

The remaining participant decision is the keeper's intentional skipped-2026 record. The single
admin audit event records this maintenance. Registration and app cron jobs remain paused;
the real 2026 archive import, 2027 setup/enrollment, and later job resumption are still pending.

## Scope and safeguards

The original inventory contained 14 Auth accounts/profiles, one active operational season (2026),
18 races, 40 picks, 41 submission versions, 458 results, 435 race group rows, 14 registrations,
8 feedback items, and 6 restore points. The genuine 2025 archive has 89 entries, 17 races,
2548 champion points, and 186227 combined participant points.

Preserve that entire archive, the keeper's Auth account/profile, all 33 drivers and their images,
driver order/seed fields, application configuration, and the small 2026 season shell. Remove test
points, race data, recovery copies, old operational logs, obsolete 2026 registration code, and
the other 13 accounts. A new `declined` 2026 decision for the keeper keeps Dashboard and Hall of
Fame accessible while registration is closed. It does not enroll the keeper in 2027.

The SQL has explicit account/year/count/archive guards, table locks, transaction-local recovery
maintenance, full archive comparison before commit, and rerun refusal. It pauses only the app's
scheduled jobs and records their previous active states without copying their secret commands.
Unexpected data, an active background job, or changed counts cause rollback and require review.
Do not weaken a guard or disable triggers to get past an error.

## Private recovery material

Local `.local/prelaunch-2027/` reports and exports are mode-restricted and ignored by Git.

- `inventory-1789215741205.json`: original account ID list and full archive snapshot.
- `export-1789215884353/`: application-table JSON export with checksums.
- `race-images-1789216586108/`: 18 original race images (27,743,448 bytes) with checksums.

The application export is **not** an app Recovery upload or a transactionally consistent full
Supabase project backup. It excludes Auth credentials/accounts, invite hashes, configuration
secrets, and external provider logs. Auth deletion is permanent through these tools. Supabase's
own backups and log retention are separate. Keep these local recovery copies private; remove
them deliberately after verifying the transition, rather than leaving test data forever.

## Operator sequence

1. Open Supabase **SQL Editor → New query**. Paste all of `01_database_preflight.sql` and Run.
   Share the resulting rows with Codex. Every gate must pass. This checks the live schema,
   references, retained admin, archive, Storage ownership, and table sizes without showing secrets.
2. After the export and offline tests are complete, open another new query, paste all of
   `02_clear_test_data.sql`, and Run. This step is destructive within the approved test scope.
   Keep the new admin session available; close other app editing sessions. Share the result.
   Stop on an error. A successful result means test application data was cleared; Auth users and
   stored image files still exist at this point. Do not run this file again.
3. Codex runs the guarded Auth removal using the original saved inventory:
   `node scripts/prelaunch-2027.mjs delete-users .local/prelaunch-2027/inventory-1789215741205.json`.
   It verifies the keeper, project, cleanup marker, empty test tables, and unchanged archives.
   It uses Supabase's Auth Admin API and deletes only saved IDs, avoiding pagination skips.
   After a partial failure, it can resume the remaining saved targets; new accounts cause a stop.
4. Codex removes only inventoried, unreferenced race images after verifying both their local
   backup and current content checksums:
   `node scripts/prelaunch-2027.mjs delete-race-images .local/prelaunch-2027/race-images-1789216586108/manifest.json`.
   Driver images are outside this operation. New recovery snapshots or reused/changed images
   cause a stop. Local backup files remain available for reuse in the 2027 schedule.
5. Run `03_verify_reset.sql` in a new SQL Editor query and share the result. Every row should
   report PASS after Auth removal. Check the app using the retained account: Admin opens and the
   2025 Hall of Fame still lists all 89 participants. Refresh/restart the local server after
   direct database maintenance so cached test standings are cleared. A deployed app's short-lived
   scoring cache can persist until expiry or normal app cache invalidation.

## Next: historical import and normal 2027 setup

Send the real 2026 Google Sheet final leaderboard and its race count. Import it as an independent
Hall of Fame archive using the same validated, transactional approach as 2025. Do not use
Finalize/Refresh Final Standings to replace that imported year with experimental app scoring.
The current Hall of Fame automatically includes the new year and comparison table.

Prepare 2027 through Admin: its real roster/opening order, schedule, rules document, and a fresh
invite code. Review driver standings and opening seeds before activation; the reset deliberately
preserved their ordering rather than guessing the real 2026 championship order. Activation uses
the current order as the next season's opening seed and requires the outgoing year's archive.
Activate 2027 and join it with the retained admin/participant account before inviting others.

Only then run `04_resume_jobs_when_2027_ready.sql`. It restores the previous active states;
previously disabled reminders remain disabled. If job definitions changed, review them first.
There is no need to rotate secrets or recreate cron jobs solely for this reset.

Keep normal finalization/recovery/enrollment code, migrations, and tests. Saved obsolete SQL
Editor documents can be removed without changing the actual database, but deleting migrations
from the repository would discard useful database history. This transition does not justify
speculative code removal or a schema rebuild. Row deletion also does not promise an immediate
reduction in allocated PostgreSQL table sizes; avoid aggressive compaction for this small database.

## Local verification

Use Node 22. `node scripts/test-prelaunch-2027.mjs` runs the actual table constraints and deletion
triggers against fictional fixtures in a disposable, network-disabled cached PostgreSQL 16
container. It never reads app credentials. `tests/unit/prelaunch-2027-plan.test.ts` covers the
Auth deletion allowlist and refusal cases. No destructive testing is performed against Supabase.
