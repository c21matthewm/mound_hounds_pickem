# Season Backup and Recovery

Use **Admin > Recovery** for all normal backup and restore work. Do not edit backup JSON files or
try to rebuild live season rows manually during an incident.

## Create and store a backup

1. Open **Admin > Recovery** and choose the active year under **Backup season**.
2. Leave **Keep this backup permanently** unchecked for a routine copy. Check it for a point
   that should remain available regardless of later downloads.
3. Select **Create & Download Backup** and confirm a JSON file downloads.
4. Move the file to a private cloud folder outside Supabase and Vercel.
5. Keep at least the three most recent downloaded files.

Create a fresh backup before a results correction, season rollover, or unusual database work. The
database also creates internal restore points automatically after results are published and before
high-risk admin operations. Internal race checkpoints are bounded to one per race, and only the
five newest correction/legacy automatic points per season are retained. Routine manual downloads
keep only the newest three points per season. A manual point marked **Keep permanently** is
excluded from routine retention; imported files, pre-restore safety points, and season milestones
are also excluded. These controls do not change the existing automatic/correction policies.

Season completion also saves a milestone before closing the season. Use **Backup season** to
select that completed year and download or compare its saved points, even when no season is
active or a later season has started. Fresh backups and restores remain limited to the active
season in the UI. A completed-season backup cannot restore into a different season, and the
recovery controls do not reopen completed seasons.

## Review and remove older routine copies

1. Open **Admin > Recovery** and select the year under **Backup season**. Completed seasons
   remain available for retention management.
2. If a manual point needs to remain available, select it and choose **Keep permanently** before
   reviewing cleanup. **Return to routine retention** releases that protection without deleting it.
3. Under **Routine backup retention**, select **Review older backups**.
4. Review the number of older routine points and their snapshot-data size.
5. Select **Remove reviewed backups** and accept the confirmation.

Cleanup keeps the newest three routine points and all points excluded from routine cleanup. If
manual backup data or protection changes after review, cleanup refuses the stale review; review again.
Installing the migration itself deletes nothing. Fresh backup/checkpoint creation applies routine retention too, and the
reviewed cleanup also handles existing older routine points. Protect any manual point that needs
to be kept before creating another backup or running cleanup.

The displayed sizes describe stored snapshot payloads, not immediate billed disk savings.
Cleanup removes database restore points only; it does not change league records, Hall of Fame
archives, image files, or downloaded files held outside the app.

## Restore after a problem

1. Stop entering race results or editing the affected season.
2. Open **Admin > Recovery** and select the affected active season under **Backup season**.
3. If the desired point is already listed, select it. Otherwise import the downloaded JSON file.
4. Select **Preview Restore**.
5. Review the backup, current, and changed row counts. Confirm the season and restore-point time.
6. Type the displayed season year exactly.
7. Select **Restore This Season** and accept the final confirmation.
8. Open **Admin > Race Week**, then verify Dashboard, Picks, and Leaderboard.
9. Confirm the latest race results, participant count, and several saved participant picks.

The restore runs in one database transaction. If any validation or insert fails, the transaction
rolls back instead of leaving a partial restore. Immediately before replacement, the database
creates a separate pre-restore safety point.

If the app reports that the season was restored but cached pages could not be refreshed, the
database restore already succeeded. Keep the displayed safety-point identifier, do not repeat
the restore, and resolve the cache-refresh problem before relying on displayed standings.

## Portable file compatibility

New downloads use backup envelope version 2. The `snapshotText` string contains the exact
PostgreSQL snapshot representation; the checksum covers those UTF-8 bytes. Keep this string
intact. The importer validates it before converting to the existing internal snapshot format.
Internal restore points remain version 1, retain their original checksums, and can be downloaded
again in the new portable format.

Older version-1 files are accepted only if their original checksum still matches. Earlier
downloads could lose decimal formatting, such as `190.000` becoming `190`, and fail that check
without anyone editing the file. If this occurs, download a new copy from the original stored
restore point after applying the migration. If the original point is unavailable, preserve the
file for investigation; the app does not bypass checksum verification or silently repair it.

## What is included

