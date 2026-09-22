-- Adds a bounded, create-only path for historical spreadsheets. Existing live
-- season finalization retains its backups; historical archives cannot be replaced.
-- No schema version bump.
begin;

create or replace function public.import_historical_hall_of_fame_season(
  p_season_year integer,
  p_race_count integer,
  p_entries jsonb
)
returns bigint
language plpgsql
security definer
set search_path = public
set statement_timeout = '15s'
set lock_timeout = '5s'
as $$
declare
  archived_season_id bigint;
  entry_count integer;
  champion_team text;
  champion_points integer;
begin
  if coalesce(auth.role(), '') <> 'authenticated' then
    raise exception 'An authenticated administrator account is required.' using errcode = '42501';
  end if;
  -- is_active controls league participation, not administrative access.
  -- Keep the actor's role stable until the transaction completes.
  perform 1 from public.profiles
  where id = auth.uid() and role = 'admin'
  for share;
  if not found then
    raise exception 'An administrator account is required.' using errcode = '42501';
  end if;
  if p_season_year is null or p_season_year not between 2000 and 2100 then
    raise exception 'Season year must be between 2000 and 2100.' using errcode = '22023';
  end if;
  if p_race_count is null or p_race_count not between 1 and 100 then
    raise exception 'Race count must be between 1 and 100.' using errcode = '22023';
  end if;
  if p_entries is null or jsonb_typeof(p_entries) <> 'array' then
    raise exception 'Final standings must be an array.' using errcode = '22023';
  end if;
  entry_count := jsonb_array_length(p_entries);
  if entry_count not between 1 and 500 or octet_length(p_entries::text) > 300000 then
    raise exception 'Import requires 1 to 500 entries within the import size limit.' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_entries) as item(value)
    where jsonb_typeof(value) <> 'object'
      or jsonb_typeof(value -> 'final_rank') is distinct from 'number'
      or coalesce(value ->> 'final_rank', '') !~ '^[0-9]+$'
      or jsonb_typeof(value -> 'total_points') is distinct from 'number'
      or coalesce(value ->> 'total_points', '') !~ '^[0-9]+$'
      or jsonb_typeof(value -> 'team_name') is distinct from 'string'
      or length(btrim(value ->> 'team_name')) not between 1 and 160
      or (value ->> 'team_name') ~ '[[:cntrl:]]'
      or coalesce(value -> 'race_breakdown', '[]'::jsonb) <> '[]'::jsonb
  ) then
    raise exception 'One or more final standings entries are invalid.' using errcode = '22023';
  end if;
  -- Numeric bounds are checked before casting into the integer table columns.
  if exists (
    select 1 from jsonb_array_elements(p_entries) as item(value)
    where (value ->> 'final_rank')::numeric not between 1 and 500
      or (value ->> 'total_points')::numeric not between 0 and 2147483647
  ) then
    raise exception 'A rank or point total is outside the supported range.' using errcode = '22023';
  end if;
  if (select count(distinct lower(regexp_replace(normalize(btrim(team_name), NFKC), '[[:space:]]+', ' ', 'g')))
      from jsonb_to_recordset(p_entries) as entry(team_name text)) <> entry_count then
    raise exception 'Final standings contain duplicate team names.' using errcode = '22023';
  end if;
  if (select count(*) from jsonb_to_recordset(p_entries) as entry(final_rank integer)
      where final_rank = 1) <> 1 then
    raise exception 'Exactly one rank-1 champion is required.' using errcode = '22023';
  end if;
  if exists (
    with groups as (
      select final_rank, min(total_points) as minimum_points, max(total_points) as maximum_points, count(*) as group_size
      from jsonb_to_recordset(p_entries) as entry(final_rank integer, total_points integer)
      group by final_rank
    ), ordered as (
      select *, 1 + coalesce(sum(group_size) over (order by final_rank rows between unbounded preceding and 1 preceding), 0) as expected_rank,
        lag(minimum_points) over (order by final_rank) as preceding_points
      from groups
    )
    select 1 from ordered
    where final_rank <> expected_rank or minimum_points <> maximum_points or maximum_points > preceding_points
  ) then
    raise exception 'Final ranks must be consecutive or valid competition ranks, ordered by total points.' using errcode = '22023';
  end if;

  select team_name, total_points into champion_team, champion_points
  from jsonb_to_recordset(p_entries) as entry(final_rank integer, team_name text, total_points integer)
  where final_rank = 1;

  -- No upsert or delete: the unique season_year constraint also serializes two
  -- simultaneous imports. The losing transaction cannot replace the winner.
  insert into public.hall_of_fame_seasons (
    season_year, champion_team_name, champion_total_points, participant_count, race_count, finalized_by
  ) values (
    p_season_year, btrim(champion_team), champion_points, entry_count, p_race_count, auth.uid()
  ) returning id into archived_season_id;

  insert into public.hall_of_fame_entries (season_id, final_rank, team_name, total_points, race_breakdown)
  select archived_season_id, final_rank, btrim(team_name), total_points, '[]'::jsonb
  from jsonb_to_recordset(p_entries) as entry(final_rank integer, team_name text, total_points integer);

  -- The archive and audit are one transaction: an audit failure rolls back both
  -- archive tables. Do not also log this mutation from the server action.
  perform public.write_admin_audit_event(
    'import_historical_hall_of_fame', 'hall_of_fame_season', archived_season_id::text,
    format('Imported %s historical Hall of Fame standings.', p_season_year),
    null,
    jsonb_build_object('season_year', p_season_year, 'race_count', p_race_count,
      'participant_count', entry_count, 'champion_team_name', btrim(champion_team),
      'champion_total_points', champion_points)
  );
  return archived_season_id;
