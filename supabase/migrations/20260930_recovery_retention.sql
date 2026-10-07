-- Bound routine downloads without changing portable payloads or checksums.
-- Installing this migration does not delete existing history. Recovery offers reviewed cleanup.
begin;
create or replace function public.lock_season_restore_point_maintenance(p_season_id bigint)
returns void language plpgsql security definer set search_path = public
as $$
begin
 if coalesce(auth.role(), '') <> 'service_role' and not public.is_admin(auth.uid()) then
  raise exception 'Admin access required.' using errcode = '42501';
 end if;
 if p_season_id is null then raise exception 'Selected season was not found.'; end if;
 -- Separate from season/race row locks; fail promptly instead of waiting for another writer.
 if not pg_try_advisory_xact_lock(hashtextextended('mound_hounds:recovery:' || p_season_id::text, 0)) then
  raise exception 'Recovery history changed or is busy. Refresh and try again.' using errcode = '55P03';
 end if;
end;
$$;
revoke all on function public.lock_season_restore_point_maintenance(bigint) from public, anon, authenticated, service_role;

create or replace function public.prune_season_restore_points_internal(p_season_id bigint, p_keep_point_id uuid default null)
returns integer language plpgsql security definer set search_path = public
set lock_timeout = '3s' set statement_timeout = '15s'
as $$
declare deleted_count integer := 0; step_count integer := 0;
 previous_maintenance text := coalesce(current_setting('mound_hounds.restore_point_maintenance', true), 'off');
begin
 perform public.lock_season_restore_point_maintenance(p_season_id);
 perform set_config('mound_hounds.restore_point_maintenance', 'on', true);
 with ranked as (
  select id, row_number() over(partition by coalesce(retention_key, 'legacy')
   order by (id = p_keep_point_id) desc nulls last, created_at desc, id desc) as retention_rank
  from public.season_restore_points where season_id = p_season_id and source = 'result_checkpoint'
 ) delete from public.season_restore_points point using ranked where point.id = ranked.id and ranked.retention_rank > 1;
 get diagnostics step_count = row_count; deleted_count := deleted_count + step_count;
 with ranked as (
  select id, row_number() over(order by (id = p_keep_point_id) desc nulls last, created_at desc, id desc) as retention_rank
  from public.season_restore_points where season_id = p_season_id and source in ('automatic', 'pre_correction')
 ) delete from public.season_restore_points point using ranked where point.id = ranked.id and ranked.retention_rank > 5;
 get diagnostics step_count = row_count; deleted_count := deleted_count + step_count;
 -- Any non-null manual key is protected, including preexisting keys. Safety, uploaded,
 -- and season milestone sources never enter the routine-manual candidate set.
 with ranked as (
  select id, row_number() over(order by (id = p_keep_point_id) desc nulls last, created_at desc, id desc) as retention_rank
  from public.season_restore_points where season_id = p_season_id and source = 'manual' and retention_key is null
 ) delete from public.season_restore_points point using ranked where point.id = ranked.id and ranked.retention_rank > 3;
 get diagnostics step_count = row_count; deleted_count := deleted_count + step_count;
 perform set_config('mound_hounds.restore_point_maintenance', previous_maintenance, true);
 return deleted_count;
exception when others then
 perform set_config('mound_hounds.restore_point_maintenance', previous_maintenance, true); raise;
end;
$$;
revoke all on function public.prune_season_restore_points_internal(bigint, uuid) from public, anon, authenticated, service_role;

create or replace function public.prune_season_restore_points(p_season_id bigint)
returns integer language plpgsql security definer set search_path = public
as $$ begin return public.prune_season_restore_points_internal(p_season_id, null); end; $$;
revoke all on function public.prune_season_restore_points(bigint) from public, anon, authenticated, service_role;

create or replace function public.create_season_restore_point_v2(
 p_season_id bigint, p_label text, p_source text default 'manual', p_retention_key text default null
)
returns jsonb language plpgsql security definer set search_path = public
set lock_timeout = '3s' set statement_timeout = '30s'
as $$
declare created_point jsonb; created_point_id uuid; storage_source text;
 previous_maintenance text := coalesce(current_setting('mound_hounds.restore_point_maintenance', true), 'off');
