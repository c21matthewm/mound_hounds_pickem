-- Explicit official-source bindings and immutable, approval-gated result previews.
-- This migration does not enable a monitor or configure a messaging provider.
begin;
create schema if not exists results_automation_private;
revoke all on schema results_automation_private from public, anon, authenticated, service_role;

create table public.race_result_sources (
  race_id bigint primary key references public.races(id) on delete cascade,
  event_id text not null check (length(event_id) between 1 and 128),
  session_id text not null check (length(session_id) between 1 and 64),
  source_url text not null check (length(source_url) <= 1800 and source_url ~ '^https://(www\.)?indycar\.com/[^[:space:]]+$'),
  monitor_enabled boolean not null default false,
  poll_after timestamptz,
  next_poll_at timestamptz,
  dispatch_requested_at timestamptz,
  dispatch_accepted_at timestamptz,
  dispatch_error_code text check (dispatch_error_code in ('dispatch_auth','dispatch_setup','dispatch_unavailable','dispatch_worker_missing')),
  poll_token uuid,
  poll_lease_expires_at timestamptz,
  official_staged_at timestamptz,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  last_checked_at timestamptz,
  last_error_code text check (length(last_error_code) <= 120)
);
create table public.staged_race_results (
  id uuid primary key default extensions.gen_random_uuid(),
  race_id bigint not null references public.races(id) on delete cascade,
  staging_order bigint generated always as identity unique,
  preview_revision integer not null default 1 check (preview_revision > 0),
  payload_hash text not null check (payload_hash ~ '^[a-f0-9]{64}$'),
  context_hash text not null check (context_hash ~ '^[a-f0-9]{64}$'),
  source_payload jsonb not null check (jsonb_typeof(source_payload) = 'object'),
  preview jsonb not null check (jsonb_typeof(preview) = 'object'),
  flags jsonb not null check (jsonb_typeof(flags) = 'array' and jsonb_array_length(flags) <= 1024),
  status text not null check (status in ('READY_TO_PUBLISH','NEEDS_REVIEW','SUPERSEDED','PUBLISHED')),
  created_at timestamptz not null default now(),
  published_at timestamptz,
  unique (race_id, payload_hash, preview_revision)
);
-- An explicit authenticated Admin approval binds one immutable run. Tokens are hashed.
create table public.race_result_approvals (
  message_id text primary key check (length(message_id) between 8 and 100),
  run_id uuid not null references public.staged_race_results(id) on delete cascade,
  approval_state text not null check (approval_state in ('APPROVED','BLOCKED')),
  token_hash text not null check (token_hash ~ '^[a-f0-9]{64}$'),
  context_hash text not null check (context_hash ~ '^[a-f0-9]{64}$'),
  approver_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '10 minutes'),
  consumed_at timestamptz
);
-- Access patterns: latest previews for one race; a small pending-notification queue.
create index staged_results_latest on public.staged_race_results(race_id, staging_order desc);
alter table public.race_result_sources enable row level security;
alter table public.staged_race_results enable row level security;
alter table public.race_result_approvals enable row level security;
revoke all on public.race_result_sources, public.staged_race_results, public.race_result_approvals from public, anon, authenticated, service_role;
grant select on public.race_result_sources, public.staged_race_results to authenticated;
create policy result_sources_admin_read on public.race_result_sources for select to authenticated using (public.is_admin(auth.uid()));
create policy staged_results_admin_read on public.staged_race_results for select to authenticated using (public.is_admin(auth.uid()));

