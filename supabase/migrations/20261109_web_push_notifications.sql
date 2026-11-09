-- Device opt-in only; profiles, schema-version and portable league backups unchanged.
begin;
create table public.push_subscriptions (
 id uuid primary key default extensions.gen_random_uuid(),
 user_id uuid not null references public.profiles(id) on delete cascade,
 endpoint text not null unique check(endpoint ~ '^https://[^[:space:]]+$' and length(endpoint)<=2048),
 p256dh text not null check(length(p256dh) between 16 and 512),
 auth text not null check(length(auth) between 8 and 256),
 user_agent text check(length(user_agent)<=300),device_label text check(length(device_label)<=80),
 pick_reminders_enabled boolean not null default true,is_active boolean not null default true,
 last_delivered_at timestamptz,last_error text check(length(last_error)<=200),
 created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
-- Delivery batches look up opted-in devices for a bounded eligible user list.
create index push_subscriptions_user_delivery on public.push_subscriptions(user_id,is_active,pick_reminders_enabled);
alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from public,anon,authenticated;
grant select,delete on public.push_subscriptions to authenticated;
grant insert(user_id,endpoint,p256dh,auth,user_agent,device_label,pick_reminders_enabled,is_active) on public.push_subscriptions to authenticated;
grant update(endpoint,p256dh,auth,user_agent,device_label,pick_reminders_enabled,is_active) on public.push_subscriptions to authenticated;
grant all on public.push_subscriptions to service_role;
create policy push_owner_select on public.push_subscriptions for select to authenticated using(user_id=auth.uid());
create policy push_owner_insert on public.push_subscriptions for insert to authenticated with check(user_id=auth.uid());
create policy push_owner_update on public.push_subscriptions for update to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
create policy push_owner_delete on public.push_subscriptions for delete to authenticated using(user_id=auth.uid());
create function public.bound_push_devices() returns trigger language plpgsql security definer set search_path=public as $$
begin
 perform 1 from public.profiles where id=new.user_id for update;
 if tg_op='INSERT' and (select count(*) from public.push_subscriptions where user_id=new.user_id)>=10 then raise exception 'Device limit reached; remove an old subscription first.'; end if;
 new.updated_at=now();return new;
end;
$$;
revoke all on function public.bound_push_devices() from public,anon,authenticated,service_role;
create trigger push_device_bound before insert or update on public.push_subscriptions for each row execute function public.bound_push_devices();
-- One small cooldown row per account; deleting/re-enrolling a device cannot reset it.
create table public.push_test_limits(user_id uuid primary key references public.profiles(id) on delete cascade,last_test_at timestamptz not null);
alter table public.push_test_limits enable row level security;
revoke all on public.push_test_limits from public,anon,authenticated;
create function public.claim_push_test(p_endpoint text) returns boolean language plpgsql security definer set search_path=public as $$
begin
 if auth.uid() is null then raise exception 'Authentication required.'; end if;
 perform 1 from public.profiles where id=auth.uid() for update;
 if not exists(select 1 from public.push_subscriptions where user_id=auth.uid() and endpoint=p_endpoint and is_active) then return false; end if;
 insert into public.push_test_limits(user_id,last_test_at) values(auth.uid(),now())
 on conflict(user_id) do update set last_test_at=excluded.last_test_at where push_test_limits.last_test_at<=now()-interval '1 minute';
 return found;
end;
$$;
revoke all on function public.claim_push_test(text) from public,anon,service_role;
grant execute on function public.claim_push_test(text) to authenticated;
alter table public.pick_reminders drop constraint if exists pick_reminders_channel_check;
alter table public.pick_reminders add constraint pick_reminders_channel_check check(channel in ('email','push'));
-- Existing generic claim/validate leases and window uniqueness apply independently.
-- push_subscriptions is intentionally absent from recovery snapshot allowlists.
commit;