begin
 perform public.lock_season_restore_point_maintenance(p_season_id);
 if p_source is null or p_source not in ('result_checkpoint','pre_correction','pre_rollover','manual','pre_restore','uploaded') then
  raise exception 'Invalid restore-point source.';
 end if;
 if p_retention_key is not null and length(trim(p_retention_key)) not between 1 and 120 then
  raise exception 'Invalid restore-point retention key.';
 end if;
 storage_source := case when p_source in ('result_checkpoint','pre_correction','pre_rollover') then 'automatic' else p_source end;
 created_point := public.create_season_restore_point(p_season_id, p_label, storage_source);
 created_point_id := (created_point->>'id')::uuid;
 perform set_config('mound_hounds.restore_point_maintenance','on',true);
 update public.season_restore_points set source = p_source, retention_key = nullif(trim(p_retention_key),''),
  snapshot_bytes = octet_length(snapshot::text) where id = created_point_id;
 perform set_config('mound_hounds.restore_point_maintenance', previous_maintenance, true);
 -- Timestamps can tie inside one transaction. Keep the point being returned for download.
 perform public.prune_season_restore_points_internal(p_season_id, created_point_id);
 return created_point || jsonb_build_object('source',p_source,'retentionKey',nullif(trim(p_retention_key),''));
exception when others then
 perform set_config('mound_hounds.restore_point_maintenance', previous_maintenance, true); raise;
end;
$$;
revoke all on function public.create_season_restore_point_v2(bigint,text,text,text) from public, anon;
grant execute on function public.create_season_restore_point_v2(bigint,text,text,text) to authenticated, service_role;
-- Owner-only legacy creation remains available to definer-internal restore safety transactions.
-- Public callers use v2 so routine retention cannot be bypassed.
revoke all on function public.create_season_restore_point(bigint,text,text) from public, anon, authenticated, service_role;

create or replace function public.get_season_restore_point_retention(p_season_id bigint)
returns jsonb language plpgsql stable security definer set search_path = public
set statement_timeout = '10s'
as $$
declare selected_year integer; summary jsonb;
begin
 if auth.role() is distinct from 'authenticated' or not public.is_admin(auth.uid()) then
  raise exception 'Admin access required.' using errcode = '42501';
 end if;
 select season_year into selected_year from public.league_seasons where id = p_season_id;
 if selected_year is null then raise exception 'Selected season was not found.'; end if;
 with points as (
  select id, source, retention_key, created_at, snapshot_bytes from public.season_restore_points where season_id = p_season_id
 ), routine as (
  select id, created_at, snapshot_bytes, row_number() over(order by created_at desc, id desc) as retention_rank
  from points where source = 'manual' and retention_key is null
 ), candidates as (select * from routine where retention_rank > 3)
 select jsonb_build_object(
  'seasonId',p_season_id,'seasonYear',selected_year,'routineLimit',3,
  'totalCount',(select count(*) from points),'totalBytes',(select coalesce(sum(snapshot_bytes),0) from points),
  'routineCount',(select count(*) from routine),
  -- Excluded from routine-manual cleanup; auto/correction points still follow their separate limits.
  'protectedCount',(select count(*) from points where source <> 'manual' or retention_key is not null),
  'cleanupCount',(select count(*) from candidates),'cleanupBytes',(select coalesce(sum(snapshot_bytes),0) from candidates),
  'reviewToken',encode(extensions.digest(convert_to(jsonb_build_object(
   'seasonId',p_season_id,'manualPoints',coalesce((select jsonb_agg(jsonb_build_array(id,created_at,retention_key,snapshot_bytes)
    order by created_at desc,id desc) from points where source = 'manual'),'[]'::jsonb)
  )::text,'UTF8'),'sha256'),'hex')
 ) into summary;
 return summary;
end;
$$;
revoke all on function public.get_season_restore_point_retention(bigint) from public, anon, service_role;
grant execute on function public.get_season_restore_point_retention(bigint) to authenticated;

create or replace function public.cleanup_season_restore_points(p_season_id bigint,p_review_token text)
returns jsonb language plpgsql security definer set search_path = public
set lock_timeout = '3s' set statement_timeout = '15s'
as $$
declare reviewed jsonb; deleted_count integer := 0; deleted_bytes bigint := 0;
 previous_maintenance text := coalesce(current_setting('mound_hounds.restore_point_maintenance',true),'off');