-- Reuse the exact existing atomic publication algorithm, without changing domain math.
create or replace function results_automation_private.publish_race_results_core(
  p_race_id bigint,
  p_results jsonb,
  p_official_winning_average_speed numeric
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  distinct_driver_count integer;
  distinct_position_count integer;
  expected_count integer;
  maximum_position integer;
  minimum_position integer;
  payload_count integer;
  race_pick_format text;
begin
  if jsonb_typeof(p_results) <> 'array' then
    raise exception 'Race results payload must be an array.';
  end if;

  if p_official_winning_average_speed is null or p_official_winning_average_speed <= 0 then
    raise exception 'Official winning average speed must be greater than zero.';
  end if;

  expected_count := public.ensure_race_result_field_snapshot(p_race_id);

  select r.pick_format into race_pick_format
  from public.races r
  where r.id = p_race_id;

  select
    count(*),
    count(distinct payload.driver_id),
    count(distinct payload.position),
    min(payload.position),
    max(payload.position)
    into
      payload_count,
      distinct_driver_count,
      distinct_position_count,
      minimum_position,
      maximum_position
  from jsonb_to_recordset(p_results) as payload(driver_id bigint, points integer, position integer);

  if payload_count = 0 or payload_count > expected_count then
    raise exception 'Cannot publish results: % official rows were supplied for a % driver snapshot.', payload_count, expected_count;
  end if;

  if race_pick_format = 'indy_500' and payload_count <> expected_count then
    raise exception 'Indianapolis 500 results require all % snapshotted drivers; % rows were supplied.', expected_count, payload_count;
  end if;

  if race_pick_format = 'standard' and expected_count - payload_count > 5 then
    raise exception 'Too many snapshotted drivers are absent from the official order (%). Review the pasted results before publishing.', expected_count - payload_count;
  end if;

  if distinct_driver_count <> payload_count then
    raise exception 'Cannot publish results because duplicate drivers were supplied.';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_results) as payload(driver_id bigint, points integer, position integer)
    where payload.driver_id is null
      or payload.points is null
      or payload.points < 0
      or payload.position is null
      or payload.position < 1
  ) then
    raise exception 'Every result requires a driver, a finishing position, and non-negative integer points.';
  end if;

  if distinct_position_count <> payload_count
    or minimum_position <> 1
    or maximum_position <> payload_count then
    raise exception 'Official finishing positions must be unique and contiguous from 1 through %.', payload_count;
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_results) as payload(driver_id bigint, points integer, position integer)
    left join public.race_driver_groups rg
      on rg.race_id = p_race_id
      and rg.driver_id = payload.driver_id
    where rg.driver_id is null
  ) then
    raise exception 'Cannot publish results because a supplied driver is outside the race field.';
  end if;

  if exists (
    select required_group.group_number
    from generate_series(1, case when race_pick_format = 'indy_500' then 8 else 6 end)
      as required_group(group_number)
    where not exists (
      select 1
      from jsonb_to_recordset(p_results) as payload(driver_id bigint, points integer, position integer)
      join public.race_driver_groups rg
        on rg.race_id = p_race_id
        and rg.driver_id = payload.driver_id
      where rg.group_number = required_group.group_number
    )
  ) then
    raise exception 'Official results must include at least one participating driver from every pick group.';
  end if;

  delete from public.results
  where race_id = p_race_id;

  insert into public.results (race_id, driver_id, points)
  select p_race_id, payload.driver_id, payload.points
  from jsonb_to_recordset(p_results) as payload(driver_id bigint, points integer, position integer);

  insert into public.results (race_id, driver_id, points)
  select p_race_id, rg.driver_id, 0
  from public.race_driver_groups rg
  where rg.race_id = p_race_id
    and not exists (
      select 1
      from jsonb_to_recordset(p_results) as payload(driver_id bigint, points integer, position integer)
      where payload.driver_id = rg.driver_id
    );

  update public.races
  set
    official_winning_average_speed = p_official_winning_average_speed,
    results_status = 'published',
    results_published_at = timezone('utc', now()),
    winner_profile_id = null,
    winner_source = 'auto',
    winner_is_manual_override = false,
    winner_auto_eligible_at = timezone('utc', now()) + interval '15 minutes',
    winner_set_at = null
  where id = p_race_id;

  perform public.refresh_driver_standings_from_published_results();
  return expected_count;
end;
$$;

revoke all on function results_automation_private.publish_race_results_core(bigint,jsonb,numeric) from public,anon,authenticated,service_role;
create or replace function public.publish_race_results(p_race_id bigint,p_results jsonb,p_official_winning_average_speed numeric)
returns integer language plpgsql security definer set search_path = public set lock_timeout='3s' set statement_timeout='15s' as $$
declare result_count integer;
begin
  if not public.is_admin(auth.uid()) then raise exception 'Admin access required.'; end if;
  result_count := results_automation_private.publish_race_results_core(p_race_id,p_results,p_official_winning_average_speed);
  -- Explicit manual corrections remain supported; stale approvals cannot override them.
  update public.staged_race_results set status = 'SUPERSEDED'
    where race_id = p_race_id and status in ('READY_TO_PUBLISH','NEEDS_REVIEW');
  return result_count;
