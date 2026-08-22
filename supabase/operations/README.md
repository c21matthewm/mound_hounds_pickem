# Supabase Operator Queries

These are the only SQL Editor queries intended for routine production administration. They are
separate from `supabase/migrations`, which remains the canonical, ordered database change history.

## Queries

1. `01_verify_production_health.sql`
   - Read-only and safe to run at any time.
   - Checks the schema version, two-stage reminder policy, required functions,
     application-error inbox, race-result completeness, and cron schedules.
2. `02_configure_cron_jobs.sql`
   - Configuration write; run only when installing or changing cron jobs or rotating `CRON_SECRET`.
   - Replaces duplicate/legacy jobs, runs fantasy-winner recovery hourly, and optionally enables
     five-minute pick reminders.
3. `03_diagnose_race_results.sql`
   - Read-only and safe to run while investigating one race.
   - Change the single race ID at the top before running it.

## Existing Production Project

Do not rerun old migration bundles merely because they are saved in Supabase SQL Editor. A saved
query is only an editor document; deleting it does not remove functions, tables, policies, or data
that were already created in the database.

After `01_verify_production_health.sql` reports schema
`20260822_reminder_delivery_v1`, the old saved migration bundles and one-off Race 2/Race 8
diagnostic queries can be deleted from the Supabase SQL Editor. Their canonical copies remain in
`supabase/migrations` and Git history.

### Old Query Map

| Old saved query content | Canonical source | SQL Editor action |
| --- | --- | --- |
| Indy 500 pick format | `migrations/20260528_add_indy_500_pick_format.sql` | Delete saved copy |
| Role/result publication hardening | `migrations/20260709_harden_roles_and_result_publication.sql` | Delete saved copy |
| Hall of Fame and reminder windows | Both `20260717` migration files | Delete combined saved copy |
| Seasons and enrollment | Both `20260718` migration files | Delete combined saved copy |
| Operations and shared doubleheaders | `20260725` and `20260726` migrations | Delete combined saved copy |
| Weekly scale and atomic recovery | `20260729` and `20260730` migrations | Delete combined saved copy |
| Bounded recovery and application errors | `20260818` and `20260821` migrations | Delete saved copies after verification |
| Reminder delivery and schedule corrections | `migrations/20260822_harden_pick_reminder_delivery.sql` | Delete saved copy after verification |
| Two-stage reminder policy | `migrations/20260822_retire_five_day_pick_email.sql` | Delete saved copy after verification |
| Race IDs 48/128 diagnostics | `operations/03_diagnose_race_results.sql` | Delete old one-off copies |
| Admin/cron setup query | Deployment docs plus `operations/02_configure_cron_jobs.sql` | Delete after cron replacement |
| Old 493-line consolidated schema | Obsolete predecessor of `supabase/schema.sql` | Delete and do not rerun |

`supabase/schema.sql` is a new-install baseline, not an upgrade script for the live database. New
projects apply that baseline and then the later migrations in filename order. Existing production
projects apply only migrations they have not already applied.

## Cron Secret

Never commit or permanently save a real `CRON_SECRET` in this repository. Paste
`02_configure_cron_jobs.sql` into an unsaved Supabase query, replace its placeholder with the
current Vercel secret, run it, verify the result, and close the query without saving it.
