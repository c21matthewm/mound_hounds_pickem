-- READ ONLY. Run as postgres in Supabase SQL Editor. Return this result to Codex.
-- Does not print cron commands, credentials, email addresses, or stored file names.
begin transaction read only;

with inventory as (
  select 'retained_admin'::text as check_name,
    case when count(*) = 1 then 'PASS' else 'STOP' end as status,
    'Expected confirmed, active administrator 6badc049-4960-45ee-92e9-5b21dba0d4f1'::text as details
  from public.profiles p join auth.users u on u.id = p.id
  where p.id = '6badc049-4960-45ee-92e9-5b21dba0d4f1'
    and p.role = 'admin' and p.is_active and u.email_confirmed_at is not null
  union all
  select 'application_schema', case when value = '20260904_portable_season_backups_v2' then 'PASS' else 'STOP' end, value
  from public.app_metadata where key = 'schema_version'
  union all
  select 'auth_accounts', 'INFO', count(*)::text from auth.users
  union all
  select '2025_archive', case when count(*) = 89 then 'PASS' else 'STOP' end, count(*) || ' entries'
  from public.hall_of_fame_entries e join public.hall_of_fame_seasons s on s.id = e.season_id where s.season_year = 2025
  union all
  select '2026_archive_not_imported', case when count(*) = 0 then 'PASS' else 'STOP' end,
    count(*) || ' archives; cleanup must precede the real 2026 import'
  from public.hall_of_fame_seasons where season_year = 2026
  union all
  select 'storage_owned_by_accounts_to_delete', case when count(*) = 0 then 'PASS' else 'STOP' end,
    count(*) || ' objects; if nonzero, review ownership before deleting accounts'
  from storage.objects o join auth.users u on u.id::text = coalesce(o.owner_id, o.owner::text)
  where u.id <> '6badc049-4960-45ee-92e9-5b21dba0d4f1'
  union all
  select 'storage_bucket:' || bucket_id, 'INFO',
    count(*) || ' files; ' || pg_size_pretty(coalesce(sum((metadata->>'size')::bigint), 0)::bigint)
  from storage.objects group by bucket_id
  union all
  select 'database_table:' || relname, 'INFO', pg_size_pretty(pg_total_relation_size(relid))
  from pg_catalog.pg_statio_user_tables where schemaname = 'public'
  union all
  select 'profile_reference:' || c.conrelid::regclass::text || '.' || c.conname, 'INFO', pg_get_constraintdef(c.oid)
  from pg_constraint c where c.contype = 'f' and c.confrelid = 'public.profiles'::regclass
)
select * from inventory order by check_name;

commit;