end;
$$;
revoke all on function public.publish_race_results(bigint,jsonb,numeric) from public,anon,service_role;
grant execute on function public.publish_race_results(bigint,jsonb,numeric) to authenticated;

create function results_automation_private.context(p_race_id bigint)
returns jsonb language sql stable security definer set search_path = public as $$
select jsonb_build_object(
 'race', jsonb_build_object('id',r.id,'race_name',r.race_name,'season_id',r.season_id,'season',s.season_year,
   'season_status',s.status,'race_date',r.race_date,'results_status',r.results_status,'is_archived',r.is_archived,
   'pick_format',r.pick_format,'field_frozen_at',r.field_frozen_at,'round_number',r.round_number),
 'source', (select jsonb_build_object('event_id',x.event_id,'session_id',x.session_id,'source_url',x.source_url,
   'monitor_enabled',x.monitor_enabled,'poll_after',x.poll_after) from public.race_result_sources x where x.race_id=r.id),
 'drivers', (select coalesce(jsonb_agg(jsonb_build_object('id',d.id,'driverName',d.driver_name,'groupNumber',d.group_number,'isActive',d.is_active) order by d.id),'[]'::jsonb) from public.drivers d),
 'raceDriverGroups', (select coalesce(jsonb_agg(jsonb_build_object('race_id',g.race_id,'driver_id',g.driver_id,'group_number',g.group_number,'qualifying_position',g.qualifying_position) order by g.driver_id),'[]'::jsonb) from public.race_driver_groups g where g.race_id=r.id)
) from public.races r join public.league_seasons s on s.id=r.season_id where r.id=p_race_id;
$$;
create function results_automation_private.context_hash(p_race_id bigint)
returns text language sql stable security definer set search_path=public as $$
 with raw as materialized(select results_automation_private.context(p_race_id) ctx),
 normalized as(select jsonb_set(ctx,'{source}',case when jsonb_typeof(ctx->'source')='object' then (ctx->'source')-'monitor_enabled'-'poll_after' else 'null'::jsonb end) ctx from raw)
 select encode(extensions.digest((case when jsonb_array_length(ctx->'raceDriverGroups')>0 then
  jsonb_set(ctx,'{drivers}',(select coalesce(jsonb_agg(jsonb_build_object('id',d->'id','driverName',d->'driverName') order by (d->>'id')::bigint),'[]'::jsonb) from jsonb_array_elements(ctx->'drivers') d))
  else ctx end)::text,'sha256'),'hex') from normalized;
$$;
revoke all on function results_automation_private.context(bigint),results_automation_private.context_hash(bigint) from public,anon,authenticated,service_role;

create function public.get_results_automation_context(p_race_id bigint)
returns jsonb language plpgsql security definer set search_path = public set lock_timeout='3s' set statement_timeout='15s' as $$
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Service access required.'; end if;
 return jsonb_build_object('context',results_automation_private.context(p_race_id),'context_hash',results_automation_private.context_hash(p_race_id));
end;
$$;

create function public.configure_results_monitor(p_race_id bigint,p_event_id text,p_session_id text,p_source_url text,p_poll_after timestamptz,p_enabled boolean)
returns jsonb language plpgsql security definer set search_path=public set lock_timeout='3s' set statement_timeout='15s' as $$
declare previous public.race_result_sources; source_changed boolean;
begin
 if not public.is_admin(auth.uid()) then raise exception 'Admin access required.'; end if;
 perform 1 from public.races where id=p_race_id and not is_archived for update;
 if not found then raise exception 'Select an editable race.'; end if;
 select * into previous from public.race_result_sources where race_id=p_race_id;
 source_changed:=previous.race_id is null or previous.event_id is distinct from btrim(p_event_id) or previous.session_id is distinct from btrim(p_session_id) or previous.source_url is distinct from btrim(p_source_url);
 insert into public.race_result_sources(race_id,event_id,session_id,source_url,poll_after,monitor_enabled,updated_by)
 values(p_race_id,btrim(p_event_id),btrim(p_session_id),btrim(p_source_url),p_poll_after,p_enabled,auth.uid())
 on conflict(race_id) do update set event_id=excluded.event_id,session_id=excluded.session_id,source_url=excluded.source_url,
 poll_after=excluded.poll_after,monitor_enabled=excluded.monitor_enabled,updated_by=auth.uid(),updated_at=now(),
 next_poll_at=null,dispatch_requested_at=null,dispatch_accepted_at=null,dispatch_error_code=null,poll_token=null,poll_lease_expires_at=null,
 official_staged_at=case when source_changed then null else race_result_sources.official_staged_at end;
 if source_changed then update public.staged_race_results set status='SUPERSEDED' where race_id=p_race_id and status in ('READY_TO_PUBLISH','NEEDS_REVIEW'); end if;
 return jsonb_build_object('status','configured');
