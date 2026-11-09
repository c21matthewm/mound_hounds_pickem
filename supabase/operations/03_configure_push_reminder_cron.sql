-- Run manually only after intentionally enabling email and/or push reminders.
-- In Dashboard -> Vault create/update UNIQUE names mound_hounds_site_url
-- (canonical HTTPS origin, no trailing path) and mound_hounds_cron_secret
-- (the same CRON_SECRET configured in Next). Never save secret literals in SQL.
create extension if not exists pg_cron;
create extension if not exists pg_net;
do $$
begin
 if (select count(*) from vault.decrypted_secrets where name='mound_hounds_site_url')<>1
 or (select count(*) from vault.decrypted_secrets where name='mound_hounds_cron_secret')<>1 then raise exception 'Configure the two unique Vault secrets first.'; end if;
 if (select decrypted_secret from vault.decrypted_secrets where name='mound_hounds_site_url') !~ '^https://[a-zA-Z0-9.-]+$'
 or length((select decrypted_secret from vault.decrypted_secrets where name='mound_hounds_cron_secret'))<32 then raise exception 'Check the canonical origin and cron secret.'; end if;
 perform cron.unschedule(jobid) from cron.job where jobname='pick_reminders_5min';
end;
$$;
select cron.schedule('pick_reminders_5min','*/5 * * * *',$job$
 select net.http_post(
  url := (select decrypted_secret from vault.decrypted_secrets where name='mound_hounds_site_url')||'/api/cron/pick-reminders',
  headers := jsonb_build_object('Authorization','Bearer '||(select decrypted_secret from vault.decrypted_secrets where name='mound_hounds_cron_secret'),'Content-Type','application/json'),
  body := '{}'::jsonb,timeout_milliseconds := 60000);
$job$);
select jobname,schedule,active from cron.job where jobname='pick_reminders_5min';
