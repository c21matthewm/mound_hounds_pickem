-- Preserve PostgreSQL's snapshot representation across portable JSON downloads.
-- Internal restore points keep format version 1 and their existing checksum contract.

begin;

create or replace function public.export_season_restore_point(p_restore_point_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  backup_point public.season_restore_points%rowtype;
  snapshot_text text;
begin
  if not coalesce(public.is_admin(auth.uid()), false) then
    raise exception 'Admin access required.';
  end if;

  select * into backup_point
  from public.season_restore_points
  where id = p_restore_point_id;
  if backup_point.id is null then
    raise exception 'Selected restore point was not found.' using errcode = 'P0002';
  end if;

  snapshot_text := backup_point.snapshot::text;
  if encode(extensions.digest(convert_to(snapshot_text, 'UTF8'), 'sha256'), 'hex')
    is distinct from backup_point.checksum then
    raise exception 'Stored backup checksum validation failed. Download was cancelled.';
  end if;

  return jsonb_build_object(
    'format', 'mound-hounds-season-backup',
    'formatVersion', 2,
    'backupId', backup_point.id,
    'checksum', backup_point.checksum,
    'createdAt', backup_point.created_at,
    'label', backup_point.label,
    'rowCounts', backup_point.row_counts,
    'schemaVersion', backup_point.schema_version,
    'seasonYear', backup_point.season_year,
    'snapshotText', snapshot_text,
    'source', backup_point.source
  );
end;
$$;

revoke all on function public.export_season_restore_point(uuid) from public, anon;
grant execute on function public.export_season_restore_point(uuid) to authenticated;

create or replace function public.import_season_restore_point_v2(p_document jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  checksum_value text;
  computed_checksum text;
  legacy_document jsonb;
  snapshot_text text;
  snapshot_value jsonb;
  legacy_format boolean;
begin
  if not coalesce(public.is_admin(auth.uid()), false) then
    raise exception 'Admin access required.';
  end if;

  if jsonb_typeof(p_document) is distinct from 'object'
    or p_document->>'format' is distinct from 'mound-hounds-season-backup'
    or coalesce(p_document->'formatVersion' not in ('1'::jsonb, '2'::jsonb), true) then
    raise exception 'This is not a supported Mound Hounds season backup.';
  end if;

  legacy_format := p_document->'formatVersion' = '1'::jsonb;
  if legacy_format then
    if jsonb_typeof(p_document->'snapshot') is distinct from 'object' then
      raise exception 'Backup snapshot is missing or invalid.';
    end if;
    snapshot_text := (p_document->'snapshot')::text;
  else
    if jsonb_typeof(p_document->'snapshotText') is distinct from 'string' then
      raise exception 'Backup snapshot text is missing or invalid.';
    end if;
    snapshot_text := p_document->>'snapshotText';
  end if;

  checksum_value := lower(trim(coalesce(p_document->>'checksum', '')));
  if checksum_value !~ '^[0-9a-f]{64}$' then
    raise exception 'Backup checksum is missing or invalid.';
  end if;
  computed_checksum := encode(
    extensions.digest(convert_to(snapshot_text, 'UTF8'), 'sha256'),
    'hex'
  );
  if computed_checksum <> checksum_value then
    if legacy_format then
      raise exception 'Legacy backup checksum validation failed. Download a new copy from the original stored restore point; this file cannot be imported safely.';
    end if;
    raise exception 'Backup checksum validation failed. The file may be incomplete or edited.';
  end if;

  -- Validate the exact transported bytes before converting to the internal JSONB format.
  begin
    snapshot_value := snapshot_text::jsonb;
  exception when invalid_text_representation then
    raise exception 'Backup snapshot text is not valid JSON.';
  end;
  if jsonb_typeof(snapshot_value) is distinct from 'object' then
    raise exception 'Backup snapshot must be a JSON object.';
  end if;

  -- Reuse the existing import/audit/storage transaction. Its checksum must match
  -- canonical JSONB text, even if a valid external envelope used other whitespace.
  legacy_document := (p_document - 'snapshotText') || jsonb_build_object(
    'formatVersion', 1,
    'snapshot', snapshot_value,
    'checksum', encode(
      extensions.digest(convert_to(snapshot_value::text, 'UTF8'), 'sha256'),
      'hex'
    )
  );
  return public.import_season_restore_point(legacy_document);
end;
$$;

revoke all on function public.import_season_restore_point_v2(jsonb) from public, anon;
grant execute on function public.import_season_restore_point_v2(jsonb) to authenticated;

create or replace function public.get_app_health_contract()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  base_contract jsonb;
  missing_items jsonb;
begin
  if not coalesce(public.is_admin(auth.uid()), false) then
    raise exception 'Admin access required.';
  end if;

  base_contract := extensions.get_app_health_contract_20260822();
  missing_items := coalesce(base_contract->'missing', '[]'::jsonb);

  if to_regprocedure('public.pick_window_opens_at(bigint)') is null then
    missing_items := missing_items || jsonb_build_array('pick_window_opens_at');
  end if;
  if exists (
    select 1 from information_schema.columns column_info
    where column_info.table_schema = 'public'
      and column_info.table_name = 'profiles'
      and column_info.column_name in ('phone_number', 'phone_carrier')
  ) then
    missing_items := missing_items || jsonb_build_array('email_only_profiles');
  end if;
  if to_regprocedure('public.export_season_restore_point(uuid)') is null then
    missing_items := missing_items || jsonb_build_array('export_season_restore_point');
  end if;
  if to_regprocedure('public.import_season_restore_point_v2(jsonb)') is null then
    missing_items := missing_items || jsonb_build_array('import_season_restore_point_v2');
  end if;

  return jsonb_build_object(
    'healthy', coalesce((base_contract->>'healthy')::boolean, false)
      and jsonb_array_length(missing_items) = 0,
    'missing', missing_items,
    'version', '20260904_portable_season_backups_v2'
  );
end;
$$;

revoke all on function public.get_app_health_contract() from public, anon;
grant execute on function public.get_app_health_contract() to authenticated;

insert into public.app_metadata (key, value)
values ('schema_version', '20260904_portable_season_backups_v2')
on conflict (key) do update
set value = excluded.value, updated_at = timezone('utc', now());

commit;