end;
$$;

create function public.results_automation_candidates(p_claim boolean default false)
returns jsonb language plpgsql security definer set search_path=public set lock_timeout='3s' set statement_timeout='15s' as $$
declare candidate record; candidates jsonb:='[]'; token uuid;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Service access required.'; end if;
 for candidate in
  select r.id race_id,r.race_name,s.season_year season,x.event_id,x.session_id,x.source_url,
   exists(select 1 from public.staged_race_results sr where sr.race_id=r.id and sr.source_payload->>'source_status'='provisional' and sr.status<>'SUPERSEDED') has_provisional
  from public.races r join public.league_seasons s on s.id=r.season_id join public.race_result_sources x on x.race_id=r.id
  where s.status='active' and not r.is_archived and r.results_status='draft' and x.monitor_enabled and x.official_staged_at is null
   and greatest(r.race_date+interval '150 minutes',coalesce(x.poll_after,'-infinity'::timestamptz))<=now()
   and coalesce(x.next_poll_at,'-infinity'::timestamptz)<=now()
   and coalesce(x.poll_lease_expires_at,'-infinity'::timestamptz)<=now()
  order by x.last_checked_at asc nulls first,r.race_date,r.id limit 10 for update of x skip locked
 loop
  token:=null;
  if p_claim then
   token:=extensions.gen_random_uuid();
   update public.race_result_sources set poll_token=token,poll_lease_expires_at=now()+interval '5 minutes',next_poll_at=now()+interval '15 minutes',dispatch_error_code=null,dispatch_accepted_at=null where race_id=candidate.race_id;
  end if;
  candidates:=candidates||jsonb_build_array(to_jsonb(candidate)||jsonb_build_object('poll_token',token));
 end loop;
 return jsonb_build_object('races',candidates);
end;
$$;

create function public.results_automation_monitor_result(p_race_id bigint,p_error_code text,p_poll_token uuid)
returns jsonb language plpgsql security definer set search_path=public set lock_timeout='3s' set statement_timeout='15s' as $$
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Service access required.'; end if;
 update public.race_result_sources set last_checked_at=now(),last_error_code=left(p_error_code,120),poll_token=null,poll_lease_expires_at=null where race_id=p_race_id and poll_token=p_poll_token;
 return jsonb_build_object('status',case when found then 'recorded' else 'stale' end);
end;
$$;

create function results_automation_private.has_official_evidence(payload jsonb)
returns boolean language sql immutable as $$
 select coalesce(payload->>'source_status'='official'
 and payload->'official_evidence'->>'header' ~* '^OFFICIAL (FINAL |RACE )?RESULTS$'
 and payload->'official_evidence'->>'sha256' ~ '^[a-f0-9]{64}$'
 and case payload->'official_evidence'->>'kind'
  when 'html_header' then payload->'official_evidence'->>'source_url'=payload->>'source_url'
  when 'pdf_header' then payload->'official_evidence'->>'source_url' ~ '^https://www[.]imscdn[.]com/INDYCAR/Documents/[0-9]+/[0-9]+/indycar-race-results[.]pdf$'
  else false end,false);
$$;
revoke all on function results_automation_private.has_official_evidence(jsonb) from public,anon,authenticated,service_role;

