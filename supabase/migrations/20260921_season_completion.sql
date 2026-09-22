-- Explicit off-season lifecycle and Admin diagnostics. Installs capabilities only;
-- the administrator chooses when to complete or activate a season in the app.
begin;

create or replace function public.get_season_closeout_context(p_season_id bigint)
returns jsonb language plpgsql stable security definer set search_path = public
set statement_timeout = '10s'
as $$
declare snapshot jsonb;
begin
  if auth.role() is distinct from 'authenticated' or not public.is_admin(auth.uid()) then
    raise exception 'Admin access required.' using errcode = '42501';
  end if;
  snapshot := public.build_season_recovery_snapshot(p_season_id);
  return jsonb_build_object(
    'source_hash', encode(extensions.digest((snapshot - 'hallOfFame')::text, 'sha256'), 'hex'),
    'already_completed', snapshot->'season'->>'status' = 'completed',
    'historical_archive', jsonb_typeof(snapshot->'hallOfFame') = 'object' and not exists (
      select 1 from jsonb_array_elements(coalesce(snapshot->'hallOfFame'->'entries', '[]'::jsonb)) entry
      where entry->'race_breakdown' is distinct from '[]'::jsonb
    )
  );
end;
$$;
revoke all on function public.get_season_closeout_context(bigint) from public, anon, service_role;
grant execute on function public.get_season_closeout_context(bigint) to authenticated;

create or replace function public.complete_league_season(
  p_season_id bigint, p_expected_archive_id bigint, p_expected_finalized_at timestamptz,
  p_expected_source_hash text, p_current_entries jsonb
)
returns jsonb language plpgsql security definer set search_path = public
set lock_timeout = '3s' set statement_timeout = '15s'
as $$
declare
  season public.league_seasons%rowtype;
  archive public.hall_of_fame_seasons%rowtype;
  context jsonb;
  saved_entries jsonb;
  current_entries jsonb;
  backup jsonb;
  finished_at timestamptz := now();
begin
  if auth.role() is distinct from 'authenticated' or not public.is_admin(auth.uid()) then
    raise exception 'Only an administrator can complete a season.' using errcode = '42501';
  end if;
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'Refresh Seasons & League before completing a season.' using errcode = '40001';
  end if;
  -- All source writers, including new rows, must settle before verification.
  -- NOWAIT keeps busy race/roster operations from waiting behind a closeout.
  lock table public.league_seasons, public.profiles, public.drivers, public.races,
    public.season_participants, public.picks, public.pick_submission_versions,
    public.results, public.race_driver_groups, public.hall_of_fame_seasons,
    public.hall_of_fame_entries in share row exclusive mode nowait;
  if not public.is_admin(auth.uid()) then raise exception 'Administrator access changed.' using errcode = '42501'; end if;
  select * into season from public.league_seasons where id = p_season_id;
  if not found then raise exception 'Selected season was not found.'; end if;
  select * into archive from public.hall_of_fame_seasons where season_year = season.season_year;
  if not found or archive.id is distinct from p_expected_archive_id
    or archive.finalized_at is distinct from p_expected_finalized_at then
    raise exception 'The final archive changed or is missing. Refresh Seasons & League.' using errcode = '40001';
  end if;
  if season.status = 'completed' then
    return jsonb_build_object('season_year',season.season_year,'already_completed',true);
  end if;
  if season.status <> 'active' then raise exception 'Only the active season can be completed.'; end if;
  if archive.participant_count < 1 or archive.race_count < 1
    or (select count(*) from public.hall_of_fame_entries where season_id = archive.id) <> archive.participant_count
    or (select count(*) from public.hall_of_fame_entries where season_id = archive.id and final_rank = 1) <> 1
    or not exists (select 1 from public.hall_of_fame_entries where season_id = archive.id
      and final_rank = 1 and team_name = archive.champion_team_name and total_points = archive.champion_total_points) then
    raise exception 'The final archive is incomplete. Review Hall of Fame before completing this season.';
  end if;
  context := public.get_season_closeout_context(season.id);
  if context->>'source_hash' is distinct from p_expected_source_hash then
    raise exception 'Season data changed during review. Refresh and try completing the season again.' using errcode = '40001';
  end if;
  if (context->>'historical_archive')::boolean then
    -- The 2026 transition has an imported archive and no operational race data.
    -- Never silently disregard a real app schedule merely because an import exists.
    if exists (select 1 from public.races where season_id = season.id) then
      raise exception 'This historical archive has app race records. Review those records before completing the season.';
    end if;
  else
    if not exists (select 1 from public.races where season_id = season.id and not is_archived)
      or exists (select 1 from public.races where season_id = season.id and not is_archived
        and (results_status <> 'published' or race_date > now())) then
      raise exception 'Publish every scheduled race before completing the season.';
    end if;
    if (select count(*) from public.races where season_id = season.id and not is_archived) <> archive.race_count then
      raise exception 'The archived race count differs from the schedule. Refresh Final Standings before completing the season.';
    end if;
    if p_current_entries is null or jsonb_typeof(p_current_entries) <> 'array'
      or octet_length(p_current_entries::text) > 5 * 1024 * 1024 then
      raise exception 'Current final standings could not be verified. Refresh and try again.';
    end if;
    select jsonb_agg(jsonb_build_object('final_rank', final_rank, 'team_name', team_name,
      'total_points', total_points, 'race_breakdown', race_breakdown) order by final_rank, team_name)
      into saved_entries from public.hall_of_fame_entries where season_id = archive.id;
    select jsonb_agg(entry order by (entry->>'final_rank')::integer, entry->>'team_name')
      into current_entries from jsonb_array_elements(p_current_entries) entry;
    if saved_entries is distinct from current_entries then
      raise exception 'Current standings differ from the saved archive. Refresh Final Standings before completing the season.';
    end if;
  end if;
  backup := public.create_season_restore_point_v2(season.id,
    format('Before completing %s season', season.season_year), 'pre_rollover', format('season:%s:completion',season.id));
  update public.races set winner_auto_eligible_at = null where season_id = season.id and winner_auto_eligible_at is not null;
  update public.league_seasons set status = 'completed', completed_at = finished_at where id = season.id;
  perform public.write_admin_audit_event('complete_season','league_season',season.id::text,
    format('Completed %s season. The league is between seasons.',season.season_year),
    jsonb_build_object('status',season.status),
    jsonb_build_object('status','completed','archive_id',archive.id,'restore_point_id',backup->>'id'));
  return jsonb_build_object('season_year',season.season_year,'already_completed',false);
