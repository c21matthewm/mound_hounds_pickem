create or replace function public.ensure_race_driver_groups_snapshot_from_results()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1
    from public.race_driver_groups rg
    where rg.race_id = new.race_id
    limit 1
  ) then
    insert into public.race_driver_groups (race_id, driver_id, group_number)
    select
      new.race_id,
      d.id,
      d.group_number
    from public.drivers d
    where d.is_active = true
      and d.group_number between 1 and 6
    on conflict (race_id, driver_id) do nothing;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_results_ensure_race_driver_group_snapshot on public.results;
create trigger trg_results_ensure_race_driver_group_snapshot
before insert or update of race_id on public.results
for each row execute function public.ensure_race_driver_groups_snapshot_from_results();