create function public.stage_race_results(p_race_id bigint,p_payload_hash text,p_context_hash text,p_source_payload jsonb,p_preview jsonb,p_flags jsonb)
returns jsonb language plpgsql security definer set search_path = public set lock_timeout='3s' set statement_timeout='15s' as $$
declare new_run public.staged_race_results; race_row public.races; source_row public.race_result_sources;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Service access required.'; end if;
 select * into race_row from public.races where id=p_race_id for update;
 if not found then raise exception 'Race not found.'; end if;
 select * into new_run from public.staged_race_results where race_id=p_race_id and payload_hash=p_payload_hash order by preview_revision desc limit 1;
 if found then
  update public.race_result_sources set official_staged_at=now(),poll_token=null,poll_lease_expires_at=null
   where race_id=p_race_id and monitor_enabled and results_automation_private.has_official_evidence(p_source_payload)
    and source_url=p_source_payload->>'source_url' and event_id=p_source_payload->>'event_id' and session_id=p_source_payload->>'session_id';
  return jsonb_build_object('status','already_processed','run',to_jsonb(new_run));
 end if;
 if race_row.results_status='published' then return jsonb_build_object('status','already_processed','run',null); end if;
 if race_row.is_archived or race_row.race_date>now() or not exists(select 1 from public.league_seasons where id=race_row.season_id and status='active') then
   raise exception 'Only past-due races in the active season can be staged.';
 end if;
 select * into source_row from public.race_result_sources where race_id=p_race_id;
 if source_row.race_id is null or not source_row.monitor_enabled then raise exception 'Configure and enable an official source first.'; end if;
 if p_context_hash is distinct from results_automation_private.context_hash(p_race_id) then raise exception 'Race context changed; stage the source again.'; end if;
 if (select count(*) from public.staged_race_results where race_id=p_race_id) >= 64 then raise exception 'Preview history limit reached; use manual review.'; end if;
 if (select count(*) from public.staged_race_results where race_id=p_race_id and created_at>now()-interval '1 day') >= 12 then
   raise exception 'Daily staging limit reached; use manual review.';
 end if;
 if octet_length(p_source_payload::text)>131072 or octet_length(p_preview::text)>131072 then raise exception 'Result payload is too large.'; end if;
 update public.staged_race_results set status='SUPERSEDED' where race_id=p_race_id and status in ('READY_TO_PUBLISH','NEEDS_REVIEW');
 insert into public.staged_race_results(race_id,payload_hash,context_hash,source_payload,preview,flags,status)
 values(p_race_id,p_payload_hash,p_context_hash,p_source_payload,p_preview,p_flags,
   case when jsonb_array_length(p_flags)=0 and p_preview->>'isClean'='true' and results_automation_private.has_official_evidence(p_source_payload) then 'READY_TO_PUBLISH' else 'NEEDS_REVIEW' end)
 returning * into new_run;
 if results_automation_private.has_official_evidence(p_source_payload) and source_row.source_url=p_source_payload->>'source_url'
  and source_row.event_id=p_source_payload->>'event_id' and source_row.session_id=p_source_payload->>'session_id' then
  update public.race_result_sources set official_staged_at=now(),poll_token=null,poll_lease_expires_at=null where race_id=p_race_id;
 end if;
 return jsonb_build_object('status','staged','run',to_jsonb(new_run));
end;
$$;

create function public.results_automation_state(p_race_id bigint)
returns jsonb language plpgsql security definer set search_path = public set lock_timeout='3s' set statement_timeout='15s' as $$
begin
 if not public.is_admin(auth.uid()) then raise exception 'Admin access required.'; end if;
 return jsonb_build_object('can_monitor',exists(select 1 from public.races r join public.league_seasons s on s.id=r.season_id where r.id=p_race_id and s.status='active' and not r.is_archived and r.results_status='draft'),'source',(select to_jsonb(x) from public.race_result_sources x where x.race_id=p_race_id),
   'runs',(select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) from (
    select id,race_id,status,flags,preview,source_payload->>'source_status' source_status,created_at,published_at,context_hash
    from public.staged_race_results where race_id=p_race_id order by staging_order desc limit 10) x));
end;
$$;