end;
$$;

revoke all on function public.import_historical_hall_of_fame_season(integer, integer, jsonb)
from public, anon;
grant execute on function public.import_historical_hall_of_fame_season(integer, integer, jsonb)
to authenticated;

-- Classification contract: spreadsheet archives deliberately store [] in every
-- race_breakdown because no historical app race IDs exist. In-app finalization
-- always stores a nonempty race breakdown. Protect this distinction inside the
-- upsert itself, after its row lock; an earlier existence check alone is racy.
-- Header-only archives also fail closed and require explicit operator review.
create or replace function public.finalize_hall_of_fame_season(
  p_season_year integer,
  p_race_count integer,
  p_entries jsonb
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  archived_season_id bigint;
  champion_points integer;
  champion_team text;
  entry_count integer;
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'Only an admin can finalize a Hall of Fame season.';
  end if;

  if p_season_year < 2000 or p_season_year > 2100 then
    raise exception 'Season year is invalid.';
  end if;

  if p_race_count is null or p_race_count <= 0 then
    raise exception 'At least one completed race is required.';
  end if;

  if p_entries is null or jsonb_typeof(p_entries) <> 'array' or jsonb_array_length(p_entries) = 0 then
    raise exception 'Final standings are required.';
  end if;

  select count(*)::integer
    into entry_count
  from jsonb_to_recordset(p_entries) as entry(
    final_rank integer,
    team_name text,
    total_points integer,
    race_breakdown jsonb
  )
  where entry.final_rank > 0
    and length(trim(entry.team_name)) > 0
    and entry.total_points >= 0
    and jsonb_typeof(coalesce(entry.race_breakdown, '[]'::jsonb)) = 'array';

  if entry_count <> jsonb_array_length(p_entries) then
    raise exception 'One or more final standings entries are invalid.';
  end if;

  if (
    select count(distinct lower(trim(entry.team_name)))
    from jsonb_to_recordset(p_entries) as entry(team_name text)
  ) <> entry_count then
    raise exception 'Final standings contain duplicate team names.';
  end if;

  if (
    select count(*) from jsonb_to_recordset(p_entries) as entry(final_rank integer)
    where entry.final_rank = 1
  ) <> 1 then
    raise exception 'A single rank-1 season champion is required before finalization.' using errcode = '22023';
  end if;

  select entry.team_name, entry.total_points
    into champion_team, champion_points
  from jsonb_to_recordset(p_entries) as entry(
    final_rank integer,
    team_name text,
    total_points integer
  )
  order by entry.final_rank asc, entry.total_points desc, entry.team_name asc
  limit 1;

  insert into public.hall_of_fame_seasons (
    season_year,
    champion_team_name,
    champion_total_points,
    participant_count,
    race_count,
    finalized_by,
    finalized_at
  )
  values (
    p_season_year,
    champion_team,
    champion_points,
    entry_count,
    p_race_count,
    auth.uid(),
    timezone('utc', now())
  )
  on conflict (season_year) do update
  set champion_team_name = excluded.champion_team_name,
      champion_total_points = excluded.champion_total_points,
      participant_count = excluded.participant_count,
      race_count = excluded.race_count,
      finalized_by = excluded.finalized_by,
      finalized_at = excluded.finalized_at
  where exists (
    select 1 from public.hall_of_fame_entries as prior_entry
    where prior_entry.season_id = public.hall_of_fame_seasons.id
      and prior_entry.race_breakdown <> '[]'::jsonb
  )
  returning id into archived_season_id;

  if archived_season_id is null then
    raise exception 'Historical Hall of Fame archives cannot be replaced by season finalization. Review the saved archive instead.' using errcode = '22023';
  end if;

  delete from public.hall_of_fame_entries where season_id = archived_season_id;

  insert into public.hall_of_fame_entries (
    season_id,
    final_rank,
    team_name,
    total_points,
    race_breakdown
  )
  select
    archived_season_id,
    entry.final_rank,
    trim(entry.team_name),
    entry.total_points,
    coalesce(entry.race_breakdown, '[]'::jsonb)
  from jsonb_to_recordset(p_entries) as entry(
    final_rank integer,
    team_name text,
    total_points integer,
    race_breakdown jsonb
  );

  return archived_season_id;
end;
$$;

revoke all on function public.finalize_hall_of_fame_season(integer, integer, jsonb)
from public, anon;
grant execute on function public.finalize_hall_of_fame_season(integer, integer, jsonb)
to authenticated;

commit;
