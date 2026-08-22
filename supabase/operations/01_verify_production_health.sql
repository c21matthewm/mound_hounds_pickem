-- Read-only production health and database-contract verification.

with checks as (
  select
    'schema'::text as check_group,
    'schema_version'::text as check_name,
    case
      when metadata.value = '20260822_reminder_delivery_v1' then 'PASS'
      else 'WARN'
    end as status,
    coalesce(metadata.value, 'missing') as details
  from (select 1) seed
  left join public.app_metadata metadata on metadata.key = 'schema_version'

  union all

  select
    'reminders',
    'two_stage_policy',
    case
      when metadata.value = '2d_4h_only'
        and not exists (
          select 1
          from public.pick_reminders reminder
          where reminder.reminder_type = '5d_open'
            and reminder.delivery_status <> 'sent'
        ) then 'PASS'
      else 'WARN'
    end,
    format(
      'policy=%s, unsent_5d_rows=%s',
      coalesce(metadata.value, 'missing'),
      (
        select count(*)
        from public.pick_reminders reminder
        where reminder.reminder_type = '5d_open'
          and reminder.delivery_status <> 'sent'
      )
    )
  from (select 1) seed
  left join public.app_metadata metadata on metadata.key = 'pick_reminder_policy'

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
      ('reminder_delivery_validation', 'public.validate_pick_reminder_delivery(bigint)'),
      ('qualifying_schedule_correction', 'public.correct_pick_window_qualifying_start(bigint,timestamptz)'),
      ('registration_rate_limit', 'public.consume_registration_attempt(text[],integer,integer)'),
      ('job_heartbeat_start', 'public.start_job_status(text)'),
      ('job_heartbeat_finish', 'public.finish_job_status(text,uuid,text,jsonb,text,boolean)'),
      ('season_backup', 'public.create_season_restore_point_v2(bigint,text,text,text)'),
      ('season_restore_preview', 'public.preview_season_restore_point(uuid)'),
      ('season_restore', 'public.restore_season_from_restore_point_v2(uuid,integer)'),
      ('record_application_error', 'public.record_app_error_event(uuid,text,text,text,text,text,jsonb,uuid)'),
      ('resolve_application_error', 'public.resolve_app_error_event(bigint)'),
      ('prune_application_errors', 'public.prune_app_error_events()')
  ) required(name, signature)

  union all

  select
    'storage',
    'application_error_inbox',
    case when to_regclass('public.app_error_events') is not null then 'PASS' else 'WARN' end,
    coalesce(to_regclass('public.app_error_events')::text, 'missing')

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

  union all

  select
    'storage',
    'job_run_history',
    case
      when count(*) filter (
        where status = 'succeeded'
          and started_at < timezone('utc', now()) - interval '30 days'
      ) = 0
        and count(*) filter (
          where status in ('degraded', 'failed')
            and started_at < timezone('utc', now()) - interval '90 days'
        ) = 0 then 'PASS'
      else 'WARN'
    end,
    format('retained_events=%s', count(*))
  from public.job_runs

  union all

  select
    'jobs',
    expected.job_name || '_heartbeat',
    case
      when status.job_name is null then 'WARN'
      when status.status in ('degraded', 'failed') then 'WARN'
      when status.last_started_at < timezone('utc', now()) - expected.maximum_age then 'WARN'
      else 'PASS'
    end,
    case
      when status.job_name is null then 'no heartbeat recorded'
      else format(
        'status=%s, last_started_at=%s, run_count=%s',
        status.status,
        status.last_started_at,
        status.run_count
      )
    end
  from (
    values
      ('fantasy-winner'::text, interval '3 hours'),
      ('pick-reminders'::text, interval '20 minutes')
  ) expected(job_name, maximum_age)
  left join public.job_status status on status.job_name = expected.job_name

  union all

  select
    'storage',
    'restore_point_retention',
    case
      when metrics.duplicate_race_checkpoints = 0
        and metrics.oversized_correction_seasons = 0 then 'PASS'
      else 'WARN'
    end,
    format(
      'points=%s, size_mb=%s, duplicate_checkpoints=%s, oversized_correction_seasons=%s',
      metrics.restore_points,
      round(metrics.total_bytes / 1048576.0, 2),
      metrics.duplicate_race_checkpoints,
      metrics.oversized_correction_seasons
    )
  from (
    select
      count(*) as restore_points,
      coalesce(sum(snapshot_bytes), 0) as total_bytes,
      (
        select count(*)
        from (
          select season_id, retention_key
          from public.season_restore_points
          where source = 'result_checkpoint'
          group by season_id, retention_key
          having count(*) > 1
        ) duplicate_keys
      ) as duplicate_race_checkpoints,
      (
        select count(*)
        from (
          select season_id
          from public.season_restore_points
          where source in ('automatic', 'pre_correction')
          group by season_id
          having count(*) > 5
        ) oversized_seasons
      ) as oversized_correction_seasons
    from public.season_restore_points
  ) metrics
)
select check_group, check_name, status, details
from checks
order by
  case status when 'WARN' then 0 when 'PASS' then 1 else 2 end,
  check_group,
  check_name;