create function public.approve_staged_race_results(p_run_id uuid,p_message_id text,p_token_hash text,p_approver_id uuid)
returns jsonb language plpgsql security definer set search_path=public set lock_timeout='3s' set statement_timeout='15s' as $$
declare run_row public.staged_race_results; approval_row public.race_result_approvals; selected_race_id bigint;
begin
 if not public.is_admin(auth.uid()) then raise exception 'Admin approval required.'; end if;
 if p_approver_id is distinct from auth.uid() then raise exception 'Approval actor mismatch.'; end if;
 select race_id into selected_race_id from public.staged_race_results where id=p_run_id;
 perform 1 from public.races where id=selected_race_id for update;
 select * into run_row from public.staged_race_results where id=p_run_id for update;
 if not found then raise exception 'Staged result not found.'; end if;
 if p_message_id !~ '^admin:[a-f0-9-]{36}$' then raise exception 'Explicit Admin approval required.'; end if;
 -- A rejected form cannot gain authority after the preview changes.
 insert into public.race_result_approvals(message_id,run_id,token_hash,context_hash,approver_id,approval_state)
 values(p_message_id,p_run_id,p_token_hash,run_row.context_hash,p_approver_id,'BLOCKED') on conflict(message_id) do nothing;
 if not found then
   select * into approval_row from public.race_result_approvals where message_id=p_message_id for update;
   if approval_row.run_id<>p_run_id or approval_row.token_hash<>p_token_hash or approval_row.approver_id<>p_approver_id or approval_row.approval_state<>'APPROVED' then
     return jsonb_build_object('status','blocked');
   end if;
   if run_row.status='PUBLISHED' and approval_row.consumed_at is not null then return jsonb_build_object('status','already_processed'); end if;
   if approval_row.context_hash<>run_row.context_hash or approval_row.expires_at<=now() or approval_row.consumed_at is not null then
     return jsonb_build_object('status','blocked');
   end if;
 end if;
 if run_row.status='PUBLISHED' then return jsonb_build_object('status','already_processed'); end if;
 if not public.is_admin(p_approver_id) or run_row.status<>'READY_TO_PUBLISH' or jsonb_array_length(run_row.flags)<>0
   or run_row.context_hash is distinct from results_automation_private.context_hash(run_row.race_id) then
   return jsonb_build_object('status','blocked');
 end if;
 update public.race_result_approvals set approval_state='APPROVED' where message_id=p_message_id;
 return jsonb_build_object('status','approved');
end;
$$;

create function public.publish_staged_race_results(p_run_id uuid,p_message_id text,p_approval_token text)
returns jsonb language plpgsql security definer set search_path = public set lock_timeout='3s' set statement_timeout='15s' as $$
declare run_row public.staged_race_results; approval_row public.race_result_approvals; race_row public.races; result_count integer; expected_count integer;
begin
 if not public.is_admin(auth.uid()) then raise exception 'Admin approval required.'; end if;
 select r.* into race_row from public.races r join public.staged_race_results sr on sr.race_id=r.id where sr.id=p_run_id for update of r;
 select * into run_row from public.staged_race_results where id=p_run_id for update;
 if not found then raise exception 'Staged result not found.'; end if;
 select * into approval_row from public.race_result_approvals where message_id=p_message_id and run_id=p_run_id for update;
 if not found or approval_row.approval_state<>'APPROVED' or approval_row.token_hash is distinct from encode(extensions.digest(p_approval_token,'sha256'),'hex') then raise exception 'A valid approval token is required.'; end if;
 if approval_row.approver_id is distinct from auth.uid() then raise exception 'Approval actor mismatch.'; end if;
 if run_row.status='PUBLISHED' and approval_row.consumed_at is not null then return jsonb_build_object('status','already_processed','race_id',run_row.race_id); end if;
 if approval_row.context_hash is distinct from run_row.context_hash then raise exception 'Approval belongs to an older preview.'; end if;
 if approval_row.consumed_at is not null or approval_row.expires_at<=now() then raise exception 'Approval expired or already consumed.'; end if;
 if not exists(select 1 from public.profiles where id=approval_row.approver_id and role='admin') then raise exception 'Approval administrator no longer has the administrator role.'; end if;
 if run_row.status<>'READY_TO_PUBLISH' or jsonb_array_length(run_row.flags)<>0 or run_row.preview->>'isClean' is distinct from 'true' then raise exception 'Unresolved flags block publication.'; end if;
 if race_row.is_archived or race_row.results_status<>'draft' or race_row.race_date>now() or not exists(select 1 from public.league_seasons where id=race_row.season_id and status='active') then raise exception 'Race is no longer eligible for publication.'; end if;
 if race_row.field_frozen_at is null or run_row.context_hash is distinct from results_automation_private.context_hash(run_row.race_id) then raise exception 'Race context changed; revalidate before approval.'; end if;
 if not results_automation_private.has_official_evidence(run_row.source_payload) then raise exception 'Official final results are required.'; end if;
 select count(*) into expected_count from public.race_driver_groups where race_id=run_row.race_id;
 if expected_count=0 or jsonb_array_length(run_row.preview->'publishRows')<>expected_count then raise exception 'Automated publication requires the complete frozen field.'; end if;
 result_count := results_automation_private.publish_race_results_core(run_row.race_id,run_row.preview->'publishRows',(run_row.preview->>'winningAverageSpeed')::numeric);
 update public.race_result_approvals set consumed_at=now() where message_id=p_message_id;
 update public.staged_race_results set status='PUBLISHED',published_at=now() where id=p_run_id;
 insert into public.admin_audit_events(actor_profile_id,action,entity_type,entity_id,summary,after_state)
 values(approval_row.approver_id,'publish_staged_results','race',run_row.race_id::text,'Published explicitly approved official result preview.',
   jsonb_build_object('run_id',p_run_id,'payload_hash',run_row.payload_hash,'published_result_count',result_count));
 return jsonb_build_object('status','published','race_id',run_row.race_id,'race_name',race_row.race_name,'season_id',race_row.season_id,'round_number',race_row.round_number,'result_count',result_count);