- The selected league season's participant registrations
- Driver state used by that season
- Races and race-specific field/group snapshots
- Current scoring picks
- Append-only pick submission versions
- Official result rows
- That year's Hall of Fame snapshot, when present
- Profile identifiers and display labels needed to validate participant accounts

The current row in `picks` is authoritative for scoring. A participant's newest successful
submission with changed picks or speed replaces that row. An identical submission, including
formatting-only speed differences such as `135.5` and `135.500`, preserves the saved timestamp
and creates no additional version. Actual changes remain in `pick_submission_versions` for
audit and recovery.

## What is not included

- Supabase Auth users, email addresses, or passwords
- Supabase project configuration or custom SMTP settings
- Vercel environment variables
- Resend, cron, or other API secrets
- Binary driver and race image files

Stored image URLs are included. Maintain service configuration and storage separately.

## Deployment requirement

Apply these migrations in Supabase SQL Editor, in order, before deploying the matching app:

```text
supabase/migrations/20260730_atomic_picks_and_season_recovery.sql
supabase/migrations/20260818_bound_recovery_jobs_and_registration.sql
supabase/migrations/20260821_add_application_error_inbox.sql
supabase/migrations/20260822_harden_pick_reminder_delivery.sql
supabase/migrations/20260822_retire_five_day_pick_email.sql
supabase/migrations/20260831_harden_season_rollover_registration.sql
supabase/migrations/20260831_repair_timestamp_variable_collisions.sql
supabase/migrations/20260831_retire_sms_participant_data.sql
supabase/migrations/20260904_fix_portable_season_backups.sql
```

For the September 30 storage and pick improvements, apply only these three new migrations after
the existing Admin capability migrations documented in `docs/OPERATIONS_GUIDE.md`:

```text
supabase/migrations/20260930_idempotent_pick_saves.sql
supabase/migrations/20260930_recovery_retention.sql
supabase/migrations/20260930_storage_and_pick_capabilities.sql
```

Then open **Admin > System Health** while signed in as an administrator and confirm **Routine
backup retention** and **Unchanged pick saves** show **Installed**. The expected base schema
version remains `20260904_portable_season_backups_v2`. The current installation passed these
capability checks on 2026-10-07; deployed types were regenerated, the diff reviewed, and
`db:types:check` passed. The existing completed-2026 milestone downloaded with a valid checksum
and loaded its read-only comparison. See [the verification report](RELEASE_REVIEW_20261007.md).
For another installation, regenerate types and run `npm run verify:release` after migration. Run
`supabase/operations/01_verify_production_health.sql` and confirm that every `schema`, `function`,
and `storage` row reports `PASS` before relying on restore for a live incident.

## Isolated recovery regression test

Run `npm run test:recovery:db` with local Docker running and a cached `postgres:17` image.
`SEASON_BACKUP_TEST_IMAGE` can select another already-cached compatible PostgreSQL image.
The runner creates its own disposable container with networking disabled, refuses remote Docker
hosts, never pulls an image, and never reads `.env.local` or connects to an existing database.

It loads the repository's recovery functions and representative fixture tables, exports a backup,
passes it through JavaScript download/upload serialization, imports it, and restores changed data.
Checks cover decimal formatting, Unicode, checksum tampering, legacy compatibility, admin access,
and the pre-restore safety snapshot. Supabase authentication is represented by local fixture
functions; unrelated application triggers and RLS policies are outside this focused test.

`npm run test:recovery:db -- --check-fixtures` checks that the required SQL definitions can be
loaded from the repository without starting Docker. It does not execute or validate PostgreSQL.

`npm run test:recovery:retention` checks the three-copy routine limit, protected points,
reviewed cleanup, stale-review rejection and preservation of existing recovery policies. It uses
a fresh network-disabled local container with an already-cached `postgres:16-alpine` image,
never pulls an image and does not load application credentials or connect to live services.

`npm run test:picks:db` checks idempotent saves, real-change version history, validation guards,
concurrent retries, and doubleheader navigation in a network-disabled local container using an
already-cached `postgres:16-alpine` image. `npm run test:picks:ui` verifies the actual pick form
with fictional data in an offline browser, including mobile layouts and draft recovery. Neither
runner loads application credentials or uses live services.
