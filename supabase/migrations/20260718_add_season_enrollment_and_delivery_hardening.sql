-- Add per-season participant enrollment and resilient pick-reminder delivery state.

begin;

create table if not exists public.app_metadata (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.season_participants (
  season_id bigint not null references public.league_seasons(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  status text not null check (status in ('registered', 'declined')),
  registered_at timestamptz,
  decided_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (season_id, profile_id),
  check (
    (status = 'registered' and registered_at is not null)
    or (status = 'declined' and registered_at is null)
  )
);

create index if not exists idx_season_participants_profile
on public.season_participants(profile_id, season_id desc);

create index if not exists idx_season_participants_registered
on public.season_participants(season_id, status, profile_id);

drop trigger if exists trg_season_participants_updated_at on public.season_participants;
create trigger trg_season_participants_updated_at
before update on public.season_participants
for each row execute function public.set_updated_at();

do $$
begin
  if not exists (
    select 1
    from public.app_metadata
    where key = 'season_enrollment_legacy_backfill'
  ) then
    insert into public.season_participants (
      season_id,
      profile_id,
      status,
      registered_at,
      decided_at
    )
    select
      season.id,
      profile.id,
      'registered',
      timezone('utc', now()),
      timezone('utc', now())
    from public.league_seasons season
    cross join public.profiles profile
    where season.status = 'active'
      and profile.is_active = true
      and profile.role in ('participant', 'admin')
    on conflict (season_id, profile_id) do nothing;

    -- The former flag represented yearly participation. Enrollment now owns that state;
    -- existing accounts remain eligible to opt into a future season themselves.
    update public.profiles
    set is_active = true
    where is_active = false;

    insert into public.app_metadata (key, value)
    values ('season_enrollment_legacy_backfill', timezone('utc', now())::text);
  end if;
end;
$$;

alter table public.season_participants enable row level security;

grant select, insert, update, delete on table public.season_participants to authenticated;

drop policy if exists season_participants_read_own_or_admin on public.season_participants;
create policy season_participants_read_own_or_admin
on public.season_participants
for select
to authenticated
using (profile_id = auth.uid() or public.is_admin(auth.uid()));

drop policy if exists season_participants_admin_write on public.season_participants;
create policy season_participants_admin_write
on public.season_participants
for all
to authenticated
using (public.is_admin(auth.uid()))
with check (public.is_admin(auth.uid()));

create or replace function public.set_active_season_participation(p_register boolean)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  active_season_id bigint;
  current_profile public.profiles%rowtype;
  next_status text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;

  select * into current_profile
  from public.profiles
  where id = auth.uid();

  if current_profile.id is null
    or length(trim(coalesce(current_profile.full_name, ''))) = 0
    or length(trim(coalesce(current_profile.team_name, ''))) = 0 then
    raise exception 'Complete your profile before choosing a season.';
  end if;

  if current_profile.is_active = false then
    raise exception 'This account is not eligible for league participation.';
  end if;

  select id into active_season_id
  from public.league_seasons
  where status = 'active';

  if active_season_id is null then
    raise exception 'No league season is currently open for registration.';
  end if;

  if p_register = false and exists (
    select 1
    from public.picks pick
    join public.races race on race.id = pick.race_id
    where pick.user_id = auth.uid()
      and race.season_id = active_season_id
  ) then
    raise exception 'A team with submitted picks cannot leave the active season.';
  end if;

  next_status := case when p_register then 'registered' else 'declined' end;

  insert into public.season_participants (
    season_id,
    profile_id,
    status,
    registered_at,
    decided_at
  )
  values (
    active_season_id,
    auth.uid(),
    next_status,
    case when p_register then timezone('utc', now()) else null end,
    timezone('utc', now())
  )
  on conflict (season_id, profile_id) do update
  set
    status = excluded.status,
    registered_at = excluded.registered_at,
    decided_at = excluded.decided_at;

  return active_season_id;
end;
$$;

revoke all on function public.set_active_season_participation(boolean) from public, anon;
grant execute on function public.set_active_season_participation(boolean) to authenticated;

create or replace function public.is_registered_for_season(
  p_profile_id uuid,
  p_season_id bigint
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.season_participants participant
    join public.profiles profile on profile.id = participant.profile_id
    where participant.profile_id = p_profile_id
      and participant.season_id = p_season_id
      and participant.status = 'registered'
      and profile.is_active = true
  );
$$;

revoke all on function public.is_registered_for_season(uuid, bigint) from public, anon;
grant execute on function public.is_registered_for_season(uuid, bigint) to authenticated, service_role;

alter table public.pick_reminders
drop constraint if exists pick_reminders_delivery_status_check;

alter table public.pick_reminders
add constraint pick_reminders_delivery_status_check
check (delivery_status in ('pending', 'sent', 'failed'));

alter table public.pick_reminders
add column if not exists attempt_count integer not null default 0 check (attempt_count between 0 and 10),
add column if not exists last_attempt_at timestamptz,
add column if not exists last_error text,
add column if not exists lease_expires_at timestamptz;

alter table public.pick_reminders
alter column sent_at drop not null,
alter column sent_at drop default;

update public.pick_reminders
set
  attempt_count = greatest(attempt_count, 1),
  last_attempt_at = coalesce(last_attempt_at, sent_at, created_at)
where delivery_status = 'sent';

create index if not exists idx_pick_reminders_delivery_queue
on public.pick_reminders(delivery_status, lease_expires_at, last_attempt_at);

create or replace function public.claim_pick_reminder_delivery(
  p_race_id bigint,
  p_user_id uuid,
  p_reminder_type text,
  p_channel text,
  p_recipient text
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  claimed_id bigint;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Service role required.';
  end if;

  insert into public.pick_reminders (
    race_id,
    user_id,
    reminder_type,
    channel,
    recipient,
    delivery_status,
    attempt_count,
    last_attempt_at,
    lease_expires_at,
    sent_at
  )
  values (
    p_race_id,
    p_user_id,
    p_reminder_type,
    p_channel,
    p_recipient,
    'pending',
    1,
    timezone('utc', now()),
    timezone('utc', now()) + interval '10 minutes',
    null
  )
  on conflict (race_id, user_id, reminder_type, channel) do update
  set
    recipient = excluded.recipient,
    delivery_status = 'pending',
    attempt_count = public.pick_reminders.attempt_count + 1,
    last_attempt_at = timezone('utc', now()),
    last_error = null,
    lease_expires_at = timezone('utc', now()) + interval '10 minutes'
  where (
      public.pick_reminders.delivery_status = 'failed'
      and public.pick_reminders.attempt_count < 3
      and public.pick_reminders.last_attempt_at < timezone('utc', now()) - interval '10 minutes'
    ) or (
      public.pick_reminders.delivery_status = 'pending'
      and public.pick_reminders.attempt_count < 3
      and public.pick_reminders.lease_expires_at < timezone('utc', now())
    )
  returning id into claimed_id;

  return claimed_id;
end;
$$;

revoke all on function public.claim_pick_reminder_delivery(bigint, uuid, text, text, text)
from public, anon, authenticated;
grant execute on function public.claim_pick_reminder_delivery(bigint, uuid, text, text, text)
to service_role;

insert into public.app_metadata (key, value)
values ('schema_version', '20260718_season_enrollment_v1')
on conflict (key) do update
set value = excluded.value, updated_at = timezone('utc', now());

alter table public.app_metadata enable row level security;
grant select on table public.app_metadata to authenticated;

drop policy if exists app_metadata_read_authenticated on public.app_metadata;
create policy app_metadata_read_authenticated
on public.app_metadata
for select
to authenticated
using (true);

alter table public.profiles
drop constraint if exists profiles_full_name_length_check;
alter table public.profiles
add constraint profiles_full_name_length_check
check (full_name is null or length(trim(full_name)) between 1 and 100);

alter table public.profiles
drop constraint if exists profiles_team_name_length_check;
alter table public.profiles
add constraint profiles_team_name_length_check
check (length(trim(team_name)) between 1 and 100);

alter table public.feedback_items
drop constraint if exists feedback_items_details_length_check;
alter table public.feedback_items
add constraint feedback_items_details_length_check
check (length(trim(details)) between 20 and 4000);

create or replace function public.enforce_pick_deadline()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  previous_race_name text;
  previous_results_status text;
  race_is_archived boolean;
  race_pick_format text;
  race_qualifying_start_at timestamptz;
  race_round_number smallint;
  race_season_id bigint;
  race_start_at timestamptz;
  pick_lock_at timestamptz;
begin
  select
    race.qualifying_start_at,
    race.race_date,
    race.is_archived,
    race.pick_format,
    race.season_id,
    race.round_number
  into
    race_qualifying_start_at,
    race_start_at,
    race_is_archived,
    race_pick_format,
    race_season_id,
    race_round_number
  from public.races race
  where race.id = new.race_id;

  if race_qualifying_start_at is null or race_start_at is null then
    raise exception 'Race not found for pick submission';
  end if;

  if race_is_archived then
    raise exception 'Picks are disabled for archived races.';
  end if;

  if not public.is_registered_for_season(new.user_id, race_season_id) then
    raise exception 'Register for this league season before submitting picks.';
  end if;

  if not exists (
    select 1
    from public.league_seasons season
    where season.id = race_season_id
      and season.status = 'active'
  ) then
    raise exception 'Picks are only accepted for the active league season.';
  end if;

  select previous_race.race_name, previous_race.results_status
  into previous_race_name, previous_results_status
  from public.races previous_race
  where previous_race.is_archived = false
    and previous_race.season_id = race_season_id
    and previous_race.round_number < race_round_number
  order by previous_race.round_number desc
  limit 1;

  if previous_race_name is not null and previous_results_status <> 'published' then
    raise exception 'Picks are unavailable until % results are published.', previous_race_name;
  end if;

  pick_lock_at := case
    when race_pick_format = 'indy_500' then race_start_at
    else race_qualifying_start_at
  end;

  if timezone('utc', now()) >= pick_lock_at then
    if race_pick_format = 'indy_500' then
      raise exception 'Picks are locked because the race has already started.';
    end if;
    raise exception 'Picks are locked because qualifying has already started.';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_enforce_pick_deadline on public.picks;
create trigger trg_enforce_pick_deadline
before insert or update on public.picks
for each row execute function public.enforce_pick_deadline();

commit;
