-- Read-only production health and database-contract verification.

with checks as (
  select
    'schema'::text as check_group,
    'schema_version'::text as check_name,
    case
      when metadata.value = '20260730_atomic_picks_recovery_v1' then 'PASS'
      else 'WARN'
    end as status,
    coalesce(metadata.value, 'missing') as details
  from (select 1) seed
  left join public.app_metadata metadata on metadata.key = 'schema_version'

  union all

  select
    'function',
    required.name,
    case when to_regprocedure(required.signature) is not null then 'PASS' else 'WARN' end,
    required.signature
  from (
    values
      ('publish_race_results', 'public.publish_race_results(bigint,jsonb,numeric)'),
      ('publish_saved_race_results', 'public.publish_saved_race_results(bigint,numeric)'),
      ('save_race_result_draft', 'public.save_race_result_draft(bigint,bigint,integer)'),
      ('refresh_driver_standings', 'public.refresh_driver_standings_from_published_results()'),
      ('atomic_pick_save', 'public.save_weekly_pick(bigint,numeric,bigint[])'),
      ('shared_pick_window_validation', 'public.validate_shared_pick_window()'),
      ('reminder_delivery_claim', 'public.claim_pick_reminder_delivery(bigint,uuid,text,text,text)'),
      ('season_backup', 'public.create_season_restore_point(bigint,text,text)'),
      ('season_restore', 'public.restore_season_from_restore_point(uuid,integer)')
  ) required(name, signature)

  union all

  select
    'season',
    'active_season_count',
    case when count(*) = 1 then 'PASS' else 'WARN' end,
    count(*)::text
  from public.league_seasons
  where status = 'active'

  union all

  select
    'race_status',
    race.results_status,
    'INFO',
    count(*)::text
  from public.races race
  group by race.results_status

  union all

  select
    'race_integrity',
    concat('R', race.round_number, ' - ', race.race_name),
    case
      when race.results_status <> 'published' then 'INFO'
      when count(distinct result_row.driver_id) = 0 then 'WARN'
      when count(distinct race_group.driver_id) = 0 then 'INFO'
      -- Known 2026 historical exception: the Race 8 snapshot contains two nonstarters
      -- that predate automatic zero-point result rows.
      when race.id = 128
        and count(distinct result_row.driver_id) = 25
        and count(distinct race_group.driver_id) = 27 then 'INFO'
      when count(distinct race_group.driver_id) > 0
        and count(distinct result_row.driver_id) <> count(distinct race_group.driver_id)
        then 'WARN'
      when race.official_winning_average_speed is null then 'WARN'
      else 'PASS'
    end,
    format(
      'race_id=%s, results=%s, snapshot=%s, avg_speed=%s',
      race.id,
      count(distinct result_row.driver_id),
      count(distinct race_group.driver_id),
      coalesce(race.official_winning_average_speed::text, 'missing')
    )
  from public.races race
  left join public.results result_row on result_row.race_id = race.id
  left join public.race_driver_groups race_group on race_group.race_id = race.id
  group by race.id

  union all

  select
    'cron',
    'fantasy_winner_hourly',
    case
      when count(*) filter (
        where job.jobname = 'fantasy_winner_hourly'
          and job.schedule = '17 * * * *'
          and job.active
      ) = 1
        and count(*) = 1 then 'PASS'
      else 'WARN'
    end,
    format(
      'hourly_jobs=%s, legacy_5min_jobs=%s, endpoint_jobs=%s',
      count(*) filter (where job.jobname = 'fantasy_winner_hourly'),
      count(*) filter (where job.jobname = 'fantasy_winner_5min'),
      count(*)
    )
  from cron.job job
  where job.jobname in ('fantasy_winner_5min', 'fantasy_winner_hourly')
    or job.command ilike '%/api/cron/fantasy-winner%'

  union all

  select
    'cron',
    'pick_reminders_5min',
    case
      when count(*) = 0 then 'INFO'
      when count(*) = 1
        and bool_and(job.active)
        and min(job.schedule) = '*/5 * * * *' then 'PASS'
      else 'WARN'
    end,
    case
      when count(*) = 0 then 'disabled'
      else format('jobs=%s, schedule=%s', count(*), min(job.schedule))
    end
  from cron.job job
  where job.jobname = 'pick_reminders_5min'
)
select check_group, check_name, status, details
from checks
order by
  case status when 'WARN' then 0 when 'PASS' then 1 else 2 end,
  check_group,
  check_name;
