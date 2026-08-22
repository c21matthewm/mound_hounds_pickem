-- Retire the automated five-day form-open email while preserving sent audit history.

begin;

delete from public.pick_reminders
where reminder_type = '5d_open'
  and delivery_status <> 'sent';

alter table public.pick_reminders
drop constraint if exists pick_reminders_reminder_type_check;

alter table public.pick_reminders
add constraint pick_reminders_reminder_type_check
check (
  reminder_type in ('2d', '4h')
  or (reminder_type = '5d_open' and delivery_status = 'sent')
);

comment on constraint pick_reminders_reminder_type_check on public.pick_reminders is
'Only two-day and four-hour reminders may be queued. Sent five-day rows are retained as historical audit records.';

create or replace function public.validate_pick_reminder_delivery(
  p_reminder_id bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  anchor_race public.races%rowtype;
  current_reminder_type text;
  deadline_at timestamptz;
  missing_races jsonb;
  reminder_row public.pick_reminders%rowtype;
  window_races jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Service role required.';
  end if;

  select * into reminder_row
  from public.pick_reminders reminder
  where reminder.id = p_reminder_id
    and reminder.delivery_status = 'pending';

  if reminder_row.id is null then
    return jsonb_build_object('valid', false);
  end if;

  select * into anchor_race
  from public.races race
  where race.id = reminder_row.race_id
    and race.is_archived = false;

  if anchor_race.id is null
    or not exists (
      select 1
      from public.league_seasons season
      where season.id = anchor_race.season_id
        and season.status = 'active'
    )
    or not exists (
      select 1
      from public.season_participants participant
      join public.profiles profile on profile.id = participant.profile_id
      where participant.profile_id = reminder_row.user_id
        and participant.season_id = anchor_race.season_id
        and participant.status = 'registered'
        and profile.is_active = true
    ) then
    return jsonb_build_object('valid', false);
  end if;

  deadline_at := case
    when anchor_race.pick_format = 'indy_500' then anchor_race.race_date
    else anchor_race.qualifying_start_at
  end;

  current_reminder_type := case
    when deadline_at <= timezone('utc', now()) then null
    when deadline_at - timezone('utc', now()) <= interval '4 hours' then '4h'
    when deadline_at - timezone('utc', now()) <= interval '2 days' then '2d'
    else null
  end;

  if current_reminder_type is distinct from reminder_row.reminder_type then
    return jsonb_build_object('valid', false);
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', race.id,
        'pick_format', race.pick_format,
        'pick_window_key', race.pick_window_key,
        'qualifying_start_at', race.qualifying_start_at,
        'race_date', race.race_date,
        'race_name', race.race_name,
        'round_number', race.round_number,
        'season_id', race.season_id
      )
      order by race.round_number, race.id
    ),
    '[]'::jsonb
  ) into window_races
  from public.races race
  where race.season_id = anchor_race.season_id
    and race.pick_window_key = anchor_race.pick_window_key
    and race.is_archived = false;

  select coalesce(
    jsonb_agg(race_row order by (race_row ->> 'round_number')::integer),
    '[]'::jsonb
  ) into missing_races
  from jsonb_array_elements(window_races) as window_race(race_row)
  where not exists (
    select 1
    from public.picks pick
    where pick.user_id = reminder_row.user_id
      and pick.race_id = (race_row ->> 'id')::bigint
  );

  if jsonb_array_length(missing_races) = 0 then
    return jsonb_build_object('valid', false);
  end if;

  return jsonb_build_object(
    'valid', true,
    'races', window_races,
    'missingRaces', missing_races
  );
end;
$$;

revoke all on function public.validate_pick_reminder_delivery(bigint)
from public, anon, authenticated;
grant execute on function public.validate_pick_reminder_delivery(bigint)
to service_role;

insert into public.app_metadata (key, value)
values ('pick_reminder_policy', '2d_4h_only')
on conflict (key) do update
set value = excluded.value, updated_at = timezone('utc', now());

commit;