end;
$$;
revoke all on function public.complete_league_season(bigint,bigint,timestamptz,text,jsonb) from public, anon, service_role;
grant execute on function public.complete_league_season(bigint,bigint,timestamptz,text,jsonb) to authenticated;

create or replace function public.activate_league_season(p_season_id bigint)
returns void language plpgsql security definer set search_path = public
set lock_timeout = '3s' set statement_timeout = '15s'
as $$
declare target public.league_seasons%rowtype;
begin
  if auth.role() is distinct from 'authenticated' or not public.is_admin(auth.uid()) then
    raise exception 'Only an admin can activate a league season.' using errcode = '42501';
  end if;
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'Refresh Seasons & League before activation.' using errcode = '40001';
  end if;
  lock table public.league_seasons, public.profiles, public.drivers, public.races,
    public.season_participants, public.picks, public.pick_submission_versions,
    public.results, public.race_driver_groups, public.hall_of_fame_seasons,
    public.hall_of_fame_entries in share row exclusive mode nowait;
  if not public.is_admin(auth.uid()) then raise exception 'Administrator access changed.' using errcode = '42501'; end if;
  select * into target from public.league_seasons where id = p_season_id;
  if not found then raise exception 'Selected season was not found.'; end if;
  if target.status = 'active' then return; end if;
  if target.status <> 'upcoming' then raise exception 'A completed season cannot be reactivated.'; end if;
  if exists (select 1 from public.league_seasons where status = 'active') then
    raise exception 'Complete the current season in Seasons & League before activating another.';
  end if;
  if target.registration_code_configured_at is null or target.roster_configured_at is null then
    raise exception 'Configure the invite code and opening roster before activation.';
  end if;
  perform public.create_season_restore_point_v2(target.id,
    format('Before activating %s season',target.season_year),'pre_rollover',format('season:%s:activation',target.id));
  update public.drivers set opening_seed_standing = current_standing, championship_points = 0 where is_active;
  update public.league_seasons set status = 'active', activated_at = now(), completed_at = null where id = target.id;
  perform public.write_admin_audit_event('activate_season','league_season',target.id::text,
    format('Activated %s season and opened registration.',target.season_year),
    jsonb_build_object('status',target.status),jsonb_build_object('status','active'));
