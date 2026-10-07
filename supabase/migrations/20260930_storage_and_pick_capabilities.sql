-- Apply after both 20260930 feature migrations. Keep the base health contract
-- version unchanged; these capabilities describe separately installed features.
begin;
create or replace function public.get_admin_capability_status()
returns jsonb language plpgsql stable security definer set search_path = public
as $$
declare items jsonb;
begin
  if auth.role() is distinct from 'authenticated' or not public.is_admin(auth.uid()) then
    raise exception 'Admin access required.' using errcode = '42501';
  end if;
  select jsonb_agg(jsonb_build_object('name', name, 'installed', installed) order by name)
  into items from (
    select name, to_regprocedure(signature) is not null and
      coalesce(has_function_privilege('authenticated', to_regprocedure(signature), 'EXECUTE'), false) as installed
    from (values
      ('Admin roles','public.admin_update_participant_role(uuid,text,text)'),
      ('Historical imports','public.import_historical_hall_of_fame_season(integer,integer,jsonb)'),
      ('Field freezing','public.admin_freeze_race_field(bigint)'),
      ('Bulk drivers','public.admin_set_driver_roster_status(jsonb,boolean)'),
      ('Bulk participants','public.admin_bulk_update_participants(text,bigint,jsonb)'),
      ('Rules documents','public.set_league_season_rules_document(bigint,text,text)'),
      ('Season closeout review','public.get_season_closeout_context(bigint)'),
      ('Season completion','public.complete_league_season(bigint,bigint,timestamptz,text,jsonb)'),
      ('Participant profile editing','public.admin_update_participant_v2(uuid,text,text,boolean,boolean,boolean,bigint)')
    ) as previous(name, signature)
    union all
    select 'Routine backup retention',
      exists(select 1 from public.app_metadata where key = 'recovery_retention_version' and value = '20260930')
      and not exists (
        select 1 from (values
          ('public.get_season_restore_point_retention(bigint)'),
          ('public.cleanup_season_restore_points(bigint,text)'),
          ('public.set_season_restore_point_protection(uuid,boolean)')
        ) as required(signature)
        where to_regprocedure(signature) is null or
          not coalesce(has_function_privilege('authenticated', to_regprocedure(signature), 'EXECUTE'), false)
      )
    union all
    select 'Unchanged pick saves',
      exists(select 1 from public.app_metadata where key = 'pick_save_idempotency_version' and value = '20260930')
      and to_regprocedure('public.save_weekly_pick(bigint,numeric,bigint[])') is not null
      and coalesce(has_function_privilege('authenticated', to_regprocedure('public.save_weekly_pick(bigint,numeric,bigint[])'), 'EXECUTE'), false)
  ) as capabilities;
  return jsonb_build_object('items', items);
end;
$$;
revoke all on function public.get_admin_capability_status() from public, anon, service_role;
grant execute on function public.get_admin_capability_status() to authenticated;
commit;
