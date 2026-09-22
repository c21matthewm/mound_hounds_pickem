-- LATER: run after importing the real 2026 Hall of Fame, configuring the 2027
-- roster/invite/rules, and activating 2027 through the app. Not part of today's reset.
-- Restore the previous active states only; a previously disabled reminder stays disabled.
begin;
do $resume$
declare
  saved_state jsonb;
  saved_job record;
  current_name text;
begin
  if not exists (select 1 from public.hall_of_fame_seasons where season_year = 2026)
    or not exists (select 1 from public.league_seasons where season_year = 2027 and status = 'active'
      and registration_code_configured_at is not null and roster_configured_at is not null) then
    raise exception 'Import the real 2026 archive and configure/activate 2027 before resuming jobs.';
  end if;
  select value::jsonb into saved_state from public.app_metadata where key = 'prelaunch_2027_cron_state';
  if saved_state is null then
    raise exception 'No saved cron state exists. Review job configuration instead of guessing.';
  end if;
  for saved_job in select * from jsonb_to_recordset(saved_state) as j(jobid bigint, jobname text, was_active boolean)
  loop
    execute 'select jobname from cron.job where jobid = $1' into current_name using saved_job.jobid;
    if current_name is distinct from saved_job.jobname then
      raise exception 'A saved cron job changed. Review configuration before resuming.';
    end if;
    perform cron.alter_job(saved_job.jobid, active := saved_job.was_active);
  end loop;
  insert into public.app_metadata (key, value) values ('prelaunch_2027_jobs_resumed_at', now()::text)
  on conflict (key) do update set value = excluded.value;
end;
$resume$;
commit;
select 'PASS: Previous job activation states restored. Previously disabled jobs remain disabled.' as result;