end;
$$;
revoke all on function public.activate_league_season(bigint) from public, anon, service_role;
grant execute on function public.activate_league_season(bigint) to authenticated;

create or replace function public.admin_update_participant_v2(
  p_profile_id uuid, p_full_name text, p_team_name text, p_account_eligible boolean,
  p_season_registered boolean, p_force_removal boolean, p_expected_season_id bigint
)
returns integer language plpgsql security definer set search_path = public
set lock_timeout = '3s' set statement_timeout = '10s'
as $$
declare active_id bigint; before_profile jsonb;
begin
  if auth.role() is distinct from 'authenticated' or not public.is_admin(auth.uid()) then
    raise exception 'Only an admin can update participant accounts.' using errcode = '42501';
  end if;
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'Refresh Participants before saving.' using errcode = '40001';
  end if;
  lock table public.league_seasons, public.races, public.profiles, public.season_participants, public.picks
    in share row exclusive mode nowait;
  if not public.is_admin(auth.uid()) then raise exception 'Administrator access changed.' using errcode = '42501'; end if;
  select id into active_id from public.league_seasons where status = 'active';
  if active_id is distinct from p_expected_season_id then
    raise exception 'The active season changed. Refresh Participants before saving.' using errcode = '40001';
  end if;
  if active_id is not null then
    return public.admin_update_participant(p_profile_id,p_full_name,p_team_name,p_account_eligible,p_season_registered,p_force_removal);
  end if;
  if p_season_registered is distinct from false or p_force_removal is distinct from false then
    raise exception 'There is no active season to change registration or scoring.';
  end if;
  if length(trim(coalesce(p_full_name,''))) not between 1 and 100
    or length(trim(coalesce(p_team_name,''))) not between 1 and 100 or p_account_eligible is null then
    raise exception 'Enter a name, team name and participation choice.';
  end if;
  select to_jsonb(profile) into before_profile from public.profiles profile where id = p_profile_id;
  if not found then raise exception 'Participant was not found.'; end if;
  update public.profiles set full_name = trim(p_full_name), team_name = trim(p_team_name), is_active = p_account_eligible where id = p_profile_id;
  perform public.write_admin_audit_event('update','participant',p_profile_id::text,
    'Updated participant profile and eligibility between seasons.',before_profile,
    (select to_jsonb(profile) from public.profiles profile where id = p_profile_id));
  return 0;
end;
$$;
revoke all on function public.admin_update_participant_v2(uuid,text,text,boolean,boolean,boolean,bigint) from public, anon, service_role;
grant execute on function public.admin_update_participant_v2(uuid,text,text,boolean,boolean,boolean,bigint) to authenticated;

create or replace function public.get_admin_capability_status()
returns jsonb language plpgsql stable security definer set search_path = public
as $$
declare items jsonb;
begin
  if auth.role() is distinct from 'authenticated' or not public.is_admin(auth.uid()) then
    raise exception 'Admin access required.' using errcode = '42501';
  end if;
  select jsonb_agg(jsonb_build_object('name',name,'installed',
    to_regprocedure(signature) is not null and coalesce(has_function_privilege('authenticated',to_regprocedure(signature),'EXECUTE'),false)) order by name)
  into items from (values
    ('Admin roles','public.admin_update_participant_role(uuid,text,text)'),
    ('Historical imports','public.import_historical_hall_of_fame_season(integer,integer,jsonb)'),
    ('Field freezing','public.admin_freeze_race_field(bigint)'),
    ('Bulk drivers','public.admin_set_driver_roster_status(jsonb,boolean)'),
    ('Bulk participants','public.admin_bulk_update_participants(text,bigint,jsonb)'),
    ('Rules documents','public.set_league_season_rules_document(bigint,text,text)'),
    ('Season closeout review','public.get_season_closeout_context(bigint)'),
    ('Season completion','public.complete_league_season(bigint,bigint,timestamptz,text,jsonb)'),
    ('Participant profile editing','public.admin_update_participant_v2(uuid,text,text,boolean,boolean,boolean,bigint)')
  ) as capability(name,signature);
  return jsonb_build_object('items',items);
end;
$$;
revoke all on function public.get_admin_capability_status() from public, anon, service_role;
grant execute on function public.get_admin_capability_status() to authenticated;
commit;
