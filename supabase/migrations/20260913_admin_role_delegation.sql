-- Optional Admin workspace capability. Apply before using role delegation.
-- No data backfill and no application schema-version change.
-- is_active remains league participation eligibility; it does not revoke Admin access.
begin;

-- Statement-level serialization also covers existing eligibility edits and direct
-- authenticated profile updates. A nonblocking lock avoids deadlocks with older
-- RPCs that acquire a profile row lock before issuing their UPDATE statement.
create or replace function public.lock_profile_admin_changes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not pg_try_advisory_xact_lock(1296584784, 20260913) then
    raise exception using errcode = '55P03',
      message = 'Another account change is in progress. Refresh Participants and try again.';
  end if;
  -- Row locks also force stale REPEATABLE READ/SERIALIZABLE callers to abort
  -- instead of checking an out-of-date administrator set after another commit.
  perform id from public.profiles where role = 'admin' order by id for update;
  return null;
end;
$$;

revoke all on function public.lock_profile_admin_changes() from public, anon, authenticated, service_role;
drop trigger if exists trg_lock_profile_admin_changes on public.profiles;
create trigger trg_lock_profile_admin_changes
before update of role, is_active or delete on public.profiles
for each statement execute function public.lock_profile_admin_changes();

create or replace function public.guard_profile_admin_removal()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.role = 'admin' and (tg_op = 'DELETE' or new.role is distinct from old.role) then
    if auth.uid() = old.id then
      raise exception 'You cannot remove your own admin access.';
    end if;
    if not exists (
      select 1 from public.profiles profile
      where profile.id <> old.id and profile.role = 'admin' and profile.is_active = true
    ) then
      raise exception 'Another admin with participation enabled is required before removing this admin.';
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

revoke all on function public.guard_profile_admin_removal() from public, anon, authenticated, service_role;
drop trigger if exists trg_guard_profile_admin_removal on public.profiles;
create trigger trg_guard_profile_admin_removal
before update of role or delete on public.profiles
for each row execute function public.guard_profile_admin_removal();

create or replace function public.admin_update_participant_role(
  p_profile_id uuid,
  p_role text,
  p_expected_role text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_profile public.profiles%rowtype;
begin
  if auth.role() is distinct from 'authenticated' or not public.is_admin(auth.uid()) then
    raise exception 'Only an admin can change participant roles.';
  end if;
  if p_profile_id is null or p_role is null or p_expected_role is null
    or p_role not in ('admin', 'participant') or p_expected_role not in ('admin', 'participant')
    or p_role = p_expected_role then
    raise exception 'Select a valid participant and role change.';
  end if;
  if p_profile_id = auth.uid() and p_role = 'participant' then
    raise exception 'You cannot remove your own admin access.';
  end if;
  if not pg_try_advisory_xact_lock(1296584784, 20260913) then
    raise exception using errcode = '55P03',
      message = 'Another account change is in progress. Refresh Participants and try again.';
  end if;
  perform id from public.profiles where role = 'admin' order by id for update;
  -- Recheck after acquiring the same lock as direct role and eligibility writes.
  -- Each PL/pgSQL statement gets a fresh READ COMMITTED snapshot.
  if not public.is_admin(auth.uid()) then
    raise exception 'Your admin access has changed. Refresh before trying again.';
  end if;
  select * into target_profile from public.profiles where id = p_profile_id;
  if not found then raise exception 'Participant was not found.'; end if;
  if target_profile.role <> p_expected_role then
    raise exception 'This participant’s role has changed. Refresh Participants before trying again.';
  end if;
  if p_role = 'admin' and (
    length(trim(coalesce(target_profile.full_name, ''))) = 0
    or length(trim(coalesce(target_profile.team_name, ''))) = 0
  ) then
    raise exception 'Save this participant’s name and team before granting admin access.';
  end if;

  update public.profiles set role = p_role where id = p_profile_id;
  -- The audit and role update either both commit or both roll back. Do not add
  -- a second, best-effort application audit for this mutation.
  perform public.write_admin_audit_event(
    'change_role', 'profile', p_profile_id::text,
    format('Changed %s from %s to %s.', target_profile.team_name, target_profile.role, p_role),
    jsonb_build_object('role', target_profile.role, 'is_active', target_profile.is_active),
    jsonb_build_object('role', p_role, 'is_active', target_profile.is_active)
  );
  return jsonb_build_object('profile_id', p_profile_id, 'previous_role', target_profile.role, 'role', p_role);
end;
$$;

revoke all on function public.admin_update_participant_role(uuid, text, text) from public, anon, service_role;
grant execute on function public.admin_update_participant_role(uuid, text, text) to authenticated;

commit;