end;
$$;


-- Every manual publication path supersedes pending automation, including saved-row publication.
create function results_automation_private.supersede_on_publication()
returns trigger language plpgsql security definer set search_path=public as $$
begin
 if new.results_status='published' then
   update public.staged_race_results sr set
    status=case when sr.status='READY_TO_PUBLISH' and jsonb_array_length(sr.flags)=0
     and (sr.preview->>'winningAverageSpeed')::numeric=new.official_winning_average_speed
     and jsonb_array_length(sr.preview->'publishRows')=(select count(*) from public.results where race_id=new.id)
     and not exists(select 1 from jsonb_to_recordset(sr.preview->'publishRows') as p(driver_id bigint,points integer)
       left join public.results r on r.race_id=new.id and r.driver_id=p.driver_id where r.driver_id is null or r.points<>p.points)
     then 'PUBLISHED' else 'SUPERSEDED' end
   where sr.race_id=new.id and sr.status in ('READY_TO_PUBLISH','NEEDS_REVIEW');
   update public.staged_race_results set published_at=now() where race_id=new.id and status='PUBLISHED' and published_at is null;
 end if;
 return new;
end;
$$;
revoke all on function results_automation_private.supersede_on_publication() from public,anon,authenticated,service_role;
create trigger staged_results_superseded after update of results_status on public.races
 for each row execute function results_automation_private.supersede_on_publication();

