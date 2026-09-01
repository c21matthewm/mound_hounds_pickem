-- Retire carrier-gateway SMS and remove participant phone data.

begin;

delete from public.pick_reminders
where channel = 'sms';

alter table public.pick_reminders
drop constraint if exists pick_reminders_channel_check;

alter table public.pick_reminders
add constraint pick_reminders_channel_check
check (channel = 'email');

alter table public.profiles
drop column if exists phone_number,
drop column if exists phone_carrier;

create or replace function public.get_app_health_contract()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  base_contract jsonb;
  missing_items jsonb;
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'Admin access required.';
  end if;

  base_contract := extensions.get_app_health_contract_20260822();
  missing_items := coalesce(base_contract->'missing', '[]'::jsonb);

  if to_regprocedure('public.pick_window_opens_at(bigint)') is null then
    missing_items := missing_items || jsonb_build_array('pick_window_opens_at');
  end if;

  if exists (
    select 1
    from information_schema.columns column_info
    where column_info.table_schema = 'public'
      and column_info.table_name = 'profiles'
      and column_info.column_name in ('phone_number', 'phone_carrier')
  ) then
    missing_items := missing_items || jsonb_build_array('email_only_profiles');
  end if;

  return jsonb_build_object(
    'healthy',
      coalesce((base_contract->>'healthy')::boolean, false)
      and jsonb_array_length(missing_items) = 0,
    'missing', missing_items,
    'version', '20260831_email_only_notifications_v1'
  );
end;
$$;

revoke all on function public.get_app_health_contract() from public, anon;
grant execute on function public.get_app_health_contract() to authenticated;

insert into public.app_metadata (key, value)
values ('schema_version', '20260831_email_only_notifications_v1')
on conflict (key) do update
set value = excluded.value, updated_at = timezone('utc', now());

commit;
