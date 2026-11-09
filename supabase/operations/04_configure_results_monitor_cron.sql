-- Run only AFTER the reviewed workflow/public application is released on main.
-- Vault: unique mound_hounds_results_github_token, fine-grained THIS-repo Actions RW.
-- GitHub Actions: two secrets and variables documented in docs/START_HERE.md.
-- No credential literals belong in this file, cron.job or a queued HTTP request.
create extension if not exists pg_cron;
create extension if not exists http with schema extensions;
create or replace function public.dispatch_due_results_monitor()
returns integer language plpgsql security definer set search_path=public set statement_timeout='15s' as $$
declare race_ids bigint[]; github_token text; http_status integer; failure text;
 maintenance_day text:=to_char(now() at time zone 'UTC','YYYY-MM-DD');
begin
 if not pg_try_advisory_xact_lock(73427,20261108) then return 0; end if;
 -- The minute clock must not grow an unbounded history. Touch only this job's
 -- completed entries: one day of success, seven of failures, at most 2000/day.
 if not exists(select 1 from public.app_metadata where key='results_clock_cleanup_day' and value=maintenance_day) then
  delete from cron.job_run_details where runid in (
   select d.runid from cron.job_run_details d join cron.job j on j.jobid=d.jobid
   where j.jobname='official_results_calendar' and d.end_time is not null
    and (d.end_time<now()-interval '7 days' or (d.status='succeeded' and d.end_time<now()-interval '1 day'))
   order by d.end_time limit 2000
  );
  insert into public.app_metadata(key,value) values('results_clock_cleanup_day',maintenance_day)
   on conflict(key) do update set value=excluded.value,updated_at=now();
 end if;
 -- GitHub acceptance is not a successful worker check. Surface a disabled or
 -- disconnected worker after a grace period; source claims clear this warning.
 update public.race_result_sources set dispatch_error_code='dispatch_worker_missing',dispatch_accepted_at=null
 where dispatch_accepted_at<now()-interval '10 minutes'
  and coalesce(last_checked_at,'-infinity'::timestamptz)<dispatch_accepted_at
  and monitor_enabled and official_staged_at is null;
 select array_agg(race_id) into race_ids from (
  select x.race_id from public.race_result_sources x join public.races r on r.id=x.race_id join public.league_seasons s on s.id=r.season_id
  where x.monitor_enabled and x.official_staged_at is null and s.status='active' and not r.is_archived and r.results_status='draft'
   and greatest(r.race_date+interval '150 minutes',coalesce(x.poll_after,'-infinity'::timestamptz))<=now()
   and coalesce(x.next_poll_at,'-infinity'::timestamptz)<=now()
   and coalesce(x.poll_lease_expires_at,'-infinity'::timestamptz)<=now()
   and coalesce(x.dispatch_requested_at,'-infinity'::timestamptz)<=now()-interval '15 minutes'
  order by r.race_date limit 10 for update of x skip locked
 ) due;
 -- No Vault access, worker dispatch or INDYCAR request outside a due race.
 if race_ids is null then return 0; end if;
 select decrypted_secret into github_token from vault.decrypted_secrets where name='mound_hounds_results_github_token';
 if github_token is null or length(github_token)<20 then
  failure:='dispatch_auth';
 else
  -- Synchronous bounded dispatch avoids persisting the PAT in pg_net's queue
  -- and inspects GitHub's actual status. Never save/log response bodies or errors.
  begin
   perform extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS','10000');
   perform extensions.http_set_curlopt('CURLOPT_FOLLOWLOCATION','0');
   select status into http_status from extensions.http((
    'POST','https://api.github.com/repos/c21matthewm/mound_hounds_pickem/actions/workflows/results-monitor.yml/dispatches',
    array[row('Authorization','Bearer '||github_token)::extensions.http_header,
     row('Accept','application/vnd.github+json')::extensions.http_header,
     row('X-GitHub-Api-Version','2022-11-28')::extensions.http_header,
     row('User-Agent','MoundHoundsResultsMonitor/1.0')::extensions.http_header],
    'application/json',jsonb_build_object('ref','main','inputs',jsonb_build_object('dry_run','false'))::text
   )::extensions.http_request);
   perform extensions.http_reset_curlopt();
   failure:=case when http_status=204 then null when http_status in(401,403) then 'dispatch_auth' when http_status in(404,422) then 'dispatch_setup' else 'dispatch_unavailable' end;
  exception when others then
   perform extensions.http_reset_curlopt();
   failure:='dispatch_unavailable';
  end;
 end if;
 update public.race_result_sources set dispatch_requested_at=now(),dispatch_error_code=failure,
  dispatch_accepted_at=case when failure is null then now() else null end where race_id=any(race_ids);
 return case when failure is null then cardinality(race_ids) else 0 end;
end;
$$;
revoke all on function public.dispatch_due_results_monitor() from public,anon,authenticated,service_role;
-- The named schedule updates in place on rerun, preserving jobid/history.
-- The cheap clock avoids startup-delay drift; source fetches remain >=15min apart.
select cron.schedule('official_results_calendar','* * * * *','select public.dispatch_due_results_monitor();');
select jobname,schedule,active from cron.job where jobname='official_results_calendar';