begin
 if auth.role() is distinct from 'authenticated' or not public.is_admin(auth.uid()) then
  raise exception 'Admin access required.' using errcode = '42501';
 end if;
 perform public.lock_season_restore_point_maintenance(p_season_id);
 reviewed := public.get_season_restore_point_retention(p_season_id);
 if p_review_token is null or p_review_token is distinct from reviewed->>'reviewToken' then
  raise exception 'Recovery history changed since review. Refresh and review cleanup again.' using errcode = '40001';
 end if;
 perform set_config('mound_hounds.restore_point_maintenance','on',true);
 with ranked as (
  select id,row_number() over(order by created_at desc,id desc) as retention_rank
  from public.season_restore_points where season_id = p_season_id and source = 'manual' and retention_key is null
 ), removed as (
  delete from public.season_restore_points point using ranked where point.id = ranked.id and ranked.retention_rank > 3
  returning point.snapshot_bytes
 ) select count(*)::integer,coalesce(sum(snapshot_bytes),0)::bigint into deleted_count,deleted_bytes from removed;
 perform set_config('mound_hounds.restore_point_maintenance',previous_maintenance,true);
 if deleted_count > 0 then
  perform public.write_admin_audit_event('cleanup_season_restore_points','league_season',p_season_id::text,
   format('Removed %s older routine backups; kept the latest three and all protected recovery points.',deleted_count),
   jsonb_build_object('routine_count',reviewed->'routineCount','total_bytes',reviewed->'totalBytes'),
   jsonb_build_object('deleted_count',deleted_count,'deleted_bytes',deleted_bytes));
 end if;
 return jsonb_build_object('deletedCount',deleted_count,'deletedBytes',deleted_bytes,
  'retention',public.get_season_restore_point_retention(p_season_id));
exception when others then
 perform set_config('mound_hounds.restore_point_maintenance',previous_maintenance,true); raise;
end;
$$;
revoke all on function public.cleanup_season_restore_points(bigint,text) from public, anon, service_role;
grant execute on function public.cleanup_season_restore_points(bigint,text) to authenticated;

create or replace function public.set_season_restore_point_protection(p_restore_point_id uuid,p_protected boolean)
returns jsonb language plpgsql security definer set search_path = public
set lock_timeout = '3s' set statement_timeout = '15s'
as $$
declare point public.season_restore_points%rowtype; selected_season_id bigint; next_key text;
 previous_maintenance text := coalesce(current_setting('mound_hounds.restore_point_maintenance',true),'off');
begin
 if auth.role() is distinct from 'authenticated' or not public.is_admin(auth.uid()) then
  raise exception 'Admin access required.' using errcode = '42501';
 end if;
 if p_protected is null then raise exception 'Choose whether to keep this backup permanently.'; end if;
 select season_id into selected_season_id from public.season_restore_points where id = p_restore_point_id;
 if selected_season_id is null then raise exception 'Selected restore point was not found.'; end if;
 perform public.lock_season_restore_point_maintenance(selected_season_id);
 select * into point from public.season_restore_points where id = p_restore_point_id for update;
 if point.id is null then raise exception 'Selected restore point was not found. Refresh Recovery.'; end if;
 if point.source <> 'manual' then raise exception 'Only manual backups can change permanent protection.'; end if;
 next_key := case when p_protected then coalesce(point.retention_key,'manual:protected') else null end;
 if next_key is distinct from point.retention_key then
  perform set_config('mound_hounds.restore_point_maintenance','on',true);
  update public.season_restore_points set retention_key = next_key where id = point.id;
  perform set_config('mound_hounds.restore_point_maintenance',previous_maintenance,true);
  perform public.write_admin_audit_event('set_season_restore_point_protection','season_restore_point',point.id::text,
   case when p_protected then 'Kept a manual backup permanently.' else 'Returned a manual backup to routine retention.' end,
   jsonb_build_object('protected',point.retention_key is not null),jsonb_build_object('protected',p_protected));
 end if;
 -- Unprotecting alters metadata only; later reviewed cleanup/new creation may prune older routine copies.
 return jsonb_build_object('id',point.id,'protected',p_protected,'retentionKey',next_key,
  'retention',public.get_season_restore_point_retention(point.season_id));
exception when others then
 perform set_config('mound_hounds.restore_point_maintenance',previous_maintenance,true); raise;
end;
$$;
revoke all on function public.set_season_restore_point_protection(uuid,boolean) from public, anon, service_role;
grant execute on function public.set_season_restore_point_protection(uuid,boolean) to authenticated;
insert into public.app_metadata(key,value) values('recovery_retention_version','20260930')
on conflict(key) do update set value = excluded.value;
commit;