create function public.get_results_automation_run(p_run_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Service access required.'; end if;
 return (select to_jsonb(sr) from public.staged_race_results sr where id=p_run_id);
end;
$$;
create function public.revalidate_staged_race_results(p_run_id uuid,p_context_hash text,p_preview jsonb,p_flags jsonb)
returns jsonb language plpgsql security definer set search_path=public set lock_timeout='3s' set statement_timeout='15s' as $$
declare run_row public.staged_race_results; selected_race_id bigint; new_id uuid;
begin
 if not public.is_admin(auth.uid()) then raise exception 'Admin access required.'; end if;
 select race_id into selected_race_id from public.staged_race_results where id=p_run_id;
 perform 1 from public.races where id=selected_race_id and results_status='draft' and not is_archived for update;
 if not found then raise exception 'Race is no longer editable.'; end if;
 select * into run_row from public.staged_race_results where id=p_run_id for update;
 if not found or run_row.status='PUBLISHED' then raise exception 'Preview is not editable.'; end if;
 if p_run_id is distinct from (select id from public.staged_race_results where race_id=selected_race_id order by staging_order desc limit 1) then raise exception 'A newer source version superseded this preview.'; end if;
 if p_context_hash is distinct from results_automation_private.context_hash(selected_race_id) then raise exception 'Race changed during validation; try again.'; end if;
 if run_row.status in ('READY_TO_PUBLISH','NEEDS_REVIEW') and run_row.context_hash=p_context_hash and run_row.preview=p_preview and run_row.flags=p_flags then
   return jsonb_build_object('status','unchanged','run_id',run_row.id);
 end if;
 if (select count(*) from public.staged_race_results where race_id=selected_race_id)>=64 then raise exception 'Preview history limit reached; use manual review.'; end if;
 -- A changed preview gets a NEW immutable run ID. Old browser forms
 -- can never approve content different from the preview they displayed.
 update public.race_result_approvals set expires_at=least(expires_at,now()) where run_id=p_run_id and consumed_at is null;
 update public.staged_race_results set status='SUPERSEDED' where id=p_run_id;
 insert into public.staged_race_results(race_id,payload_hash,preview_revision,context_hash,source_payload,preview,flags,status)
 values(selected_race_id,run_row.payload_hash,run_row.preview_revision+1,p_context_hash,run_row.source_payload,p_preview,p_flags,
  case when jsonb_array_length(p_flags)=0 and p_preview->>'isClean'='true' and results_automation_private.has_official_evidence(run_row.source_payload) then 'READY_TO_PUBLISH' else 'NEEDS_REVIEW' end)
 returning id into new_id;
 return jsonb_build_object('status','revalidated','run_id',new_id);
end;
$$;
revoke all on function public.get_results_automation_run(uuid) from public,anon,authenticated;
grant execute on function public.get_results_automation_run(uuid) to service_role;
revoke all on function public.revalidate_staged_race_results(uuid,text,jsonb,jsonb) from public,anon,service_role;
grant execute on function public.revalidate_staged_race_results(uuid,text,jsonb,jsonb) to authenticated;


create function public.results_automation_maintenance()
returns jsonb language plpgsql security definer set search_path=public set lock_timeout='3s' set statement_timeout='15s' as $$
declare removed_count integer; maintenance_day text := to_char(now() at time zone 'UTC','YYYY-MM-DD');
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Service access required.'; end if;
 if not pg_try_advisory_xact_lock(hashtextextended('mound_hounds:results_maintenance',0)) then return jsonb_build_object('status','busy'); end if;
 if exists(select 1 from public.app_metadata where key='results_automation_cleanup_day' and value=maintenance_day) then return jsonb_build_object('status','already_processed'); end if;
 -- Only expendable superseded history from already-published races, never the published run.
 with old_runs as (
   select sr.id from public.staged_race_results sr join public.races r on r.id=sr.race_id
   where r.results_status='published' and sr.status='SUPERSEDED' and sr.created_at < now()-interval '90 days'
   order by sr.created_at limit 100
 ) delete from public.staged_race_results sr using old_runs where sr.id=old_runs.id;
 get diagnostics removed_count = row_count;
 insert into public.app_metadata(key,value) values('results_automation_cleanup_day',maintenance_day)
 on conflict(key) do update set value=excluded.value,updated_at=now();
 return jsonb_build_object('status','completed','removed_count',removed_count);
end;
$$;
revoke all on function public.results_automation_maintenance() from public,anon,authenticated;
grant execute on function public.results_automation_maintenance() to service_role;

-- Every new RPC is closed by default; the public ingestion secret cannot invoke SQL.
revoke all on function public.get_results_automation_context(bigint),public.results_automation_candidates(boolean),public.results_automation_monitor_result(bigint,text,uuid),
 public.stage_race_results(bigint,text,text,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.get_results_automation_context(bigint),public.results_automation_candidates(boolean),public.results_automation_monitor_result(bigint,text,uuid),
 public.stage_race_results(bigint,text,text,jsonb,jsonb,jsonb) to service_role;
revoke all on function public.configure_results_monitor(bigint,text,text,text,timestamptz,boolean),public.results_automation_state(bigint),
 public.approve_staged_race_results(uuid,text,text,uuid),public.publish_staged_race_results(uuid,text,text) from public,anon,service_role;
grant execute on function public.configure_results_monitor(bigint,text,text,text,timestamptz,boolean),public.results_automation_state(bigint),
 public.approve_staged_race_results(uuid,text,text,uuid),public.publish_staged_race_results(uuid,text,text) to authenticated;
insert into public.app_metadata(key,value) values('results_automation_version','20261108') on conflict(key) do update set value=excluded.value,updated_at=now();
commit;
