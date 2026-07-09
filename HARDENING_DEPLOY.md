# Hardening Rollout Checklist

Apply the database migration before deploying the matching application code. The application now
expects explicit draft/published result state and transactional result-publication functions.

## 1. Use Node 22

The pinned Supabase client requires Node 22 or newer.

```bash
nvm install 22
nvm use
npm ci
```

In Vercel, set the project Node.js version to 22.x before the next deployment.

## 2. Back Up Supabase

Create or confirm a current Supabase database backup before applying the migration. Do not run the
mutating Playwright suite as a migration check.

## 3. Apply The Migration

Open the Supabase SQL Editor for the app database and run the complete contents of:

```text
supabase/migrations/20260709_harden_roles_and_result_publication.sql
```

The migration:

- blocks participants from changing their own profile role;
- marks existing races with result rows as published so current standings remain visible;
- adds draft/published result state;
- hides draft rows from participants;
- adds atomic bulk publication and manual-draft publication functions;
- records snapshotted standard-race nonstarters as zero-point rows during future bulk imports;
- prevents authenticated clients from writing result rows outside those functions;
- computes championship standings from published races only;
- enforces the previous-race publication gate inside PostgreSQL.

Confirm the migration:

```sql
select results_status, count(*)
from public.races
group by results_status
order by results_status;

select routine_name
from information_schema.routines
where routine_schema = 'public'
  and routine_name in (
    'publish_race_results',
    'publish_saved_race_results',
    'save_race_result_draft',
    'refresh_driver_standings_from_published_results'
  )
order by routine_name;

select
  r.id,
  r.race_name,
  r.results_status,
  r.official_winning_average_speed,
  count(distinct result_row.driver_id) as result_rows,
  count(distinct race_group.driver_id) as snapshotted_drivers
from public.races r
left join public.results result_row on result_row.race_id = r.id
left join public.race_driver_groups race_group on race_group.race_id = r.id
group by r.id
order by r.race_date desc;
```

Existing races with any saved result rows are intentionally backfilled as `published`. Review any
known incomplete historical race before deploying. Historical result rows are not modified, so
known nonstarter and no-snapshot exceptions retain their existing scoring. A legacy race with result
rows but no snapshot remains published with its existing fallback; the app will not fabricate
historical groups from current standings.

Reviewed production exceptions:

- Race 8 has 25 official rows and a 27-driver snapshot. Helio Castroneves and Katherine Legge were
  unpicked nonstarters; keep the historical rows unchanged.
- Race 2 has 25 official rows and no snapshot. Only 10 driver groups can be inferred from saved
  picks, so keep the existing fallback and do not reconstruct the missing snapshot.

## 4. Optional Future: Configure Isolated E2E

This is not required for the current production rollout. Until a dedicated test project is
configured, do not run the mutating Playwright suite; use lint, typecheck, build, and the read-only
smoke suite instead.

Create a separate Supabase project used only for automated tests. Apply `supabase/schema.sql` to
that project, then add these GitHub Actions secrets:

```text
E2E_SUPABASE_URL
E2E_SUPABASE_ANON_KEY
E2E_SUPABASE_SERVICE_ROLE_KEY
```

Run the `Isolated Supabase E2E` workflow manually after the secrets are configured. Never point
those secrets at the live/shared Supabase project. The production smoke workflow is read-only and
does not need database credentials.

For local E2E, export the three `E2E_SUPABASE_*` variables in the shell before running the suite.
The mutating test helper deliberately ignores normal database credentials from `.env.local`.

## 5. Deploy And Verify

After the migration succeeds:

```bash
npm run verify
npm run audit:prod
```

Deploy the application, then verify:

1. A participant cannot open `/admin`.
2. Existing season standings are unchanged.
3. Saving one manual result labels the race as draft and does not change participant standings.
4. An incomplete draft cannot be published.
5. A complete bulk import publishes, updates driver groups, and opens the next race form.
6. The production read-only smoke workflow passes.
