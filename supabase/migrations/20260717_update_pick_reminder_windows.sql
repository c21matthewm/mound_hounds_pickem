-- Move pick emails to a 5-day form-open notice, 2-day reminder, and 4-hour final reminder.

alter table public.pick_reminders
drop constraint if exists pick_reminders_reminder_type_check;

update public.pick_reminders
set reminder_type = case reminder_type
  when '4d' then '5d_open'
  when '2h' then '4h'
  else reminder_type
end
where reminder_type in ('4d', '2h');

alter table public.pick_reminders
add constraint pick_reminders_reminder_type_check
check (reminder_type in ('5d_open', '2d', '4h'));
