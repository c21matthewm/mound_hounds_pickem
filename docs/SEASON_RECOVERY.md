# Season Backup and Recovery

Use **Admin > Recovery** for all normal backup and restore work. Do not edit backup JSON files or
try to rebuild live season rows manually during an incident.

## Create and store a backup

1. Open **Admin > Recovery**.
2. Select **Create & Download Backup**.
3. Confirm a JSON file downloads.
4. Move the file to a private cloud folder outside Supabase and Vercel.
5. Keep at least the three most recent downloaded files.

Create a fresh backup before a results correction, season rollover, or unusual database work. The
database also creates internal restore points automatically after results are published and before
high-risk admin operations. Internal race checkpoints are bounded to one per race, and only the
five newest correction/legacy automatic points per season are retained. Manual downloads,
imported files, pre-restore safety points, and season-rollover milestones are not removed by
automatic retention.

## Restore after a problem

1. Stop entering race results or editing the affected season.
2. Open **Admin > Recovery**.
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
submission replaces that row. Older submissions are retained only in `pick_submission_versions`
for audit and recovery.

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
```

Then open **Admin > Race Week** while signed in as an administrator. The expected schema
version is `20260822_reminder_delivery_v1`. Run
`supabase/operations/01_verify_production_health.sql` and confirm that every `schema`, `function`,
and `storage` row reports `PASS` before relying on restore for a live incident.
