-- Canonical Supabase cron configuration.
--
-- Before running:
-- 1. Rotate CRON_SECRET in Vercel and redeploy production.
-- 2. Paste that new value below.
-- 3. Leave enable_pick_reminders false until email delivery is intentionally enabled.
-- 4. Run this from an unsaved SQL Editor tab, then close the tab without saving it.

create extension if not exists pg_cron;
create extension if not exists pg_net;

do $configure_cron$
declare
  new_cron_secret text := 'REPLACE_WITH_NEW_CRON_SECRET';
  enable_pick_reminders boolean := false;
  production_origin text := 'https://moundhoundspickem.app';
  existing_job record;
  fantasy_winner_command text;
  pick_reminder_command text;
begin
  if new_cron_secret = 'REPLACE_WITH_NEW_CRON_SECRET'
    or length(new_cron_secret) < 32 then
    raise exception 'Replace new_cron_secret with the rotated Vercel CRON_SECRET.';
  end if;

  fantasy_winner_command := format(
    $command$
      select net.http_post(
        url := %L,
        headers := jsonb_build_object(
          'authorization', %L,
          'content-type', 'application/json'
        ),
        body := '{}'::jsonb
      );
    $command$,
    production_origin || '/api/cron/fantasy-winner',
    'Bearer ' || new_cron_secret
  );

  pick_reminder_command := format(
    $command$
      select net.http_post(
        url := %L,
        headers := jsonb_build_object(
          'authorization', %L,
          'content-type', 'application/json'
        ),
        body := '{}'::jsonb
      );
    $command$,
    production_origin || '/api/cron/pick-reminders',
    'Bearer ' || new_cron_secret
  );

  for existing_job in
    select jobid
    from cron.job
    where jobname in (
      'fantasy_winner_5min',
      'fantasy_winner_hourly',
      'pick_reminders_5min'
    )
      or command ilike '%/api/cron/fantasy-winner%'
      or command ilike '%/api/cron/pick-reminders%'
  loop
    perform cron.unschedule(existing_job.jobid);
  end loop;

  perform cron.schedule(
    'fantasy_winner_hourly',
    '17 * * * *',
    fantasy_winner_command
  );

  if enable_pick_reminders then
    perform cron.schedule(
      'pick_reminders_5min',
      '*/5 * * * *',
      pick_reminder_command
    );
  end if;
end;
$configure_cron$;

select jobid, jobname, schedule, active
from cron.job
where jobname in ('fantasy_winner_hourly', 'pick_reminders_5min')
order by jobname;

